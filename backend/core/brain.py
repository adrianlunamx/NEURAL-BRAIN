"""BrainCore: ingestion, retrieval-augmented answers and the thinking stream."""

from __future__ import annotations

import asyncio
import json
import re
import time
import unicodedata
import uuid
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

from core.config import Settings
from core.embeddings import Embedder
from core.llm import LLMClient, LLMResult
from db.graph_store import GraphStore
from db.vector_store import VectorStore
from models.schemas import IngestMetadata
from utils.logger import logger

SEED_FILE = Path(__file__).resolve().parent.parent / "data" / "seed.json"

# Phase pacing (seconds) used when the client asks for an animated answer.
SEARCH_DELAY = 0.3
CONNECT_DELAY = 0.5
DUPLICATE_SCORE = 0.985


def _slug(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r"[^a-z0-9]+", "-", text).strip("-")[:40] or "concept"


def _label(content: str, title: str | None, max_words: int = 6) -> str:
    if title:
        return title.strip()[:60]
    words = content.split()
    label = " ".join(words[:max_words])
    return label + ("…" if len(words) > max_words else "")


class BrainCore:
    def __init__(self, settings: Settings, embedder: Embedder | None = None, llm: LLMClient | None = None):
        self.settings = settings
        self.embedder = embedder or Embedder(settings.embedding_model, settings.embedding_backend)
        self.vector_db = VectorStore(settings.storage_dir, collection=f"brain-{self.embedder.id}")
        self.graph = GraphStore(
            settings.storage_dir / f"graph-{self.embedder.id}.json",
            settings.layout_iterations,
            settings.layout_mode,
        )
        self.llm = llm or LLMClient(settings)
        self._lock = asyncio.Lock()
        self._reconcile()

    def _reconcile(self) -> None:
        """If storage got out of sync (e.g. a crash mid-ingest), start clean rather than half-broken."""
        if self.vector_db.count() != self.graph.graph.number_of_nodes():
            logger.warning(
                "Vector store ({}) and graph ({}) disagree; resetting storage",
                self.vector_db.count(), self.graph.graph.number_of_nodes(),
            )
            self.vector_db.reset()
            self.graph.reset()

    # ── ingestion ────────────────────────────────────────────────
    async def ingest(self, content: str, metadata: IngestMetadata | None = None) -> dict[str, Any]:
        metadata = metadata or IngestMetadata()
        async with self._lock:
            result = await asyncio.to_thread(self._ingest_sync, content, metadata)
        logger.info("Ingested {} ({} connections)", result["node_id"], result["connections"])
        return result

    def _ingest_sync(self, content: str, meta: IngestMetadata) -> dict[str, Any]:
        s = self.settings
        embedding = self.embedder.encode(content)
        neighbours = self.vector_db.query(embedding, n=s.max_links_per_node * 3)

        if neighbours and neighbours[0]["score"] >= DUPLICATE_SCORE and neighbours[0]["document"] == content:
            dup = neighbours[0]["id"]
            return {"node_id": dup, "connections": self.graph.graph.degree(dup), "created": False, "concepts": []}

        prefix = "c" if meta.type == "concept" else "f"
        node_id = f"{prefix}_{uuid.uuid4().hex[:10]}"
        label = _label(content, meta.title)
        now = time.time()

        self.graph.add_node(node_id, label=label, type=meta.type, content=content, tags=meta.tags,
                            source=meta.source, created_at=now)
        self.vector_db.add(node_id, embedding, content, {
            "type": meta.type, "label": label, "tags": meta.tags, "source": meta.source, "created_at": now,
        })

        connections = 0
        for hit in neighbours:
            if connections >= s.max_links_per_node or hit["score"] < s.link_threshold:
                break
            if self.graph.add_edge(node_id, hit["id"], hit["score"], kind="semantic"):
                connections += 1

        concepts: list[str] = []
        for tag in meta.tags:
            concept_id = self._ensure_concept(tag)
            if concept_id != node_id and self.graph.add_edge(node_id, concept_id, 0.8, kind="tag"):
                connections += 1
                concepts.append(concept_id)

        self.graph.save()
        return {"node_id": node_id, "connections": connections, "created": True, "concepts": concepts}

    def _ensure_concept(self, tag: str) -> str:
        concept_id = f"c_{_slug(tag)}"
        if self.graph.has_node(concept_id):
            return concept_id
        text = tag.strip()
        self.graph.add_node(concept_id, label=text, type="concept", content=f"Concept: {text}", tags=[text],
                            source="tag", created_at=time.time())
        self.vector_db.add(concept_id, self.embedder.encode(text), f"Concept: {text}", {
            "type": "concept", "label": text, "tags": [text], "source": "tag",
        })
        return concept_id

    async def seed(self, path: Path = SEED_FILE) -> int:
        items = json.loads(Path(path).read_text(encoding="utf-8"))
        count = 0
        for item in items:
            res = await self.ingest(item["content"], IngestMetadata(**item.get("metadata", {})))
            count += int(res["created"])
        return count

    async def reset(self) -> None:
        async with self._lock:
            self.vector_db.reset()
            self.graph.reset()
        logger.warning("Brain reset: all knowledge wiped")

    # ── graph ────────────────────────────────────────────────────
    async def graph_payload(self) -> dict[str, Any]:
        async with self._lock:
            payload = await asyncio.to_thread(self.graph.to_payload)
        payload["stats"] = self.graph.stats()
        return payload

    # ── thinking ─────────────────────────────────────────────────
    async def query_stream(self, question: str, animate: bool = True) -> AsyncIterator[dict[str, Any]]:
        """Stream the thought process: search → connect → token* → synthesize."""
        s = self.settings

        # SEARCH
        if animate:
            await asyncio.sleep(SEARCH_DELAY)
        embedding = await asyncio.to_thread(self.embedder.encode, question)
        hits = self.vector_db.query(embedding, n=s.top_k)
        best = max((h["score"] for h in hits), default=0.0)
        results = []
        for rank, hit in enumerate(hits):
            node = self.graph.node(hit["id"]) or {}
            results.append({
                "id": hit["id"],
                "score": round(hit["score"], 4),
                # relevance relative to the best match (best = 100%)
                "percentage": int(round(max(hit["score"], 0) / best * 100)) if best > 0 else 0,
                "rank": rank,
                "label": node.get("label", hit["metadata"].get("label", hit["id"])),
                "type": node.get("type", hit["metadata"].get("type", "fact")),
                "content": hit["document"],
            })
        yield self._event("search", {
            "question": question,
            "nodes": results,
            "percentages": {r["id"]: r["percentage"] for r in results},
        })

        # CONNECT
        if animate:
            await asyncio.sleep(CONNECT_DELAY)
        links = self.graph.find_connections([r["id"] for r in results])
        yield self._event("connect", links)

        # SYNTHESIZE (answer streamed as tokens, then a final summary event)
        context = self._build_context(results, links)
        llm_result = LLMResult(text="", model=self.llm.model, stop_reason=None)
        async for chunk in self.llm.stream_answer(question, context, llm_result):
            yield self._event("token", {"text": chunk})

        yield self._event("synthesize", {
            "answer": llm_result.text.strip(),
            "sources": [{k: r[k] for k in ("id", "label", "type", "score", "percentage", "content")} for r in results],
            "model": llm_result.model,
            "offline": llm_result.offline,
            "stop_reason": llm_result.stop_reason,
        })

    def _build_context(self, results: list[dict], links: dict[str, Any]) -> str:
        if not results:
            return "(empty brain: no notes stored yet)"
        index = {r["id"]: i + 1 for i, r in enumerate(results)}
        lines = [f"[{index[r['id']]}] ({r['type']}, relevance {r['score']:.2f}) {r['content']}" for r in results]

        relations = []
        for path in links.get("paths", [])[:12]:
            names = []
            for node_id in path:
                if node_id in index:
                    names.append(f"[{index[node_id]}]")
                else:
                    node = self.graph.node(node_id) or {}
                    names.append(f"'{node.get('label', node_id)}'")
            relations.append(" ↔ ".join(names))
        if relations:
            lines += ["", "Relations in the knowledge graph:"] + [f"- {r}" for r in relations]
        return "\n".join(lines)

    @staticmethod
    def _event(kind: str, data: dict[str, Any]) -> dict[str, Any]:
        return {"type": kind, "data": data, "timestamp": time.time()}

    def health(self) -> dict[str, Any]:
        return {
            "status": "ok",
            "llm": self.llm.enabled,
            "model": self.llm.model,
            "embeddings": self.embedder.backend,
            "vector_store": self.vector_db.backend,
            "stats": self.graph.stats(),
        }

"""ChromaDB wrapper for semantic memory.

Collection "neurons": one document per neuron that carries meaning
(ingested text, hook summaries, query labels). Seed neurons have no
embedding until they get activated with a label.

Embeddings come from sentence-transformers. With EMBEDDING_BACKEND=hash (or if
sentence-transformers is not installed) a tiny deterministic hashing embedder
is used instead, so tests and CI run without downloading PyTorch models.
"""
from __future__ import annotations

import hashlib
import re
import threading
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional

import chromadb
import numpy as np

_TOKEN = re.compile(r"\w+", re.UNICODE)


class HashingEmbedder:
    """Signed feature hashing of words, word bigrams and char trigrams (384 dims, L2-normalized)."""

    dim = 384

    def _bucket(self, feature: str) -> tuple[int, float]:
        value = int.from_bytes(hashlib.blake2b(feature.encode(), digest_size=8).digest(), "little")
        return value % self.dim, 1.0 if (value >> 63) & 1 else -1.0

    def encode(self, text: str, normalize_embeddings: bool = True) -> np.ndarray:
        norm_text = unicodedata.normalize("NFKD", text.lower())
        norm_text = "".join(ch for ch in norm_text if not unicodedata.combining(ch))
        words = _TOKEN.findall(norm_text)
        feats = [(f"w:{w}", 1.0) for w in words]
        feats += [(f"b:{a}_{b}", 0.7) for a, b in zip(words, words[1:])]
        for w in words:
            padded = f"#{w}#"
            feats += [(f"c:{padded[i:i + 3]}", 0.25) for i in range(len(padded) - 2)]
        vec = np.zeros(self.dim, dtype=np.float32)
        for feat, weight in feats:
            idx, sign = self._bucket(feat)
            vec[idx] += sign * weight
        n = np.linalg.norm(vec)
        return vec / n if normalize_embeddings and n > 0 else vec


def load_embedder(model_name: str, backend: str = "auto"):
    """Return (model, name). backend: auto | sentence-transformers | hash."""
    if backend in ("auto", "sentence-transformers"):
        try:
            from sentence_transformers import SentenceTransformer

            return SentenceTransformer(model_name), model_name
        except Exception as exc:  # ImportError or model download failure
            if backend == "sentence-transformers":
                raise
            print(f"[neural-brain] sentence-transformers unavailable ({exc}); using hashing embedder")
    return HashingEmbedder(), "hash384"


class VectorStore:
    def __init__(self, persist_dir: str | Path, model_name: str = "all-MiniLM-L6-v2",
                 backend: str = "auto") -> None:
        self.persist_dir = Path(persist_dir)
        self.persist_dir.mkdir(parents=True, exist_ok=True)
        # Loaded once; encode() is thread-safe for inference.
        self.model, self.model_name = load_embedder(model_name, backend)
        self.client = chromadb.PersistentClient(
            path=str(self.persist_dir),
            settings=chromadb.config.Settings(anonymized_telemetry=False),
        )
        # one collection per embedding model: dimensions of different models don't mix
        suffix = "" if self.model_name == "all-MiniLM-L6-v2" else "_" + re.sub(r"[^a-z0-9]+", "_", self.model_name.lower())
        self.collection = self.client.get_or_create_collection(
            name=f"neurons{suffix}"[:60],
            metadata={"hnsw:space": "cosine"},
        )
        self.lock = threading.Lock()

    def _embed(self, text: str) -> List[float]:
        return np.asarray(self.model.encode(text, normalize_embeddings=True), dtype=np.float32).tolist()

    # ------------------------------------------------------------------
    def add_neuron(self, neuron_id: str, text: str, metadata: Optional[Dict] = None) -> str:
        """Embed text and store it under neuron_id. Returns the embedding ref."""
        embedding = self._embed(text)
        clean = {k: v for k, v in (metadata or {}).items() if isinstance(v, (str, int, float, bool))}
        with self.lock:
            self.collection.upsert(
                ids=[neuron_id],
                embeddings=[embedding],
                documents=[text],
                metadatas=[clean or None],
            )
        return neuron_id

    def attach_label(self, neuron_id: str, text: str, metadata: Optional[Dict] = None) -> None:
        """Give a seed neuron meaning after it fires (used by hooks/queries)."""
        self.add_neuron(neuron_id, text, metadata)

    def semantic_search(self, text: str, top_k: int = 8) -> List[Dict]:
        """Return [{id, score, document, metadata}] sorted by score desc.

        ChromaDB returns cosine *distance*; score = 1 / (1 + distance).
        """
        with self.lock:
            total = self.collection.count()
        if total == 0:
            return []
        embedding = self._embed(text)
        with self.lock:
            result = self.collection.query(
                query_embeddings=[embedding],
                n_results=min(top_k, total),
                include=["documents", "metadatas", "distances"],
            )
        hits: List[Dict] = []
        ids = result.get("ids", [[]])[0]
        docs = result.get("documents", [[]])[0]
        metas = result.get("metadatas", [[]])[0]
        dists = result.get("distances", [[]])[0]
        for nid, doc, meta, dist in zip(ids, docs, metas, dists):
            score = 1.0 / (1.0 + float(dist))
            hits.append({"id": nid, "score": round(score, 4),
                         "document": doc, "metadata": meta or {}})
        hits.sort(key=lambda h: h["score"], reverse=True)
        return hits

    def get_embeddings(self, neuron_ids) -> Dict[str, np.ndarray]:
        """Stored embedding of each id that has one."""
        ids = list(dict.fromkeys(neuron_ids))
        if not ids:
            return {}
        with self.lock:
            result = self.collection.get(ids=ids, include=["embeddings"])
        embs = result.get("embeddings")
        if embs is None:
            return {}
        return {nid: np.asarray(e, dtype=np.float32) for nid, e in zip(result.get("ids", []), embs)}

    def remove(self, neuron_id: str) -> None:
        with self.lock:
            self.collection.delete(ids=[neuron_id])

    def count(self) -> int:
        with self.lock:
            return self.collection.count()

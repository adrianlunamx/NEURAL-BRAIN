"""Vector store: ChromaDB (persistent) with an in-process numpy fallback."""

from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

import numpy as np

from utils.logger import logger


def _flatten_metadata(meta: dict[str, Any]) -> dict[str, str | int | float | bool]:
    """Chroma only accepts scalar metadata values."""
    flat: dict[str, str | int | float | bool] = {}
    for key, value in meta.items():
        if value is None:
            continue
        if isinstance(value, (list, tuple, set)):
            flat[key] = ",".join(str(v) for v in value)
        elif isinstance(value, (str, int, float, bool)):
            flat[key] = value
        else:
            flat[key] = json.dumps(value)
    return flat


class _NumpyCollection:
    """Tiny cosine-similarity store persisted as JSON. Used when chromadb is missing."""

    def __init__(self, path: Path):
        self.path = path
        self.ids: list[str] = []
        self.docs: list[str] = []
        self.metas: list[dict] = []
        self.vecs = np.zeros((0, 0), dtype=np.float32)
        if path.exists():
            raw = json.loads(path.read_text())
            self.ids, self.docs, self.metas = raw["ids"], raw["docs"], raw["metas"]
            self.vecs = np.array(raw["vecs"], dtype=np.float32)

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps({
            "ids": self.ids, "docs": self.docs, "metas": self.metas, "vecs": self.vecs.tolist(),
        }))

    def count(self) -> int:
        return len(self.ids)

    def add(self, id_: str, vec: np.ndarray, doc: str, meta: dict) -> None:
        vec = vec.reshape(1, -1).astype(np.float32)
        self.vecs = vec if self.vecs.size == 0 else np.vstack([self.vecs, vec])
        self.ids.append(id_)
        self.docs.append(doc)
        self.metas.append(meta)
        self._save()

    def query(self, vec: np.ndarray, n: int) -> list[dict]:
        if not self.ids:
            return []
        sims = self.vecs @ vec.astype(np.float32)
        order = np.argsort(-sims)[:n]
        return [
            {"id": self.ids[i], "document": self.docs[i], "metadata": self.metas[i], "score": float(sims[i])}
            for i in order
        ]

    def reset(self) -> None:
        self.ids, self.docs, self.metas = [], [], []
        self.vecs = np.zeros((0, 0), dtype=np.float32)
        if self.path.exists():
            self.path.unlink()


class VectorStore:
    def __init__(self, persist_dir: Path, collection: str = "neural_brain"):
        self.persist_dir = Path(persist_dir)
        self.collection_name = collection
        self._client = None
        self._col = None
        self._fallback: _NumpyCollection | None = None
        try:
            import chromadb
            from chromadb.config import Settings as ChromaSettings

            self.persist_dir.mkdir(parents=True, exist_ok=True)
            self._client = chromadb.PersistentClient(
                path=str(self.persist_dir / "chroma"),
                settings=ChromaSettings(anonymized_telemetry=False, allow_reset=True),
            )
            self._open_collection()
            self.backend = "chromadb"
        except ImportError:
            self._fallback = _NumpyCollection(self.persist_dir / f"{collection}.json")
            self.backend = "numpy"
        logger.info("Vector store: {} (collection='{}', items={})", self.backend, collection, self.count())

    def _open_collection(self) -> None:
        self._col = self._client.get_or_create_collection(
            name=self.collection_name, metadata={"hnsw:space": "cosine"}
        )

    def count(self) -> int:
        return self._fallback.count() if self._fallback else self._col.count()

    def add(self, id_: str, embedding: np.ndarray, document: str, metadata: dict[str, Any]) -> None:
        meta = _flatten_metadata(metadata)
        if self._fallback:
            self._fallback.add(id_, embedding, document, meta)
            return
        self._col.add(ids=[id_], embeddings=[embedding.tolist()], documents=[document], metadatas=[meta or None])

    def query(self, embedding: np.ndarray, n: int = 5) -> list[dict[str, Any]]:
        """Return up to `n` hits as `{id, document, metadata, score}`; score is cosine similarity."""
        total = self.count()
        if total == 0 or n <= 0:
            return []
        n = min(n, total)
        if self._fallback:
            return self._fallback.query(embedding, n)
        res = self._col.query(
            query_embeddings=[embedding.tolist()],
            n_results=n,
            include=["documents", "metadatas", "distances"],
        )
        hits = []
        for i, id_ in enumerate(res["ids"][0]):
            hits.append({
                "id": id_,
                "document": res["documents"][0][i],
                "metadata": res["metadatas"][0][i] or {},
                "score": float(1.0 - res["distances"][0][i]),
            })
        return hits

    def reset(self) -> None:
        if self._fallback:
            self._fallback.reset()
            return
        try:
            self._client.delete_collection(self.collection_name)
        except Exception:  # collection may not exist yet
            pass
        self._open_collection()

    def wipe_disk(self) -> None:
        """Remove persisted files (used by tests)."""
        shutil.rmtree(self.persist_dir, ignore_errors=True)

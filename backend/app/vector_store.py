"""ChromaDB wrapper for semantic memory.

Collection "neurons": one document per neuron that carries meaning
(ingested text, hook summaries, query labels). Seed neurons have no
embedding until they get activated with a label.

Embeddings come from the sentence-transformers model run through ONNX Runtime
(no PyTorch; the ONNX export is fetched from the model's Hugging Face repo).
EMBEDDING_BACKEND=sentence-transformers uses the PyTorch stack instead
(requirements-torch.txt), for models without an ONNX export. With
EMBEDDING_BACKEND=hash, or if no model can be loaded, a tiny deterministic
hashing embedder is used, so tests and CI run without downloading models.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import unicodedata
from pathlib import Path
from typing import Dict, List, Optional

# Windows without Developer Mode can't symlink: HF still caches fine but warns on
# every download. Read at huggingface_hub import time, hence before chromadb.
os.environ.setdefault("HF_HUB_DISABLE_SYMLINKS_WARNING", "1")

import chromadb  # noqa: E402
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


class OnnxEmbedder:
    """A sentence-transformers model through ONNX Runtime: tokenize, run the
    transformer, mean-pool over the attention mask, L2-normalize. Same vectors
    as SentenceTransformer(model).encode(..., normalize_embeddings=True) for
    mean-pooling models such as all-MiniLM-L6-v2."""

    def __init__(self, model_name: str) -> None:
        import onnxruntime as ort
        from huggingface_hub import hf_hub_download
        from tokenizers import Tokenizer

        repo = model_name if "/" in model_name else f"sentence-transformers/{model_name}"
        max_len = 256
        try:
            with open(hf_hub_download(repo, "sentence_bert_config.json"), encoding="utf-8") as fh:
                max_len = int(json.load(fh).get("max_seq_length", max_len))
        except Exception:
            pass
        self.tokenizer = Tokenizer.from_file(hf_hub_download(repo, "tokenizer.json"))
        self.tokenizer.enable_truncation(max_length=max_len)
        self.tokenizer.enable_padding()
        self.session = ort.InferenceSession(hf_hub_download(repo, "onnx/model.onnx"),
                                            providers=["CPUExecutionProvider"])
        self.inputs = {i.name for i in self.session.get_inputs()}

    def encode(self, text, normalize_embeddings: bool = True) -> np.ndarray:
        single = isinstance(text, str)
        encs = self.tokenizer.encode_batch([text] if single else list(text))
        ids = np.array([e.ids for e in encs], dtype=np.int64)
        mask = np.array([e.attention_mask for e in encs], dtype=np.int64)
        feeds = {"input_ids": ids, "attention_mask": mask}
        if "token_type_ids" in self.inputs:
            feeds["token_type_ids"] = np.array([e.type_ids for e in encs], dtype=np.int64)
        tokens = self.session.run(None, feeds)[0]  # (batch, seq, dim)
        weights = mask[..., None].astype(np.float32)
        vecs = (tokens * weights).sum(1) / np.clip(weights.sum(1), 1e-9, None)
        if normalize_embeddings:
            vecs = vecs / np.clip(np.linalg.norm(vecs, axis=1, keepdims=True), 1e-12, None)
        vecs = vecs.astype(np.float32)
        return vecs[0] if single else vecs


def load_embedder(model_name: str, backend: str = "auto"):
    """Return (model, name). backend: auto | onnx | sentence-transformers | hash."""
    if backend in ("auto", "onnx"):
        try:
            return OnnxEmbedder(model_name), model_name
        except Exception as exc:  # onnxruntime missing, no ONNX export, offline...
            if backend == "onnx":
                raise
            print(f"[neural-brain] ONNX embedder unavailable ({exc}); trying sentence-transformers")
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

    def _embed_many(self, texts: List[str]) -> List[List[float]]:
        if isinstance(self.model, HashingEmbedder):
            return [self._embed(t) for t in texts]
        return np.asarray(self.model.encode(list(texts), normalize_embeddings=True), dtype=np.float32).tolist()

    # ------------------------------------------------------------------
    def add_neuron(self, neuron_id: str, text: str, metadata: Optional[Dict] = None) -> str:
        """Embed text and store it under neuron_id. Returns the embedding ref."""
        self.add_neurons([(neuron_id, text, metadata)])
        return neuron_id

    def add_neurons(self, items: List[tuple]) -> None:
        """Store several (neuron_id, text, metadata) at once, with one model call."""
        if not items:
            return
        embeddings = self._embed_many([text for _nid, text, _meta in items])
        clean = [{k: v for k, v in (meta or {}).items() if isinstance(v, (str, int, float, bool))} or None
                 for _nid, _text, meta in items]
        with self.lock:
            self.collection.upsert(
                ids=[nid for nid, _text, _meta in items],
                embeddings=embeddings,
                documents=[text for _nid, text, _meta in items],
                metadatas=clean,
            )

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

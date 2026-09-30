"""Sentence embeddings with a zero-dependency fallback.

`SentenceTransformer('all-MiniLM-L6-v2')` is used when available. If the
package (or its model download) is unavailable, a deterministic hashing
embedder keeps the brain fully functional offline - handy for tests, CI
and first runs without internet.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata

import numpy as np

from utils.logger import logger

_TOKEN = re.compile(r"\w+", re.UNICODE)
_STOPWORDS = {
    # en
    "the", "a", "an", "of", "to", "and", "or", "in", "on", "is", "are", "was", "for",
    "with", "that", "this", "it", "as", "by", "be", "at", "from", "what", "how", "why",
    # es
    "el", "la", "los", "las", "un", "una", "de", "del", "y", "o", "en", "es", "son",
    "que", "por", "para", "con", "se", "su", "al", "lo", "como", "qué", "cómo", "cuál",
}


def _normalize(text: str) -> str:
    text = unicodedata.normalize("NFKD", text.lower())
    return "".join(ch for ch in text if not unicodedata.combining(ch))


class HashingEmbedder:
    """Signed feature-hashing of unigrams, bigrams and char trigrams."""

    def __init__(self, dim: int = 384):
        self.dim = dim

    def _bucket(self, feature: str) -> tuple[int, float]:
        digest = hashlib.blake2b(feature.encode(), digest_size=8).digest()
        value = int.from_bytes(digest, "little")
        return value % self.dim, 1.0 if (value >> 63) & 1 else -1.0

    def encode_one(self, text: str) -> np.ndarray:
        vec = np.zeros(self.dim, dtype=np.float32)
        words = [w for w in _TOKEN.findall(_normalize(text)) if w not in _STOPWORDS]
        feats: list[tuple[str, float]] = [(f"w:{w}", 1.0) for w in words]
        feats += [(f"b:{a}_{b}", 0.7) for a, b in zip(words, words[1:])]
        for w in words:
            padded = f"#{w}#"
            feats += [(f"c:{padded[i:i + 3]}", 0.25) for i in range(len(padded) - 2)]
        for feat, weight in feats:
            idx, sign = self._bucket(feat)
            vec[idx] += sign * weight
        norm = np.linalg.norm(vec)
        return vec / norm if norm > 0 else vec


class Embedder:
    def __init__(self, model_name: str = "all-MiniLM-L6-v2", backend: str = "auto"):
        self.model_name = model_name
        self._model = None
        self._hasher: HashingEmbedder | None = None

        if backend in {"auto", "sentence-transformers"}:
            try:
                from sentence_transformers import SentenceTransformer

                self._model = SentenceTransformer(model_name)
                # probe instead of get_sentence_embedding_dimension(): stable across ST versions
                self.dim = int(self._model.encode(["probe"], convert_to_numpy=True).shape[-1])
                self.backend = "sentence-transformers"
                logger.info("Embeddings: SentenceTransformer '{}' (dim={})", model_name, self.dim)
                return
            except Exception as exc:  # ImportError, download failures, ...
                if backend == "sentence-transformers":
                    raise
                logger.warning("SentenceTransformer unavailable ({}); using hashing embedder", exc)

        self._hasher = HashingEmbedder()
        self.dim = self._hasher.dim
        self.backend = "hash"
        logger.info("Embeddings: hashing embedder (dim={})", self.dim)

    @property
    def id(self) -> str:
        """Stable identifier used to namespace the vector collection."""
        if self.backend == "hash":
            return f"hash{self.dim}"
        slug = re.sub(r"[^a-zA-Z0-9]+", "-", self.model_name).strip("-").lower()
        return f"st-{slug}"[:48]

    def encode(self, texts: str | list[str]) -> np.ndarray:
        """Return L2-normalised float32 embeddings. 1-D for a str, 2-D for a list."""
        single = isinstance(texts, str)
        batch = [texts] if single else list(texts)
        if self._model is not None:
            out = self._model.encode(batch, normalize_embeddings=True, convert_to_numpy=True)
            out = out.astype(np.float32)
        else:
            out = np.stack([self._hasher.encode_one(t) for t in batch])
        return out[0] if single else out

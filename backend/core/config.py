"""Runtime configuration loaded from environment variables / `.env`."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _int(name: str, default: int) -> int:
    raw = os.getenv(name, "").strip()
    return int(raw) if raw else default


def _float(name: str, default: float) -> float:
    raw = os.getenv(name, "").strip()
    return float(raw) if raw else default


def _str(name: str, default: str) -> str:
    raw = os.getenv(name, "").strip()
    return raw or default


@dataclass(frozen=True)
class Settings:
    anthropic_api_key: str | None = None
    anthropic_model: str = "claude-opus-5-5"
    anthropic_effort: str = "low"
    anthropic_max_tokens: int = 4000
    anthropic_fallbacks: bool = True

    embedding_model: str = "all-MiniLM-L6-v2"
    embedding_backend: str = "auto"

    top_k: int = 5
    link_threshold: float = 0.35
    max_links_per_node: int = 4
    layout_iterations: int = 200
    layout_mode: str = "brain"

    storage_dir: Path = BACKEND_DIR / "storage"
    cors_origins: list[str] = field(default_factory=lambda: ["http://localhost:5173"])
    log_level: str = "INFO"

    @property
    def llm_enabled(self) -> bool:
        return bool(self.anthropic_api_key)


def load_settings(**overrides) -> Settings:
    storage = Path(_str("STORAGE_DIR", "./storage"))
    if not storage.is_absolute():
        storage = (BACKEND_DIR / storage).resolve()
    values = dict(
        anthropic_api_key=os.getenv("ANTHROPIC_API_KEY", "").strip() or None,
        anthropic_model=_str("ANTHROPIC_MODEL", "claude-opus-5-5"),
        anthropic_effort=_str("ANTHROPIC_EFFORT", "low"),
        anthropic_max_tokens=_int("ANTHROPIC_MAX_TOKENS", 4000),
        anthropic_fallbacks=_bool("ANTHROPIC_FALLBACKS", True),
        embedding_model=_str("EMBEDDING_MODEL", "all-MiniLM-L6-v2"),
        embedding_backend=_str("EMBEDDING_BACKEND", "auto").lower(),
        top_k=_int("TOP_K", 5),
        link_threshold=_float("LINK_THRESHOLD", 0.35),
        max_links_per_node=_int("MAX_LINKS_PER_NODE", 4),
        layout_iterations=_int("LAYOUT_ITERATIONS", 200),
        layout_mode=_str("LAYOUT_MODE", "brain").lower(),
        storage_dir=storage,
        cors_origins=[
            o.strip()
            for o in _str("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ],
        log_level=_str("LOG_LEVEL", "INFO").upper(),
    )
    values.update(overrides)
    return Settings(**values)


@lru_cache
def get_settings() -> Settings:
    return load_settings()

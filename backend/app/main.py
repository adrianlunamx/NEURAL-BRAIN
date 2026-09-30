"""Neural Brain backend entrypoint.

Run from the repository root:  uvicorn backend.app.main:app --port 8000
(or: python -m backend.app.main)
"""
from __future__ import annotations

import asyncio
import os
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from . import api
from .events import EventBus
from .git_store import GitStore
from .graph_store import GraphStore
from .llm import Synthesizer
from .vector_store import VectorStore

BACKEND_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BACKEND_DIR / ".env")


def _path(env: str, default: str) -> Path:
    """Relative paths are resolved against backend/, so the cwd doesn't matter."""
    p = Path(os.getenv(env, default))
    return p if p.is_absolute() else (BACKEND_DIR / p).resolve()


API_HOST = os.getenv("API_HOST", "0.0.0.0")
API_PORT = int(os.getenv("API_PORT", "8000"))
FRONTEND_URL = os.getenv("FRONTEND_URL", "http://localhost:5173")
CHROMA_DIR = _path("CHROMA_DIR", "data/chroma")
GRAPH_REPO_DIR = _path("GRAPH_REPO_DIR", "data/graph_repo")
EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "all-MiniLM-L6-v2")
EMBEDDING_BACKEND = os.getenv("EMBEDDING_BACKEND", "auto")
AUTO_COMMIT_EVERY = int(os.getenv("AUTO_COMMIT_EVERY", "25"))
AUTO_COMMIT_SECONDS = int(os.getenv("AUTO_COMMIT_SECONDS", "60"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    bus = EventBus()
    graph = GraphStore(seed=42)
    gitstore = GitStore(GRAPH_REPO_DIR, graph,
                        auto_commit_every=AUTO_COMMIT_EVERY,
                        auto_commit_seconds=AUTO_COMMIT_SECONDS)
    # Restore previous session if a snapshot exists, else seed and take the first one.
    if gitstore.graph_file.exists() and graph.load_json(gitstore.graph_file) \
            and graph.graph.number_of_nodes() > 0:
        gitstore.mark_loaded()
        print(f"[neural-brain] restored graph from previous snapshot: "
              f"{graph.graph.number_of_nodes()} neurons")
    else:
        print("[neural-brain] seeding 19,000 neurons ...")
        graph.seed_brain()
        h = await asyncio.to_thread(gitstore.snapshot, "initial brain seed: 19,000 neurons")
        print(f"[neural-brain] initial snapshot committed: {h}")
    print(f"[neural-brain] brain ready: {graph.graph.number_of_nodes()} neurons, "
          f"{graph.graph.number_of_edges()} edges")
    vector = VectorStore(CHROMA_DIR, model_name=EMBEDDING_MODEL, backend=EMBEDDING_BACKEND)
    synthesizer = Synthesizer()
    print(f"[neural-brain] embeddings: {vector.model_name} · Claude: "
          f"{synthesizer.model if synthesizer.enabled else 'off (no ANTHROPIC_API_KEY)'}")
    api.init(bus, graph, vector, gitstore, synthesizer)
    app.state.bus = bus
    app.state.graph = graph

    async def autocommit_loop() -> None:
        while True:
            await asyncio.sleep(5)
            commit_hash = await asyncio.to_thread(gitstore.maybe_auto_commit)
            if commit_hash:
                print(f"[neural-brain] auto-commit {commit_hash}")
                await bus.publish("stats", graph.stats())

    task = asyncio.create_task(autocommit_loop())
    yield
    task.cancel()
    try:
        await asyncio.to_thread(gitstore.snapshot, "shutdown snapshot")
    except Exception as exc:  # graph.json is written first, so nothing is lost
        print(f"[neural-brain] shutdown snapshot not committed: {exc}")


app = FastAPI(title="Neural Brain", version="2.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[FRONTEND_URL, "http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(api.router)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.app.main:app", host=API_HOST, port=API_PORT, reload=False)

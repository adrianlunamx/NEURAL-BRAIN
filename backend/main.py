"""neural-brain API · run with:  uvicorn main:app --reload --port 8000"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.routes import router
from core.brain import BrainCore
from core.config import get_settings
from utils.logger import logger, setup_logger

settings = get_settings()
setup_logger(settings.log_level)


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Booting neural-brain…")
    if getattr(app.state, "brain", None) is None:  # tests may inject their own brain
        app.state.brain = BrainCore(settings)
    stats = app.state.brain.graph.stats()
    logger.info("Brain online: {} nodes / {} edges", stats["nodes"], stats["edges"])
    yield
    logger.info("Brain shutting down")


app = FastAPI(
    title="neural-brain",
    description="Second brain with RAG + knowledge graph + a 3D view of how it thinks.",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(router)


@app.get("/")
async def root():
    return {"name": "neural-brain", "docs": "/docs", "health": "/api/health"}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

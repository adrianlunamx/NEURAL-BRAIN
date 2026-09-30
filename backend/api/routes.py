"""HTTP API: ingest, query (SSE), graph, reset, seed, health."""

from __future__ import annotations

import json
import time

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

from core.brain import BrainCore
from models.schemas import (
    GraphResponse,
    HealthResponse,
    IngestRequest,
    IngestResponse,
    QueryRequest,
    ResetResponse,
    SeedResponse,
)
from utils.logger import logger

router = APIRouter(prefix="/api")


def get_brain(request: Request) -> BrainCore:
    return request.app.state.brain


def _sse(event: dict) -> str:
    return f"event: {event['type']}\ndata: {json.dumps(event, ensure_ascii=False)}\n\n"


@router.get("/health", response_model=HealthResponse)
async def health(brain: BrainCore = Depends(get_brain)):
    return brain.health()


@router.post("/ingest", response_model=IngestResponse)
async def ingest(body: IngestRequest, brain: BrainCore = Depends(get_brain)):
    return await brain.ingest(body.content, body.metadata)


@router.post("/query")
async def query(body: QueryRequest, request: Request, brain: BrainCore = Depends(get_brain)):
    question = body.question.strip()
    if not question:
        raise HTTPException(status_code=422, detail="question must not be blank")

    async def stream():
        try:
            async for event in brain.query_stream(question, animate=body.animate):
                if await request.is_disconnected():
                    logger.info("Client disconnected mid-thought")
                    return
                yield _sse(event)
        except Exception as exc:  # surface failures to the UI instead of silently closing
            logger.exception("query_stream failed")
            yield _sse({"type": "error", "data": {"message": str(exc)}, "timestamp": time.time()})
        yield _sse({"type": "done", "data": {}, "timestamp": time.time()})

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.get("/graph", response_model=GraphResponse)
async def graph(brain: BrainCore = Depends(get_brain)):
    return await brain.graph_payload()


@router.get("/node/{node_id}")
async def node(node_id: str, brain: BrainCore = Depends(get_brain)):
    data = brain.graph.node(node_id)
    if data is None:
        raise HTTPException(status_code=404, detail="node not found")
    data["neighbors"] = [
        {"id": nb, "label": brain.graph.graph.nodes[nb].get("label", nb),
         "weight": brain.graph.graph[node_id][nb].get("weight", 0.5)}
        for nb in brain.graph.graph.neighbors(node_id)
    ]
    return data


@router.post("/seed", response_model=SeedResponse)
async def seed(brain: BrainCore = Depends(get_brain)):
    ingested = await brain.seed()
    return {"ingested": ingested, "stats": brain.graph.stats()}


@router.delete("/reset", response_model=ResetResponse)
async def reset(brain: BrainCore = Depends(get_brain)):
    await brain.reset()
    return ResetResponse()

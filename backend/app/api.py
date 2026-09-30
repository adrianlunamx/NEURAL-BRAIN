"""REST + SSE API for Neural Brain."""
from __future__ import annotations

import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from .events import EventBus
from .git_store import GitStore
from .graph_store import LOD_LEVELS, GraphStore
from .llm import Synthesizer
from .models import (
    BrainEvent, FiberDTO, GitCommitRequest, GitCommitResponse, GitLogEntry,
    GitRestoreRequest, GitRestoreResponse, GraphEdgeDTO, GraphNodeDTO,
    GraphResponse, HookEventRequest, HookEventResponse, IngestRequest,
    IngestResponse, Phase, QueryHit, QueryRequest, QueryResponse,
    Region, RegionInfo, StatsResponse,
)
from .query_engine import run_query_phases
from .vector_store import VectorStore

router = APIRouter()

# Wired in main.py lifespan.
bus: EventBus
graph: GraphStore
vector: VectorStore
gitstore: GitStore
synthesizer: Optional[Synthesizer] = None
_query_task: Optional[asyncio.Task] = None


def init(_bus: EventBus, _graph: GraphStore, _vector: VectorStore, _git: GitStore,
         _synth: Optional[Synthesizer] = None) -> None:
    global bus, graph, vector, gitstore, synthesizer
    bus, graph, vector, gitstore, synthesizer = _bus, _graph, _vector, _git, _synth


def _neuron_added_payload(nid: str) -> dict:
    node = graph.graph.nodes[nid]
    region = node["region"]
    return {
        "id": nid, "label": node.get("label", ""),
        "region": getattr(region, "value", region),
        "position": [float(c) for c in node["position"]],
        "color": node["color"], "size": float(node["size"]),
    }


# ------------------------------------------------------------------ health
@router.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": "neural-brain",
        "llm": bool(synthesizer and synthesizer.enabled),
        "model": synthesizer.model if synthesizer else None,
        "embeddings": vector.model_name,
    }


# ------------------------------------------------------------------ ingest
@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """Split text into chunks, embed each, create one neuron per chunk."""
    chunks = [c.strip() for c in req.text.replace("\n", " ").split(". ") if c.strip()]
    chunks = chunks or [req.text.strip()]
    # Cap chunks so one request cannot flood the brain.
    chunks = chunks[:12]
    neuron_ids = []
    for i, chunk in enumerate(chunks):
        label = req.label or chunk[:60]
        region = req.region_hint or Region.HIPPOCAMPUS
        nid, _recycled = graph.add_neuron(
            label=label, region=region, source="ingest",
            metadata={"source": req.source, "chunk": i},
        )
        await asyncio.to_thread(vector.add_neuron, nid, chunk, {"region": region.value, "source": req.source})
        graph.graph.nodes[nid]["embedding_ref"] = nid
        await bus.publish("neuron_added", _neuron_added_payload(nid))
        await bus.publish("neuron_activated", {"id": nid, "amount": 0.8})
        neuron_ids.append(nid)
    await bus.publish("stats", graph.stats())
    return IngestResponse(neuron_ids=neuron_ids, count=len(neuron_ids))


# ------------------------------------------------------------------ query
@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest) -> QueryResponse:
    """Fire-and-forget: phases stream over SSE, the response returns the hits."""
    global _query_task
    if _query_task is not None and not _query_task.done():
        raise HTTPException(status_code=409, detail="a query is already running; wait for IDLE")
    hits_raw = await asyncio.to_thread(vector.semantic_search, req.text, req.top_k)
    hits = []
    for h in hits_raw:
        nid = h["id"]
        if nid not in graph.graph:
            continue
        node = graph.graph.nodes[nid]
        pos = tuple(float(c) for c in node["position"])
        hits.append(QueryHit(
            id=nid, label=node.get("label") or h.get("document", "")[:40] or nid,
            region=Region(node.get("region")), score=float(h["score"]), position=pos,
        ))
    # Launch the animated phase machine in the background (fire-and-forget).
    qid = uuid.uuid4().hex[:8]
    _query_task = asyncio.create_task(
        run_query_phases(req.text, req.top_k, bus, graph, vector, synthesizer, query_id=qid)
    )
    return QueryResponse(query_id=qid, hits=hits)


# ------------------------------------------------------------------ graph
@router.get("/graph", response_model=GraphResponse)
async def get_graph(detail: str = "high") -> GraphResponse:
    if detail not in LOD_LEVELS:
        raise HTTPException(status_code=400, detail=f"detail must be one of {list(LOD_LEVELS)}")
    nodes = graph.get_visible_nodes(detail)
    edges = graph.get_visible_edges([n["id"] for n in nodes])
    return GraphResponse(
        nodes=[GraphNodeDTO(**n) for n in nodes],
        edges=[GraphEdgeDTO(**e) for e in edges],
        total_neurons=graph.graph.number_of_nodes(),
        detail=detail,
    )


@router.get("/fibers", response_model=list[FiberDTO])
async def get_fibers() -> list[FiberDTO]:
    """All long-range fibers with endpoint positions (corpus callosum, for Fibers.tsx)."""
    return [FiberDTO(**f) for f in graph.get_fibers()]


# ------------------------------------------------------------------ SSE
@router.get("/events/stream")
async def events_stream(request: Request) -> EventSourceResponse:
    async def generator():
        # Send current phase immediately so late joiners sync.
        yield {"event": "phase",
               "data": BrainEvent(event_type="phase",
                                  payload={"phase": graph.phase.value}).model_dump_json()}
        async for event in bus.stream():
            if await request.is_disconnected():
                break
            yield {"event": event["type"], "data": BrainEvent(
                event_type=event["type"], payload=event["data"]).model_dump_json()}
    return EventSourceResponse(generator(), ping=15)


# ------------------------------------------------------------------ hooks
HOOK_REGION = {
    "file_read": Region.TEMPORAL,     # reading -> language/memory (temporal lobe)
    "file_search": Region.PARIETAL,   # searching -> spatial/attention (parietal)
    "file_edit": Region.FRONTAL,       # editing -> executive control (frontal)
    "agent_launch": Region.HIPPOCAMPUS,  # subagent -> memory formation (hippocampus)
    "command": Region.CEREBELLUM,      # shell commands -> procedural (cerebellum)
}


@router.post("/hooks/event", response_model=HookEventResponse)
async def hook_event(req: HookEventRequest) -> HookEventResponse:
    region = HOOK_REGION.get(req.hook_type, Region.FRONTAL)
    label = req.summary or f"{req.hook_type}: {req.tool_name}"
    extra = {k: v for k, v in req.extra.items() if isinstance(v, (str, int, float, bool))}
    nid, recycled = graph.add_neuron(
        label=label[:80], region=region, source="hook",
        metadata={"hook_type": req.hook_type, "tool": req.tool_name, "cwd": req.cwd, **extra},
    )
    # publish first: the neuron lights up without waiting for the embedding
    graph.activate(nid, 1.0)
    await bus.publish("neuron_added", _neuron_added_payload(nid))
    await bus.publish("neuron_activated", {"id": nid, "amount": 1.0})
    await asyncio.to_thread(vector.attach_label, nid, label, {"hook_type": req.hook_type})
    graph.graph.nodes[nid]["embedding_ref"] = nid
    await bus.publish("stats", graph.stats())
    return HookEventResponse(ok=True, neuron_id=nid, region=region, recycled=recycled)


# ------------------------------------------------------------------ regions / stats
@router.get("/regions", response_model=list[RegionInfo])
async def get_regions() -> list[RegionInfo]:
    return [RegionInfo(**info) for info in graph.get_region_info()]


@router.get("/stats", response_model=StatsResponse)
async def get_stats() -> StatsResponse:
    return StatsResponse(**graph.stats())


# ------------------------------------------------------------------ git
@router.post("/git/commit", response_model=GitCommitResponse)
async def git_commit(req: GitCommitRequest) -> GitCommitResponse:
    commit_hash = await asyncio.to_thread(gitstore.snapshot, req.message)
    return GitCommitResponse(commit_hash=commit_hash, message=req.message or "manual snapshot")


@router.get("/git/log", response_model=list[GitLogEntry])
async def git_log(limit: int = 20) -> list[GitLogEntry]:
    return [GitLogEntry(**e) for e in gitstore.log(limit=limit)]


@router.post("/git/restore", response_model=GitRestoreResponse)
async def git_restore(req: GitRestoreRequest) -> GitRestoreResponse:
    ok = await asyncio.to_thread(gitstore.restore, req.commit_hash)
    if not ok:
        raise HTTPException(status_code=404, detail="commit not found")
    await bus.publish("graph_reloaded", graph.stats())
    await bus.publish("phase", {"phase": Phase.IDLE.value})
    return GitRestoreResponse(ok=True, commit_hash=req.commit_hash)

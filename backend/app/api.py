"""REST + SSE API for Neural Brain."""
from __future__ import annotations

import asyncio
import uuid
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from sse_starlette.sse import EventSourceResponse

from .activity import ActivityStore
from .events import EventBus
from .git_store import GitStore
from .graph_store import LOD_LEVELS, GraphStore
from .llm import Synthesizer
from .models import (
    BrainEvent, FiberDTO, GitCommitRequest, GitCommitResponse, GitLogEntry,
    GitRestoreRequest, GitRestoreResponse, GraphEdgeDTO, GraphNodeDTO,
    GraphResponse, HookEventRequest, HookEventResponse, IngestBatchRequest,
    IngestBatchResponse, IngestRequest, IngestResponse, Phase, QueryHit, QueryRequest, QueryResponse,
    Region, RegionInfo, StatsResponse,
)
from .notes import build_notes_view, note_index, normalize_type, region_for_group, resolve_note
from .query_engine import knowledge_hits, run_query_phases
from .vector_store import VectorStore

router = APIRouter()

# Wired in main.py lifespan.
bus: EventBus
graph: GraphStore
vector: VectorStore
gitstore: GitStore
synthesizer: Optional[Synthesizer] = None
activity: ActivityStore = ActivityStore()
_query_task: Optional[asyncio.Task] = None
_demo_task: Optional[asyncio.Task] = None
_notes_cache: dict = {"version": -1, "view": None, "index": {}}


def init(_bus: EventBus, _graph: GraphStore, _vector: VectorStore, _git: GitStore,
         _synth: Optional[Synthesizer] = None, _activity: Optional[ActivityStore] = None) -> None:
    global bus, graph, vector, gitstore, synthesizer, activity
    bus, graph, vector, gitstore, synthesizer = _bus, _graph, _vector, _git, _synth
    activity = _activity or ActivityStore()
    _notes_cache.update(version=-1, view=None, index={})


def notes_view() -> dict:
    """GET /notes payload, rebuilt only when notes changed."""
    if _notes_cache["version"] != graph.notes_version or _notes_cache["view"] is None:
        version = graph.notes_version
        view = build_notes_view(graph, vector.get_embeddings)
        _notes_cache.update(version=version, view=view,
                            index=note_index([{"title": n["title"], "path": n["path"], "id": n["id"]}
                                              for n in view["notes"]]))
    return _notes_cache["view"]


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
async def _ingest_notes(reqs: list[IngestRequest]) -> list[IngestResponse]:
    """Split each note into chunks and create one neuron per chunk. All chunks of
    all notes are embedded in a single model call."""
    staged: list[tuple[str, str, dict]] = []  # (neuron id, chunk, vector metadata)
    responses: list[IngestResponse] = []
    note_ids: list[str] = []
    for req in reqs:
        chunks = [c.strip() for c in req.text.replace("\n", " ").split(". ") if c.strip()]
        chunks = chunks or [req.text.strip()]
        # Cap chunks so one request cannot flood the brain.
        chunks = chunks[:12]
        title = (req.title or req.label or "").strip() or None
        region = req.region_hint or region_for_group(graph, req.group)
        note_meta = {
            "source": req.source,
            "note_id": f"note_{uuid.uuid4().hex[:8]}",
            "title": title or chunks[0][:60],
            "group": (req.group or "").strip() or "Memoria",
            "note_type": normalize_type(req.note_type),
            "tags": ",".join(t.strip() for t in req.tags if t.strip()),
            "path": (req.path or "").strip(),
        }
        neuron_ids = []
        for i, chunk in enumerate(chunks):
            label = title or chunk[:60]
            meta = {**note_meta, "chunk": i}
            if i == 0:
                meta["text"] = req.text[:4000]
            nid, _recycled = graph.add_neuron(label=label, region=region, source="ingest", metadata=meta)
            staged.append((nid, chunk, {"region": region.value, "source": req.source}))
            neuron_ids.append(nid)
        note_ids.append(note_meta["note_id"])
        responses.append(IngestResponse(neuron_ids=neuron_ids, count=len(neuron_ids)))

    await asyncio.to_thread(vector.add_neurons, staged)
    for nid, _chunk, _meta in staged:
        graph.graph.nodes[nid]["embedding_ref"] = nid
        await bus.publish("neuron_added", _neuron_added_payload(nid))
        await bus.publish("neuron_activated", {"id": nid, "amount": 0.8})
    graph.notes_version += 1  # embeddings are stored now: similarity links can be computed
    await bus.publish("notes_changed", {"note_id": note_ids[-1]} if len(note_ids) == 1 else {})
    await bus.publish("stats", graph.stats())
    return responses


@router.post("/ingest", response_model=IngestResponse)
async def ingest(req: IngestRequest) -> IngestResponse:
    """Split text into chunks, embed each, create one neuron per chunk."""
    return (await _ingest_notes([req]))[0]


@router.post("/ingest/batch", response_model=IngestBatchResponse)
async def ingest_batch(req: IngestBatchRequest) -> IngestBatchResponse:
    """Several notes in one request (same rules as /ingest, embedded together)."""
    notes = await _ingest_notes(req.notes)
    return IngestBatchResponse(notes=notes, count=sum(n.count for n in notes))


# ------------------------------------------------------------------ notes
@router.get("/notes")
async def get_notes() -> dict:
    """Notes (memories) with groups, types, typed connections and problems."""
    return await asyncio.to_thread(notes_view)


# ------------------------------------------------------------------ query
@router.post("/query", response_model=QueryResponse)
async def query(req: QueryRequest) -> QueryResponse:
    """Fire-and-forget: phases stream over SSE, the response returns the hits."""
    global _query_task
    if _query_task is not None and not _query_task.done():
        raise HTTPException(status_code=409, detail="a query is already running; wait for IDLE")
    hits_raw = await asyncio.to_thread(vector.semantic_search, req.text, req.top_k * 3)
    hits = []
    for h in knowledge_hits(graph, hits_raw)[:req.top_k]:
        nid = h["id"]
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


SESSION_EVENTS = {"UserPromptSubmit", "Notification", "Stop", "SubagentStart", "SubagentStop"}


async def record_hook(req: HookEventRequest) -> HookEventResponse:
    """An agent hook event: live activity + (for tool calls) a neuron that fires."""
    target = req.target or req.summary.split(": ", 1)[-1]
    note_id = None
    if req.event not in SESSION_EVENTS:
        await asyncio.to_thread(notes_view)
        note_id = resolve_note(_notes_cache["index"], target)
    item = activity.record(
        event=req.event, session_id=req.session_id, cwd=req.cwd, agent_id=req.agent_id,
        agent_type=req.agent_type, tool_name=req.tool_name, hook_type=req.hook_type,
        action=req.action, target=target, summary=req.summary,
        lines_added=req.lines_added, lines_removed=req.lines_removed, note_id=note_id,
        client=req.client,
    )
    await bus.publish("activity", item)
    if req.event in SESSION_EVENTS:
        return HookEventResponse(ok=True, note_id=note_id)

    region = HOOK_REGION.get(req.hook_type, Region.FRONTAL)
    label = req.summary or f"{req.hook_type}: {req.tool_name}"
    extra = {k: v for k, v in req.extra.items() if isinstance(v, (str, int, float, bool))}
    nid, recycled = graph.add_neuron(
        label=label[:80], region=region, source="hook",
        metadata={"hook_type": req.hook_type, "tool": req.tool_name, "cwd": req.cwd,
                  "action": item["action"], "client": req.client, **extra},
    )
    # publish first: the neuron lights up without waiting for the embedding
    graph.activate(nid, 1.0)
    await bus.publish("neuron_added", _neuron_added_payload(nid))
    await bus.publish("neuron_activated", {"id": nid, "amount": 1.0})
    if note_id:
        view = _notes_cache["view"] or {}
        note = next((n for n in view.get("notes", []) if n["id"] == note_id), None)
        for anchor in (note or {}).get("neuron_ids", [])[:3]:
            graph.activate(anchor, 1.0)
            await bus.publish("neuron_activated", {"id": anchor, "amount": 1.0})
    await asyncio.to_thread(vector.attach_label, nid, label, {"hook_type": req.hook_type})
    graph.graph.nodes[nid]["embedding_ref"] = nid
    await bus.publish("stats", graph.stats())
    return HookEventResponse(ok=True, neuron_id=nid, region=region, recycled=recycled, note_id=note_id)


@router.post("/hooks/event", response_model=HookEventResponse)
async def hook_event(req: HookEventRequest) -> HookEventResponse:
    return await record_hook(req)


# ------------------------------------------------------------------ activity
@router.get("/activity")
async def get_activity() -> dict:
    """Sessions, subagents, recent actions, files edited in the last 30 min, event rate."""
    return activity.snapshot()


@router.post("/activity/demo")
async def activity_demo() -> dict:
    """"Probar": replay a short simulated Claude Code session through the hook pipeline."""
    global _demo_task
    if _demo_task is not None and not _demo_task.done():
        return {"ok": True, "running": True}
    from .demo import run_demo
    _demo_task = asyncio.create_task(run_demo(record_hook))
    return {"ok": True, "running": False}


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
    await bus.publish("notes_changed", {})
    await bus.publish("phase", {"phase": Phase.IDLE.value})
    return GitRestoreResponse(ok=True, commit_hash=req.commit_hash)

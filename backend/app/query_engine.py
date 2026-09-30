"""Query phase machine: INPUT -> SEARCH -> CONNECT -> SYNTHESIZE -> IDLE.

Each phase is published on the EventBus as an SSE "phase" event; the frontend
QueryAnimation component renders the matching 3D choreography. Real neurons in
the GraphStore are activated along the way so queries leave memory traces.
"""
from __future__ import annotations

import asyncio
import os
import uuid
from typing import Optional

from .events import EventBus
from .graph_store import REGION_COLORS, GraphStore
from .llm import Synthesizer
from .models import Phase, Region
from .vector_store import VectorStore

QUERY_NEURON_POSITION = (0.0, 9.5, 0.0)   # floats above the brain, magenta
SYNTHESIS_POSITION = (0.0, 1.2, 0.0)      # brain center, giant yellow neuron

# Phase durations in seconds (tuned so each phase is readable on screen).
# PHASE_TIME_SCALE stretches them all (e.g. 2 for slow-motion demos).
_SCALE = float(os.getenv("PHASE_TIME_SCALE", "1") or 1)
TIMINGS = {k: v * _SCALE for k, v in {"INPUT": 0.9, "SEARCH": 2.6, "CONNECT": 2.2, "SYNTHESIZE": 3.2}.items()}
# Longest we hold CONNECT waiting for Claude before synthesizing without it.
LLM_TIMEOUT = 25.0


async def run_query_phases(
    text: str,
    top_k: int,
    bus: EventBus,
    graph: GraphStore,
    vector: VectorStore,
    synthesizer: Optional[Synthesizer] = None,
    query_id: Optional[str] = None,
    timings: Optional[dict] = None,
) -> str:
    query_id = query_id or uuid.uuid4().hex[:8]
    timings = timings or TIMINGS
    try:
        return await _run(text, top_k, bus, graph, vector, synthesizer, query_id, timings)
    except Exception as exc:  # never leave the brain stuck mid-phase
        print(f"[neural-brain] query {query_id} failed: {exc!r}")
        graph.set_phase(Phase.IDLE)
        await bus.publish("phase", {"phase": Phase.IDLE.value, "query_id": query_id, "error": str(exc)})
        return query_id


async def _run(text, top_k, bus, graph, vector, synthesizer, query_id, timings) -> str:
    graph.set_phase(Phase.INPUT)

    # ---- INPUT: magenta query neuron appears above the brain ----
    await bus.publish("phase", {
        "phase": Phase.INPUT.value,
        "query_id": query_id,
        "text": text[:120],
        "position": list(QUERY_NEURON_POSITION),
    })
    await asyncio.sleep(timings["INPUT"])

    # ---- SEARCH: semantic scan, magenta rays to first candidates ----
    graph.set_phase(Phase.SEARCH)
    hits = await asyncio.to_thread(vector.semantic_search, text, top_k * 3)
    hits = knowledge_hits(graph, hits)[:top_k]
    # Fallback: if the vector store is empty, pick hippocampus neurons as "memory".
    if not hits:
        candidates = graph.region_index.get(Region.HIPPOCAMPUS, [])[:4]
        hits = [{"id": nid, "score": 0.5, "document": "", "metadata": {}} for nid in candidates]

    scan_targets = []
    for h in hits[:4]:
        nid = h["id"]
        pos = tuple(float(c) for c in graph.graph.nodes[nid]["position"])
        graph.activate(nid, 0.6)
        scan_targets.append({"id": nid, "position": list(pos)})
        await bus.publish("neuron_activated", {"id": nid, "amount": 0.6})
    await bus.publish("phase", {
        "phase": Phase.SEARCH.value,
        "query_id": query_id,
        "status": "escaneando memoria...",
        "query_position": list(QUERY_NEURON_POSITION),
        "targets": scan_targets,
    })
    await asyncio.sleep(timings["SEARCH"])

    # ---- CONNECT: winners light up, % labels, thick white connections ----
    graph.set_phase(Phase.CONNECT)
    connect_hits = []
    for h in hits:
        nid = h["id"]
        node = graph.graph.nodes[nid]
        pos = tuple(float(c) for c in node["position"])
        label = node.get("label") or h.get("document", "")[:40] or nid
        graph.activate(nid, 1.0)
        connect_hits.append({
            "id": nid,
            "label": label,
            "region": str(getattr(node.get("region"), "value", node.get("region"))),
            "score": float(h["score"]),
            "position": list(pos),
        })
        await bus.publish("neuron_activated", {"id": nid, "amount": 1.0})
    # Claude starts writing while the CONNECT animation plays
    llm_task = None
    if synthesizer and synthesizer.enabled:
        docs = [{**c, "document": h.get("document", "")} for c, h in zip(connect_hits, hits)]
        llm_task = asyncio.create_task(synthesizer.answer(text, docs))
    # strengthen memory: link the top hits together
    for i in range(len(connect_hits)):
        for j in range(i + 1, len(connect_hits)):
            a, b = connect_hits[i]["id"], connect_hits[j]["id"]
            if graph.connect(a, b, weight=0.9):
                await bus.publish("edge_added", {
                    "source": a, "target": b, "weight": 0.9, "type": "query_ray",
                })
    await bus.publish("phase", {
        "phase": Phase.CONNECT.value,
        "query_id": query_id,
        "hits": connect_hits,
        "query_position": list(QUERY_NEURON_POSITION),
    })
    await asyncio.sleep(timings["CONNECT"])

    # ---- SYNTHESIZE: giant yellow neuron, explosion of rays, convergence ----
    answer = None
    if llm_task is not None:
        try:
            answer = await asyncio.wait_for(llm_task, timeout=LLM_TIMEOUT)
        except asyncio.TimeoutError:
            answer = None
    graph.set_phase(Phase.SYNTHESIZE)
    summary = answer or _summarize(text, connect_hits)
    converged_ids = [h["id"] for h in connect_hits]
    for nid in converged_ids:
        graph.activate(nid, 1.0)
    await bus.publish("phase", {
        "phase": Phase.SYNTHESIZE.value,
        "query_id": query_id,
        "summary": summary,
        "summary_source": "claude" if answer else "extractive",
        "center": list(SYNTHESIS_POSITION),
        "converged_ids": converged_ids,
        "hits": connect_hits,
    })
    await asyncio.sleep(timings["SYNTHESIZE"])

    # ---- back to IDLE ----
    graph.set_phase(Phase.IDLE)
    # Persist the query itself as a memory neuron in the hippocampus.
    mem_id, _ = graph.add_neuron(
        label=f"query: {text[:60]}", region=Region.HIPPOCAMPUS, source="query",
        metadata={"query_id": query_id, "hits": ",".join(converged_ids)},
    )
    await asyncio.to_thread(vector.attach_label, mem_id, text, {"query_id": query_id})
    node = graph.graph.nodes[mem_id]
    await bus.publish("neuron_added", {
        "id": mem_id, "label": f"query: {text[:60]}",
        "region": Region.HIPPOCAMPUS.value, "position": [float(c) for c in node["position"]],
        "color": REGION_COLORS[Region.HIPPOCAMPUS], "size": float(node["size"]),
    })
    await bus.publish("phase", {"phase": Phase.IDLE.value, "query_id": query_id})
    await bus.publish("stats", graph.stats())
    return query_id


def knowledge_hits(graph: GraphStore, hits: list) -> list:
    """Hits that are knowledge. Past questions are kept as memory neurons but never
    returned as sources: repeating a question would otherwise cite itself at 100%."""
    return [
        h for h in hits
        if h["id"] in graph.graph and graph.graph.nodes[h["id"]].get("source") != "query"
    ]


def _summarize(text: str, hits: list) -> str:
    if not hits:
        return "Sin recuerdos relevantes encontrados."
    top = sorted(hits, key=lambda h: h["score"], reverse=True)[:3]
    parts = [f"{h['label']} ({h['score'] * 100:.0f}%)" for h in top]
    return f"Query: '{text[:80]}' -> " + " | ".join(parts)

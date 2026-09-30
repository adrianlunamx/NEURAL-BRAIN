"""Shared data contracts for Neural Brain.

These models are the single source of truth for the shape of neurons,
synapses and events. The frontend mirrors them in src/types.ts — keep both
in sync when adding fields.
"""
from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Dict, List, Literal, Optional, Tuple

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class Region(str, Enum):
    """The six anatomical brain regions used for layout and hook mapping."""
    FRONTAL = "frontal"
    PARIETAL = "parietal"
    TEMPORAL = "temporal"
    OCCIPITAL = "occipital"
    HIPPOCAMPUS = "hippocampus"
    CEREBELLUM = "cerebellum"


class Phase(str, Enum):
    """The four query animation phases plus the resting state."""
    IDLE = "IDLE"
    INPUT = "INPUT"
    SEARCH = "SEARCH"
    CONNECT = "CONNECT"
    SYNTHESIZE = "SYNTHESIZE"


class EdgeType(str, Enum):
    """Kind of synapse/connection between neurons."""
    LOCAL = "local"    # short-range, same region
    FIBER = "fiber"    # long-range inter-regional (corpus callosum style)
    QUERY_RAY = "query_ray"  # transient ray cast during SEARCH/CONNECT phases


# ---------------------------------------------------------------------------
# Core graph models
# ---------------------------------------------------------------------------

class NeuronNode(BaseModel):
    """A single neuron in the 3D brain."""
    id: str = Field(..., description="Unique neuron id, e.g. 'n_000123' or 'hook_9f3a'")
    label: str = Field(default="", description="Human readable label shown on hover/labels")
    region: Region = Field(..., description="Anatomical region this neuron lives in")
    position: Tuple[float, float, float] = Field(
        ..., description="Anatomical 3D position (x: front-back, y: up-down, z: left-right)"
    )
    size: float = Field(default=1.0, ge=0.1, le=5.0, description="Visual size multiplier")
    color: str = Field(default="#4da3ff", description="Base hex color (usually the region color)")
    color_state: Literal["base", "active", "magenta", "yellow"] = Field(
        default="base", description="Transient visual override used by the animation phases"
    )
    activation: float = Field(default=0.0, ge=0.0, le=1.0, description="Current activation 0..1")
    embedding_ref: Optional[str] = Field(
        default=None, description="ChromaDB document id holding this neuron's embedding"
    )
    source: Literal["seed", "ingest", "hook", "query"] = Field(
        default="seed", description="How this neuron was created"
    )
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    last_activated_at: Optional[datetime] = Field(default=None)
    metadata: Dict[str, Any] = Field(default_factory=dict)


class SynapseEdge(BaseModel):
    """A directed connection between two neurons."""
    source: str
    target: str
    weight: float = Field(default=0.5, ge=0.0, le=1.0)
    type: EdgeType = Field(default=EdgeType.LOCAL)
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class BrainEvent(BaseModel):
    """Anything that happened to the brain, also the SSE payload shape."""
    event_type: str = Field(
        ..., description="phase | neuron_added | neuron_activated | edge_added | stats | graph_reloaded"
    )
    payload: Dict[str, Any] = Field(default_factory=dict)
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# REST request / response schemas
# ---------------------------------------------------------------------------

NOTE_TYPES = ("instrucciones", "indice", "usuario", "feedback", "proyecto",
              "referencia", "documento", "handoff")


class IngestRequest(BaseModel):
    """One memory (note). Its text is chunked into neurons that share a note id."""
    text: str = Field(..., min_length=1, max_length=20000)
    source: str = Field(default="manual", description="manual | file | web | note")
    region_hint: Optional[Region] = Field(default=None)
    label: Optional[str] = Field(default=None, description="Note title (alias of `title`)")
    title: Optional[str] = Field(default=None, max_length=200)
    group: Optional[str] = Field(default=None, max_length=80, description="Project/group, e.g. 'Web · Handoffs'")
    note_type: Optional[str] = Field(default=None, description=f"one of {', '.join(NOTE_TYPES)}")
    tags: List[str] = Field(default_factory=list)
    path: Optional[str] = Field(default=None, max_length=400, description="Where the note lives, e.g. 'web/handoffs/login.md'")


class IngestResponse(BaseModel):
    neuron_ids: List[str]
    count: int


class IngestBatchRequest(BaseModel):
    notes: List[IngestRequest] = Field(..., min_length=1, max_length=200)


class IngestBatchResponse(BaseModel):
    notes: List[IngestResponse]
    count: int


class QueryRequest(BaseModel):
    text: str = Field(..., min_length=1, max_length=2000)
    top_k: int = Field(default=8, ge=1, le=20)


class QueryHit(BaseModel):
    id: str
    label: str
    region: Region
    score: float
    position: Tuple[float, float, float]


class QueryResponse(BaseModel):
    query_id: str
    hits: List[QueryHit]


class GraphNodeDTO(BaseModel):
    """Lightweight node for GET /graph (no datetimes, no metadata)."""
    id: str
    label: str
    region: Region
    x: float
    y: float
    z: float
    size: float
    color: str


class GraphEdgeDTO(BaseModel):
    source: str
    target: str
    weight: float
    type: EdgeType


class GraphResponse(BaseModel):
    nodes: List[GraphNodeDTO]
    edges: List[GraphEdgeDTO]
    total_neurons: int
    detail: str


class HookEventRequest(BaseModel):
    hook_type: str = Field(..., description="file_read | file_search | file_edit | agent_launch | command | session")
    tool_name: str = Field(default="")
    summary: str = Field(default="", description="Short human summary, e.g. 'Read: src/auth.py'")
    cwd: str = Field(default="")
    extra: Dict[str, Any] = Field(default_factory=dict)
    # live activity (all optional: old hook handlers keep working)
    client: str = Field(default="claude-code", max_length=40,
                        description="which agent sent it: claude-code | cursor | codex | gemini | aider | ...")
    event: str = Field(default="PostToolUse", description="hook event name (Claude Code vocabulary)")
    session_id: str = Field(default="")
    agent_id: str = Field(default="", description="subagent id; empty = main agent")
    agent_type: str = Field(default="")
    action: str = Field(default="", description="busca | lee | edita | crea | git | commit | compila | prueba | script | agente | espera | piensa | fin")
    target: str = Field(default="", description="file, pattern or command the action is about")
    lines_added: int = Field(default=0, ge=0)
    lines_removed: int = Field(default=0, ge=0)


class HookEventResponse(BaseModel):
    ok: bool
    neuron_id: str = Field(default="", description="empty for session events (no neuron)")
    region: Optional[Region] = None
    recycled: bool = False
    note_id: Optional[str] = None


class RegionInfo(BaseModel):
    region: Region
    neuron_count: int
    color: str
    center: Tuple[float, float, float]
    radii: Tuple[float, float, float]


class GitCommitRequest(BaseModel):
    message: Optional[str] = None


class GitCommitResponse(BaseModel):
    commit_hash: str
    message: str


class GitRestoreRequest(BaseModel):
    commit_hash: str = Field(..., min_length=7)


class GitRestoreResponse(BaseModel):
    ok: bool
    commit_hash: str


class GitLogEntry(BaseModel):
    hash: str
    message: str
    committed_at: str


class StatsResponse(BaseModel):
    total_neurons: int
    total_edges: int
    total_events: int
    phase: Phase


class FiberDTO(BaseModel):
    """A long-range fiber with both endpoint positions (for Fibers.tsx)."""
    source: str
    target: str
    start: Tuple[float, float, float]
    end: Tuple[float, float, float]
    weight: float

"""Pydantic request / response models."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

NodeType = Literal["concept", "fact"]


class IngestMetadata(BaseModel):
    type: NodeType = "fact"
    tags: list[str] = Field(default_factory=list, max_length=16)
    title: str | None = Field(default=None, max_length=120)
    source: str | None = Field(default=None, max_length=500)

    @field_validator("type", mode="before")
    @classmethod
    def _normalize_type(cls, v: Any) -> str:
        v = str(v or "fact").strip().lower()
        return v if v in {"concept", "fact"} else "fact"

    @field_validator("tags")
    @classmethod
    def _clean_tags(cls, tags: list[str]) -> list[str]:
        out: list[str] = []
        for t in tags:
            t = " ".join(str(t).split()).strip().lower()[:40]
            if t and t not in out:
                out.append(t)
        return out


class IngestRequest(BaseModel):
    content: str = Field(min_length=1, max_length=20_000)
    metadata: IngestMetadata = Field(default_factory=IngestMetadata)

    @field_validator("content")
    @classmethod
    def _strip(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("content must not be blank")
        return v


class IngestResponse(BaseModel):
    node_id: str
    connections: int
    created: bool = True
    concepts: list[str] = Field(default_factory=list)


class QueryRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2_000)
    animate: bool = True


class Position(BaseModel):
    x: float
    y: float
    z: float


class GraphNode(BaseModel):
    id: str
    label: str
    type: NodeType
    content: str = ""
    tags: list[str] = Field(default_factory=list)
    position: Position
    size: float
    degree: int = 0
    created_at: float | None = None


class GraphEdge(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    from_: str = Field(alias="from")
    to: str
    weight: float
    kind: str = "semantic"


class GraphStats(BaseModel):
    nodes: int
    edges: int
    concepts: int
    facts: int


class GraphResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    stats: GraphStats


class ThinkingEvent(BaseModel):
    """Shape of every SSE `data:` payload emitted by POST /api/query."""

    type: Literal["search", "connect", "token", "synthesize", "error", "done"]
    data: dict[str, Any]
    timestamp: float


class ResetResponse(BaseModel):
    ok: bool = True
    message: str = "Brain wiped"


class SeedResponse(BaseModel):
    ingested: int
    stats: GraphStats


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    llm: bool
    model: str
    embeddings: str
    vector_store: str
    stats: GraphStats

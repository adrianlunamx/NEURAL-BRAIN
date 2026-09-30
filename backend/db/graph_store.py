"""Knowledge graph (NetworkX) with cached 3D layout and JSON persistence."""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any

import networkx as nx

from utils.graph_layout import compute_3d_layout
from utils.logger import logger

NODE_TYPES = {"concept", "fact"}


class GraphStore:
    def __init__(self, path: Path, layout_iterations: int = 100):
        self.path = Path(path)
        self.layout_iterations = layout_iterations
        self.graph = nx.Graph()
        self._positions: dict[str, dict[str, float]] = {}
        self._dirty = True
        self._load()

    # ── persistence ──────────────────────────────────────────────
    def _load(self) -> None:
        if not self.path.exists():
            return
        try:
            raw = json.loads(self.path.read_text())
            self.graph = nx.node_link_graph(raw["graph"], edges="links")
            self._positions = raw.get("positions", {})
            self._dirty = set(self._positions) != set(self.graph.nodes)
            logger.info("Graph loaded: {} nodes, {} edges", self.graph.number_of_nodes(), self.graph.number_of_edges())
        except Exception as exc:
            logger.error("Could not load graph snapshot {} ({}); starting empty", self.path, exc)
            self.graph = nx.Graph()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"graph": nx.node_link_data(self.graph, edges="links"), "positions": self._positions}
        tmp = self.path.with_suffix(".tmp")
        tmp.write_text(json.dumps(payload))
        tmp.replace(self.path)

    def reset(self) -> None:
        self.graph = nx.Graph()
        self._positions = {}
        self._dirty = True
        if self.path.exists():
            self.path.unlink()

    # ── mutation ─────────────────────────────────────────────────
    def has_node(self, node_id: str) -> bool:
        return self.graph.has_node(node_id)

    def add_node(self, node_id: str, *, label: str, type: str, content: str, tags: list[str] | None = None,
                 **extra: Any) -> None:
        if type not in NODE_TYPES:
            type = "fact"
        self.graph.add_node(node_id, label=label, type=type, content=content, tags=list(tags or []), **extra)
        self._dirty = True

    def add_edge(self, a: str, b: str, weight: float, kind: str = "semantic") -> bool:
        if a == b or not (self.graph.has_node(a) and self.graph.has_node(b)):
            return False
        weight = float(max(0.05, min(1.0, weight)))
        if self.graph.has_edge(a, b):
            self.graph[a][b]["weight"] = max(self.graph[a][b]["weight"], weight)
            return False
        self.graph.add_edge(a, b, weight=weight, kind=kind)
        self._dirty = True
        return True

    # ── queries ──────────────────────────────────────────────────
    def node(self, node_id: str) -> dict[str, Any] | None:
        if not self.graph.has_node(node_id):
            return None
        return {"id": node_id, **self.graph.nodes[node_id], "degree": self.graph.degree(node_id)}

    def positions(self) -> dict[str, dict[str, float]]:
        if self._dirty:
            self._positions = compute_3d_layout(self.graph, self.layout_iterations, previous=self._positions)
            self._dirty = False
            self.save()
        return self._positions

    def node_size(self, node_id: str) -> float:
        data = self.graph.nodes[node_id]
        degree = self.graph.degree(node_id)
        base = 0.7 if data.get("type") == "concept" else 0.45
        return round(min(base + 0.06 * degree, 1.5), 3)

    def find_connections(self, node_ids: list[str], max_hops: int = 3) -> dict[str, Any]:
        """Paths linking the retrieved nodes, ordered for a cascading animation.

        Returns `{"paths": [[id,...]], "edges": [{from,to,weight}], "bridges": [id,...]}`
        where `bridges` are intermediate nodes that were not retrieved directly.
        """
        present = [n for n in dict.fromkeys(node_ids) if self.graph.has_node(n)]
        paths: list[list[str]] = []
        for a, b in itertools.combinations(present, 2):
            try:
                path = nx.shortest_path(self.graph, a, b)
            except nx.NetworkXNoPath:
                continue
            if len(path) - 1 <= max_hops:
                paths.append(path)
        paths.sort(key=len)

        edges: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for path in paths:
            for u, v in zip(path, path[1:]):
                key = tuple(sorted((u, v)))
                if key in seen:
                    continue
                seen.add(key)
                edges.append({"from": u, "to": v, "weight": self.graph[u][v]["weight"]})

        wanted = set(present)
        bridges = [n for n in dict.fromkeys(itertools.chain.from_iterable(paths)) if n not in wanted]
        return {"paths": paths, "edges": edges, "bridges": bridges}

    def to_payload(self) -> dict[str, Any]:
        pos = self.positions()
        nodes = []
        for node_id, data in self.graph.nodes(data=True):
            p = pos.get(node_id, {"x": 0.0, "y": 0.0, "z": 0.0})
            nodes.append({
                "id": node_id,
                "label": data.get("label", node_id),
                "type": data.get("type", "fact"),
                "content": data.get("content", ""),
                "tags": data.get("tags", []),
                "position": p,
                "size": self.node_size(node_id),
                "degree": self.graph.degree(node_id),
                "created_at": data.get("created_at"),
            })
        edges = [
            {"from": u, "to": v, "weight": round(d.get("weight", 0.5), 4), "kind": d.get("kind", "semantic")}
            for u, v, d in self.graph.edges(data=True)
        ]
        return {"nodes": nodes, "edges": edges}

    def stats(self) -> dict[str, int]:
        types = nx.get_node_attributes(self.graph, "type")
        return {
            "nodes": self.graph.number_of_nodes(),
            "edges": self.graph.number_of_edges(),
            "concepts": sum(1 for t in types.values() if t == "concept"),
            "facts": sum(1 for t in types.values() if t == "fact"),
        }

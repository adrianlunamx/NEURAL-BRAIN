"""Knowledge graph (NetworkX) with cached 3D layout and JSON persistence."""

from __future__ import annotations

import itertools
import json
from pathlib import Path
from typing import Any

import networkx as nx

from utils.brain_shape import BrainShapeLayout, lobe
from utils.graph_layout import NEAR_DISTANCE, compute_3d_layout, compute_oval_layout, layout_scale, oval_scale
from utils.logger import logger

NODE_TYPES = {"concept", "fact"}
TYPE_COLORS = {"concept": "#00f5ff", "fact": "#39ff14"}
# bump when a layout algorithm changes so stored positions get recomputed
LAYOUT_VERSION = 3


class GraphStore:
    def __init__(self, path: Path, layout_iterations: int = 200, layout_mode: str = "oval"):
        self.path = Path(path)
        self.layout_iterations = layout_iterations
        self.layout_mode = layout_mode if layout_mode in {"oval", "brain", "force"} else "oval"
        self.brain_layout = BrainShapeLayout()
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
            stale_mode = raw.get("layout_mode") != self.layout_mode or raw.get("layout_version") != LAYOUT_VERSION
            self._dirty = stale_mode or set(self._positions) != set(self.graph.nodes)
            logger.info("Graph loaded: {} nodes, {} edges", self.graph.number_of_nodes(), self.graph.number_of_edges())
        except Exception as exc:
            logger.error("Could not load graph snapshot {} ({}); starting empty", self.path, exc)
            self.graph = nx.Graph()

    def save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "graph": nx.node_link_data(self.graph, edges="links"),
            "positions": self._positions,
            "layout_mode": self.layout_mode,
            "layout_version": LAYOUT_VERSION,
        }
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

    @property
    def scale(self) -> float:
        n = self.graph.number_of_nodes()
        return oval_scale(n) if self.layout_mode == "oval" else layout_scale(n)

    def positions(self) -> dict[str, dict]:
        if self._dirty:
            if self.layout_mode == "brain":
                self._positions = self.brain_layout.compute(self.graph, self.scale, previous=self._positions)
            elif self.layout_mode == "oval":
                self._positions = compute_oval_layout(self.graph, self.layout_iterations, previous=self._positions)
            else:
                self._positions = compute_3d_layout(self.graph, self.layout_iterations, previous=self._positions)
            self._dirty = False
            self.save()
        return self._positions

    def node_size(self, node_id: str) -> float:
        data = self.graph.nodes[node_id]
        degree = self.graph.degree(node_id)
        if self.layout_mode == "oval":  # near-uniform 0.3-0.5
            return round(min(0.3 + 0.025 * degree, 0.5), 3)
        base = 0.5 if data.get("type") == "concept" else 0.35
        return round(min(base + 0.04 * degree, 1.0), 3)

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
            node_type = data.get("type", "fact")
            nodes.append({
                "id": node_id,
                "label": data.get("label", node_id),
                "type": node_type,
                "color": TYPE_COLORS.get(node_type, TYPE_COLORS["fact"]),
                "region": p.get("region"),
                "lobe": lobe(p["region"]) if p.get("region") else None,
                "content": data.get("content", ""),
                "tags": data.get("tags", []),
                "position": {"x": p["x"], "y": p["y"], "z": p["z"]},
                "size": self.node_size(node_id),
                "degree": self.graph.degree(node_id),
                "created_at": data.get("created_at"),
            })
        near = NEAR_DISTANCE * self.scale / 12.0

        def dist(u: str, v: str) -> float:
            a, b = pos.get(u), pos.get(v)
            if not a or not b:
                return 0.0
            return ((a["x"] - b["x"]) ** 2 + (a["y"] - b["y"]) ** 2 + (a["z"] - b["z"]) ** 2) ** 0.5

        edges = [
            {
                "from": u,
                "to": v,
                "weight": round(d.get("weight", 0.5), 4),
                "kind": d.get("kind", "semantic"),
                "range": BrainShapeLayout.edge_range(pos.get(u, {}).get("region"), pos.get(v, {}).get("region"))
                if self.layout_mode == "brain" else "local",
                "distance": round(dist(u, v), 3),
                # idle view draws only short synapses; long ones appear when they carry a thought
                "near": dist(u, v) < near,
            }
            for u, v, d in self.graph.edges(data=True)
        ]
        brain = None
        if self.layout_mode == "brain":
            brain = {"scale": round(self.scale, 3), "shell": self._shell()}
        return {"nodes": nodes, "edges": edges, "layout": self.layout_mode, "brain": brain}

    def _shell(self) -> list[list[float]]:
        scale = round(self.scale, 3)
        if getattr(self, "_shell_cache", (None,))[0] != scale:
            self._shell_cache = (scale, BrainShapeLayout.shell_points(scale))
        return self._shell_cache[1]

    def stats(self) -> dict[str, int]:
        types = nx.get_node_attributes(self.graph, "type")
        return {
            "nodes": self.graph.number_of_nodes(),
            "edges": self.graph.number_of_edges(),
            "concepts": sum(1 for t in types.values() if t == "concept"),
            "facts": sum(1 for t in types.values() if t == "fact"),
        }

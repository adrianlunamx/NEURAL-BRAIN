"""Anatomical 3D graph store for Neural Brain.

- Seeds MAX_NEURONS (19,000) neurons distributed inside 8 ellipsoids that form
  the 6 brain regions (lateral-view brain shape).
- Stratified render order: region proportions are preserved in every prefix of
  the order, so LOD levels (1k/5k/12k/19k) always show a representative brain.
- Long-range FIBER edges model the corpus callosum (inter-regional bundles).
- Thread-safe: hooks and the git auto-commit loop write from other threads.
"""
from __future__ import annotations

import json
import math
import random
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import networkx as nx

from .models import EdgeType, NeuronNode, Phase, Region, SynapseEdge

MAX_NEURONS = 19000

LOD_LEVELS: Dict[str, int] = {
    "low": 1000,
    "medium": 5000,
    "high": 12000,
    "ultra": 19000,
}

# Ellipsoids per region. Axes: x = front(+) / back(-), y = up(+) / down(-),
# z = right(+) / left(-). Units are arbitrary scene units; the brain spans
# roughly x in [-6, 7], y in [-4.6, 4.4].
REGION_ELLIPSOIDS: Dict[Region, List[Dict[str, Tuple[float, float, float]]]] = {
    Region.FRONTAL: [
        {"center": (4.0, 1.0, 0.0), "radii": (2.6, 2.4, 2.2)},
    ],
    Region.PARIETAL: [
        {"center": (0.2, 2.4, 0.0), "radii": (2.2, 1.8, 2.0)},
    ],
    Region.TEMPORAL: [
        {"center": (0.8, -1.4, 1.9), "radii": (1.6, 1.2, 1.0)},
        {"center": (0.8, -1.4, -1.9), "radii": (1.6, 1.2, 1.0)},
    ],
    Region.OCCIPITAL: [
        {"center": (-4.2, 0.8, 0.0), "radii": (1.8, 2.0, 1.8)},
    ],
    Region.HIPPOCAMPUS: [
        {"center": (-0.5, -0.6, 0.7), "radii": (1.1, 0.6, 0.5)},
        {"center": (-0.5, -0.6, -0.7), "radii": (1.1, 0.6, 0.5)},
    ],
    Region.CEREBELLUM: [
        {"center": (-3.4, -3.2, 0.0), "radii": (1.9, 1.4, 1.6)},
    ],
}

# Neuron budget per region. Must sum to MAX_NEURONS.
REGION_BUDGET: Dict[Region, int] = {
    Region.FRONTAL: 5200,
    Region.PARIETAL: 3600,
    Region.TEMPORAL: 4200,
    Region.OCCIPITAL: 2400,
    Region.HIPPOCAMPUS: 1600,
    Region.CEREBELLUM: 2000,
}

REGION_COLORS: Dict[Region, str] = {
    Region.FRONTAL: "#4da3ff",
    Region.PARIETAL: "#8a63ff",
    Region.TEMPORAL: "#3ddc97",
    Region.OCCIPITAL: "#ff9f43",
    Region.HIPPOCAMPUS: "#ff4d6d",
    Region.CEREBELLUM: "#4dd2ff",
}

# (region_a, region_b, fiber_count): long-range bundles (corpus callosum style).
FIBER_PAIRS: List[Tuple[Region, Region, int]] = [
    (Region.FRONTAL, Region.PARIETAL, 70),
    (Region.FRONTAL, Region.TEMPORAL, 50),
    (Region.PARIETAL, Region.OCCIPITAL, 50),
    (Region.HIPPOCAMPUS, Region.FRONTAL, 40),
    (Region.TEMPORAL, Region.OCCIPITAL, 30),
]


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _region(value) -> Region:
    return value if isinstance(value, Region) else Region(value)


class GraphStore:
    def __init__(self, seed: int = 42) -> None:
        self.graph: nx.DiGraph = nx.DiGraph()
        self.lock = threading.RLock()
        self.rng = random.Random(seed)
        self.event_count: int = 0
        self.phase: Phase = Phase.IDLE
        # Stratified render order: list of neuron ids, region-interleaved.
        self.render_order: List[str] = []
        # Per-region id lists for fast sampling.
        self.region_index: Dict[Region, List[str]] = {r: [] for r in Region}

    # ------------------------------------------------------------------
    # Layout helpers
    # ------------------------------------------------------------------
    def _sample_in_ellipsoid(
        self, center: Tuple[float, float, float], radii: Tuple[float, float, float]
    ) -> Tuple[float, float, float]:
        """Uniform random point inside an ellipsoid (gaussian direction + cbrt radius)."""
        v = [self.rng.gauss(0.0, 1.0) for _ in range(3)]
        norm = math.sqrt(sum(c * c for c in v)) or 1.0
        direction = [c / norm for c in v]
        r = self.rng.random() ** (1.0 / 3.0)
        return tuple(center[i] + direction[i] * r * radii[i] for i in range(3))  # type: ignore[return-value]

    def _sample_position(self, region: Region) -> Tuple[float, float, float]:
        ellipsoids = REGION_ELLIPSOIDS[region]
        chosen = ellipsoids[self.rng.randrange(len(ellipsoids))]
        return self._sample_in_ellipsoid(chosen["center"], chosen["radii"])

    def _sample_neighbors(self, region: Region, exclude: str, k: int) -> List[str]:
        """k distinct same-region ids != exclude, without copying the whole region list."""
        ids = self.region_index[region]
        if len(ids) <= 1:
            return []
        k = min(k, len(ids) - 1)
        chosen: set = set()
        while len(chosen) < k:
            candidate = ids[self.rng.randrange(len(ids))]
            if candidate != exclude:
                chosen.add(candidate)
        return list(chosen)

    # ------------------------------------------------------------------
    # Seeding
    # ------------------------------------------------------------------
    def seed_brain(self) -> int:
        """Create MAX_NEURONS neurons with local edges + inter-regional fibers."""
        with self.lock:
            if self.graph.number_of_nodes() > 0:
                return self.graph.number_of_nodes()
            counter = 0
            for region, budget in REGION_BUDGET.items():
                for _ in range(budget):
                    counter += 1
                    neuron_id = f"n_{counter:05d}"
                    pos = self._sample_position(region)
                    node = NeuronNode(
                        id=neuron_id,
                        label=f"{region.value} neuron {counter}",
                        region=region,
                        position=pos,
                        size=round(self.rng.uniform(0.7, 1.3), 2),
                        color=REGION_COLORS[region],
                        source="seed",
                    )
                    self.graph.add_node(neuron_id, **node.model_dump())
                    self.region_index[region].append(neuron_id)
            self._build_local_edges()
            self._build_fibers()
            self._build_render_order()
            return self.graph.number_of_nodes()

    def _build_local_edges(self) -> None:
        """Connect every neuron to 2 random same-region neighbors (local circuitry)."""
        for region, ids in self.region_index.items():
            if len(ids) < 3:
                continue
            for neuron_id in ids:
                for target in self._sample_neighbors(region, neuron_id, 2):
                    if not self.graph.has_edge(neuron_id, target):
                        edge = SynapseEdge(
                            source=neuron_id,
                            target=target,
                            weight=round(self.rng.uniform(0.2, 0.7), 2),
                            type=EdgeType.LOCAL,
                        )
                        self.graph.add_edge(neuron_id, target, **edge.model_dump())

    def _build_fibers(self) -> None:
        """Long-range inter-regional fibers (corpus callosum style bundles)."""
        for region_a, region_b, count in FIBER_PAIRS:
            ids_a = self.region_index[region_a]
            ids_b = self.region_index[region_b]
            if not ids_a or not ids_b:
                continue
            for _ in range(count):
                a = self.rng.choice(ids_a)
                b = self.rng.choice(ids_b)
                edge = SynapseEdge(
                    source=a, target=b,
                    weight=round(self.rng.uniform(0.7, 1.0), 2),
                    type=EdgeType.FIBER,
                )
                self.graph.add_edge(a, b, **edge.model_dump())

    def _build_render_order(self) -> None:
        """Interleave per-region shuffled ids proportionally, so every prefix is stratified.

        Each region advances at a rate proportional to its size (largest-remainder
        scheduling), so any prefix of N ids holds each region in its budget share.
        """
        shuffled = {r: ids[:] for r, ids in self.region_index.items()}
        for ids in shuffled.values():
            self.rng.shuffle(ids)
        total = sum(len(ids) for ids in shuffled.values())
        taken = {r: 0 for r in Region}
        order: List[str] = []
        for step in range(1, total + 1):
            # region furthest behind its proportional quota goes next
            region = max(
                (r for r in Region if taken[r] < len(shuffled[r])),
                key=lambda r: len(shuffled[r]) * step / total - taken[r],
            )
            order.append(shuffled[region][taken[region]])
            taken[region] += 1
        self.render_order = order

    # ------------------------------------------------------------------
    # Mutation API
    # ------------------------------------------------------------------
    def add_neuron(
        self,
        label: str,
        region: Region,
        source: str = "ingest",
        embedding_ref: Optional[str] = None,
        metadata: Optional[dict] = None,
        position: Optional[Tuple[float, float, float]] = None,
    ) -> Tuple[str, bool]:
        """Add a neuron; when the brain is full, recycle the stalest one.

        Returns (neuron_id, recycled).
        """
        with self.lock:
            recycled = False
            if self.graph.number_of_nodes() >= MAX_NEURONS:
                neuron_id = self._pick_recycle_candidate()
                recycled = True
            else:
                neuron_id = f"{source[0]}h_{uuid.uuid4().hex[:6]}"
            pos = position or self._sample_position(region)
            node = NeuronNode(
                id=neuron_id,
                label=label,
                region=region,
                position=pos,
                size=round(self.rng.uniform(0.9, 1.4), 2),
                color=REGION_COLORS[region],
                source=source,  # type: ignore[arg-type]
                embedding_ref=embedding_ref,
                metadata=metadata or {},
            )
            if recycled:
                old_region = _region(self.graph.nodes[neuron_id]["region"])
                if neuron_id in self.region_index[old_region]:
                    self.region_index[old_region].remove(neuron_id)
                for pred in list(self.graph.predecessors(neuron_id)):
                    self.graph.remove_edge(pred, neuron_id)
                for succ in list(self.graph.successors(neuron_id)):
                    self.graph.remove_edge(neuron_id, succ)
                self.graph.nodes[neuron_id].update(node.model_dump())
                # keeps its slot in render_order, so LOD indices stay stable
            else:
                self.graph.add_node(neuron_id, **node.model_dump())
                self.render_order.append(neuron_id)
            self.region_index[region].append(neuron_id)
            # wire to 2 same-region neighbors so it is never isolated
            for target in self._sample_neighbors(region, neuron_id, 2):
                edge = SynapseEdge(source=neuron_id, target=target,
                                   weight=round(self.rng.uniform(0.4, 0.8), 2))
                self.graph.add_edge(neuron_id, target, **edge.model_dump())
            self.event_count += 1
            return neuron_id, recycled

    def _pick_recycle_candidate(self) -> str:
        """Least-recently-activated seed neuron (never recycle hook/ingest/query nodes)."""
        candidates = [
            (n, d) for n, d in self.graph.nodes(data=True)
            if d.get("source") == "seed"
        ]
        if not candidates:
            candidates = list(self.graph.nodes(data=True))
        candidates.sort(key=lambda nd: str(nd[1].get("last_activated_at") or "1970-01-01"))
        return candidates[0][0]

    def connect(self, source: str, target: str,
                weight: float = 0.6, edge_type: EdgeType = EdgeType.LOCAL) -> bool:
        with self.lock:
            if source not in self.graph or target not in self.graph:
                return False
            edge = SynapseEdge(source=source, target=target, weight=weight, type=edge_type)
            self.graph.add_edge(source, target, **edge.model_dump())
            self.event_count += 1
            return True

    def activate(self, neuron_id: str, amount: float = 1.0) -> bool:
        """Set activation (clamped 0..1) and stamp last_activated_at."""
        with self.lock:
            if neuron_id not in self.graph:
                return False
            node = self.graph.nodes[neuron_id]
            node["activation"] = max(0.0, min(1.0, amount))
            node["last_activated_at"] = _utcnow().isoformat()
            node["color_state"] = "active" if amount > 0.05 else "base"
            self.event_count += 1
            return True

    def set_phase(self, phase: Phase) -> None:
        with self.lock:
            self.phase = phase

    # ------------------------------------------------------------------
    # LOD reads
    # ------------------------------------------------------------------
    def get_visible_nodes(self, detail: str = "high") -> List[dict]:
        """First N of the stratified render order (N by LOD level)."""
        count = LOD_LEVELS.get(detail, LOD_LEVELS["high"])
        with self.lock:
            ids = self.render_order[:count]
            return [self._node_dto(nid) for nid in ids if nid in self.graph]

    def get_visible_edges(self, node_ids: List[str], max_edges: int = 8000) -> List[dict]:
        """Edges whose both ends are visible, fibers first, capped."""
        wanted = set(node_ids)
        collected: List[dict] = []
        fibers: List[dict] = []
        with self.lock:
            for u, v, d in self.graph.edges(data=True):
                if u in wanted and v in wanted:
                    dto = {
                        "source": u, "target": v,
                        "weight": float(d.get("weight", 0.5)),
                        "type": d.get("type", EdgeType.LOCAL),
                    }
                    if dto["type"] == EdgeType.FIBER:
                        fibers.append(dto)
                    else:
                        collected.append(dto)
        ordered = fibers + collected
        return ordered[:max_edges]

    def get_region_info(self) -> List[dict]:
        with self.lock:
            infos = []
            for region in Region:
                ellipsoids = REGION_ELLIPSOIDS[region]
                cx = sum(e["center"][0] for e in ellipsoids) / len(ellipsoids)
                cy = sum(e["center"][1] for e in ellipsoids) / len(ellipsoids)
                cz = sum(e["center"][2] for e in ellipsoids) / len(ellipsoids)
                rx = max(e["radii"][0] for e in ellipsoids)
                ry = max(e["radii"][1] for e in ellipsoids)
                rz = max(e["radii"][2] for e in ellipsoids)
                infos.append({
                    "region": region.value,
                    "neuron_count": len(self.region_index[region]),
                    "color": REGION_COLORS[region],
                    "center": (cx, cy, cz),
                    "radii": (rx, ry, rz),
                })
            return infos

    def get_fiber_endpoints(self) -> List[Tuple[Tuple[float, float, float],
                                                Tuple[float, float, float]]]:
        """Position pairs for every FIBER edge."""
        return [(f["start"], f["end"]) for f in self.get_fibers()]

    def get_fibers(self) -> List[dict]:
        """Every FIBER edge with endpoint positions (used by GET /fibers → Fibers.tsx)."""
        fibers = []
        with self.lock:
            for u, v, d in self.graph.edges(data=True):
                if d.get("type") == EdgeType.FIBER and u in self.graph and v in self.graph:
                    fibers.append({
                        "source": u,
                        "target": v,
                        "start": tuple(float(c) for c in self.graph.nodes[u]["position"]),
                        "end": tuple(float(c) for c in self.graph.nodes[v]["position"]),
                        "weight": float(d.get("weight", 0.8)),
                    })
        return fibers

    def _node_dto(self, neuron_id: str) -> dict:
        d = self.graph.nodes[neuron_id]
        x, y, z = d["position"]
        return {
            "id": neuron_id,
            "label": d.get("label", ""),
            "region": d.get("region"),
            "x": float(x), "y": float(y), "z": float(z),
            "size": float(d.get("size", 1.0)),
            "color": d.get("color", "#4da3ff"),
        }

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------
    def serialize(self) -> dict:
        """Full graph snapshot as JSON-serializable dict."""
        with self.lock:
            nodes = []
            for nid, d in self.graph.nodes(data=True):
                nodes.append({
                    "id": nid,
                    "label": d.get("label", ""),
                    "region": _region(d.get("region")).value,
                    "position": [round(float(c), 4) for c in d["position"]],
                    "size": float(d.get("size", 1.0)),
                    "color": d.get("color", "#4da3ff"),
                    "activation": float(d.get("activation", 0.0)),
                    "embedding_ref": d.get("embedding_ref"),
                    "source": d.get("source", "seed"),
                    "created_at": str(d.get("created_at", "")),
                    "metadata": d.get("metadata", {}),
                })
            edges = [
                {"source": u, "target": v, "weight": float(dd.get("weight", 0.5)),
                 "type": EdgeType(dd.get("type", EdgeType.LOCAL)).value}
                for u, v, dd in self.graph.edges(data=True)
            ]
            return {
                "version": 1,
                "exported_at": _utcnow().isoformat(),
                "event_count": self.event_count,
                "nodes": nodes,
                "edges": edges,
                "render_order": self.render_order,
            }

    def deserialize(self, data: dict) -> None:
        """Replace the in-memory graph from a snapshot dict."""
        with self.lock:
            graph: nx.DiGraph = nx.DiGraph()
            region_index: Dict[Region, List[str]] = {r: [] for r in Region}
            for n in data.get("nodes", []):
                nid = n["id"]
                graph.add_node(nid, **{
                    "label": n.get("label", ""),
                    "region": n.get("region"),
                    "position": tuple(n["position"]),
                    "size": n.get("size", 1.0),
                    "color": n.get("color", "#4da3ff"),
                    "color_state": "base",
                    "activation": n.get("activation", 0.0),
                    "embedding_ref": n.get("embedding_ref"),
                    "source": n.get("source", "seed"),
                    "created_at": n.get("created_at", ""),
                    "last_activated_at": None,
                    "metadata": n.get("metadata", {}),
                })
                try:
                    region_index[Region(n["region"])].append(nid)
                except ValueError:
                    pass
            for e in data.get("edges", []):
                if e["source"] in graph and e["target"] in graph:
                    graph.add_edge(e["source"], e["target"],
                                   weight=e.get("weight", 0.5),
                                   type=EdgeType(e.get("type", EdgeType.LOCAL)),
                                   created_at=_utcnow().isoformat())
            self.graph = graph
            self.region_index = region_index
            self.render_order = [nid for nid in data.get("render_order", [])
                                 if nid in graph]
            # any node missing from the order gets appended (keeps LOD working)
            ordered = set(self.render_order)
            self.render_order.extend(n for n in graph.nodes if n not in ordered)
            self.event_count = int(data.get("event_count", 0))

    def save_json(self, path: Path) -> None:
        path.write_text(json.dumps(self.serialize(), separators=(",", ":")), encoding="utf-8")

    def load_json(self, path: Path) -> bool:
        if not path.exists():
            return False
        self.deserialize(json.loads(path.read_text(encoding="utf-8")))
        return True

    # ------------------------------------------------------------------
    # Stats
    # ------------------------------------------------------------------
    def stats(self) -> dict:
        with self.lock:
            return {
                "total_neurons": self.graph.number_of_nodes(),
                "total_edges": self.graph.number_of_edges(),
                "total_events": self.event_count,
                "phase": self.phase.value,
            }

"""Anatomical 3D graph store for Neural Brain.

- v2: seeds MAX_NEURONS (19,000) neurons from the anatomical layout in
  backend/brain_layout.py: ONE brain in lateral view (signed distance field),
  regions are coloured zones of that volume. v1 snapshots (6 ellipsoids) are
  migrated on load: every neuron keeps id/region/label/edges, only moves.
- Stratified render order: region proportions are preserved in every prefix of
  the order, so LOD levels (1k/5k/12k/19k) always show a representative brain.
- Long-range FIBER edges model the corpus callosum (inter-regional bundles).
- Thread-safe: hooks and the git auto-commit loop write from other threads.
"""
from __future__ import annotations

import heapq
import json
import math
import random
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import networkx as nx
import numpy as np

from .models import EdgeType, NeuronNode, Phase, Region, SynapseEdge

try:  # backend/ is a package when the app runs as backend.app.main
    from ..brain_layout import load_into_graphstore, sample_region
except ImportError:  # pragma: no cover - running with backend/ on sys.path
    from brain_layout import load_into_graphstore, sample_region  # type: ignore[no-redef]

# 1 = six separate ellipsoids, 2 = anatomical brain layout, 3 = v3 brain shape
# (hemispheres, temporal lobe, notched cerebellum): older snapshots are re-laid out.
SNAPSHOT_VERSION = 3

MAX_NEURONS = 19000

LOD_LEVELS: Dict[str, int] = {
    "low": 1000,
    "medium": 5000,
    "high": 12000,
    "ultra": 19000,
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
        self.np_rng = np.random.default_rng(seed)
        # FIX (review #3): lazy min-heap of (last_activated_key, neuron_id)
        # for recycle picks. INVARIANT: entries may be STALE — a neuron can be
        # re-activated, recycled, or replaced after its entry was pushed.
        # _pick_recycle_candidate() validates every popped entry against the
        # live node and re-pushes a corrected entry when stale, so the heap
        # converges with NO eager updates on the hot activate() path.
        self._recycle_heap: List[Tuple[str, str]] = []
        self._recycle_heap_seed_only: bool = True
        # bumps whenever notes (ingest/query neurons) change; the /notes view caches on it
        self.notes_version: int = 0

    # ------------------------------------------------------------------
    # Layout helpers
    # ------------------------------------------------------------------
    def _sample_position(self, region: Region) -> Tuple[float, float, float]:
        """A point inside the brain that belongs to `region` (SDF rejection sampling)."""
        p = sample_region(region.value, 1, self.np_rng)[0]
        return (float(p[0]), float(p[1]), float(p[2]))

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
        """v2: seed from the precomputed anatomical layout (backend/brain_layout.json)."""
        with self.lock:
            if self.graph.number_of_nodes() > 0:
                return self.graph.number_of_nodes()
        return load_into_graphstore(self, layout_path="brain_layout.json")

    def seed_from_layout(self, positions, regions) -> int:
        """Create one seed neuron per layout point, then local edges, fibers and LOD order."""
        with self.lock:
            if self.graph.number_of_nodes() > 0:
                return self.graph.number_of_nodes()
            for i, (pos, region_name) in enumerate(zip(positions[:MAX_NEURONS], regions[:MAX_NEURONS]), start=1):
                region = Region(region_name)
                neuron_id = f"n_{i:05d}"
                node = NeuronNode(
                    id=neuron_id,
                    label=f"{region.value} neuron {i}",
                    region=region,
                    position=(float(pos[0]), float(pos[1]), float(pos[2])),
                    size=round(self.rng.uniform(0.7, 1.3), 2),
                    color=REGION_COLORS[region],
                    source="seed",
                )
                self.graph.add_node(neuron_id, **node.model_dump())
                self.region_index[region].append(neuron_id)
            self._build_local_edges()
            self._build_fibers()
            self._build_render_order()
            self._invalidate_recycle_heap()
            return self.graph.number_of_nodes()

    def _relayout(self) -> None:
        """Move every neuron of an older snapshot into the current brain shape (same region)."""
        rng = np.random.default_rng(42)
        for region, ids in self.region_index.items():
            if not ids:
                continue
            points = sample_region(region.value, len(ids), rng)
            for nid, p in zip(ids, points):
                self.graph.nodes[nid]["position"] = (float(p[0]), float(p[1]), float(p[2]))

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
    # Recycle heap (FIX review #3)
    # ------------------------------------------------------------------
    @staticmethod
    def _recycle_key(data) -> str:
        """Heap ordering key: ISO-8601 timestamps sort lexicographically; None -> epoch."""
        return str(data.get("last_activated_at") or "1970-01-01")

    def _invalidate_recycle_heap(self) -> None:
        """Drop the heap; it rebuilds lazily on the next pick (bulk state changed)."""
        self._recycle_heap = []
        self._recycle_heap_seed_only = True

    def _rebuild_recycle_heap(self, seed_only: bool) -> None:
        """Heapify all (or only seed) current nodes by last activation."""
        heap = [
            (self._recycle_key(d), nid)
            for nid, d in self.graph.nodes(data=True)
            if not seed_only or d.get("source") == "seed"
        ]
        heapq.heapify(heap)
        self._recycle_heap = heap
        self._recycle_heap_seed_only = seed_only

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
            if source in ("ingest", "query"):
                self.notes_version += 1
            # wire to 2 same-region neighbors so it is never isolated
            for target in self._sample_neighbors(region, neuron_id, 2):
                edge = SynapseEdge(source=neuron_id, target=target,
                                   weight=round(self.rng.uniform(0.4, 0.8), 2))
                self.graph.add_edge(neuron_id, target, **edge.model_dump())
            self.event_count += 1
            return neuron_id, recycled

    def _pick_recycle_candidate(self) -> str:
        """Least-recently-activated seed neuron (never recycle hook/ingest/query nodes).

        Heap-backed: O(log n) amortized per pick instead of re-sorting ~19k
        candidates on every add_neuron() once the brain is full. Stale entries
        (re-activated / recycled / deleted nodes) are discarded or corrected on
        pop; the lock is held throughout, so the loop always terminates.
        """
        if not self._recycle_heap:
            # First pick after (re)build, or the heap was drained: rebuild from
            # seed nodes; with no seed nodes left, fall back to every node —
            # exactly the old behavior.
            self._rebuild_recycle_heap(seed_only=True)
            if not self._recycle_heap:
                self._rebuild_recycle_heap(seed_only=False)
        while self._recycle_heap:
            key, nid = heapq.heappop(self._recycle_heap)
            if nid not in self.graph:
                continue  # node deleted since the entry was pushed
            data = self.graph.nodes[nid]
            if self._recycle_heap_seed_only and data.get("source") != "seed":
                continue  # already recycled: no longer a seed node
            current = self._recycle_key(data)
            if current != key:
                # Stale entry: the neuron was activated after this entry was
                # pushed. Re-push with the fresh timestamp so it sinks to its
                # correct (later) recycle position.
                heapq.heappush(self._recycle_heap, (current, nid))
                continue
            return nid
        # Defensive: the heap drained without yielding (all entries invalid).
        # Rebuild once from everything and take the top.
        self._rebuild_recycle_heap(seed_only=False)
        if self._recycle_heap:
            return heapq.heappop(self._recycle_heap)[1]
        raise RuntimeError("cannot pick a recycle candidate from an empty graph")

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
        """Center and half-extent of each region, measured from its neurons."""
        with self.lock:
            infos = []
            for region in Region:
                ids = self.region_index[region]
                if ids:
                    pts = np.array([self.graph.nodes[i]["position"] for i in ids], dtype=float)
                    center = tuple(float(c) for c in pts.mean(axis=0))
                    radii = tuple(float(r) for r in (pts.max(axis=0) - pts.min(axis=0)) / 2)
                else:
                    center, radii = (0.0, 0.0, 0.0), (0.0, 0.0, 0.0)
                infos.append({
                    "region": region.value,
                    "neuron_count": len(ids),
                    "color": REGION_COLORS[region],
                    "center": center,
                    "radii": radii,
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
                "version": SNAPSHOT_VERSION,
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
            self._invalidate_recycle_heap()
            self.notes_version += 1
            if int(data.get("version", 1)) < SNAPSHOT_VERSION:
                self._relayout()

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

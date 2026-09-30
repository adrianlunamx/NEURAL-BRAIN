"""Anatomical 3D layout: neurons live inside the shape of a human brain.

Brain-local axes (unit scale, multiplied by `scale` at the end):
    x → front (frontal lobe)   y → up   z → right hemisphere

Knowledge communities (Louvain on the graph) are mapped onto brain regions,
so each lobe holds one area of knowledge and related notes stay together.
Concept hubs sit on the outer cortex; facts sit a little deeper.
"""

from __future__ import annotations

import hashlib
import math
from dataclasses import dataclass

import networkx as nx
import numpy as np

# ── brain surface ─────────────────────────────────────────────────────────

CEREBELLUM_CENTER = np.array([-0.62, -0.46, 0.0])
CEREBELLUM_RADII = np.array([0.30, 0.20, 0.50])
HIPPOCAMPUS_CENTER = np.array([0.02, -0.22, 0.30])  # mirrored for the left side
HIPPOCAMPUS_RADII = np.array([0.20, 0.08, 0.08])


def cortex_radius(u: np.ndarray) -> np.ndarray:
    """Distance from the centre to the cerebral surface along unit directions `u` (n×3)."""
    x, y, z = u[:, 0], u[:, 1], u[:, 2]
    a = np.where(x > 0, 1.0, 0.95)                       # front slightly longer than back
    b = np.where(y > 0, 0.74, 0.52)                      # flat underside
    c = 0.80 * (1 - 0.18 * np.clip(x, 0, 1))             # frontal lobe narrower
    # temporal lobes bulge down and out on each side
    temporal = 0.12 * np.exp(-((x - 0.15) / 0.35) ** 2) * np.clip(-y + 0.1, 0, 1) * np.abs(z)
    r = 1.0 / np.sqrt((x / a) ** 2 + (y / b) ** 2 + (z / c) ** 2)
    # longitudinal fissure between hemispheres (top only)
    fissure = 1 - 0.10 * np.exp(-(z / 0.07) ** 2) * np.clip(y, 0, 1)
    # gyri / sulci: cheap folded-cortex ripple
    folds = 1 + 0.028 * np.sin(13 * x + 5 * y) * np.sin(11 * z + 7 * y) + 0.015 * np.sin(23 * y + 17 * x)
    return r * fissure * folds + temporal


def _unit(v: np.ndarray) -> np.ndarray:
    return v / np.linalg.norm(v, axis=-1, keepdims=True).clip(1e-9)


@dataclass(frozen=True)
class Region:
    name: str
    kind: str                 # "cortex" (patch of the surface) | "blob" (ellipsoid volume)
    capacity: float           # relative share of neurons
    hemi: int = 0             # -1 left, +1 right, 0 both
    center: tuple = (0, 0, 0)  # cortex: direction; blob: position
    spread: float = 0.5        # cortex: cone half-angle (rad)
    radii: tuple = (0.1, 0.1, 0.1)


def _cortex(name: str, direction: tuple, spread: float, capacity: float) -> list[Region]:
    x, y, z = direction
    return [
        Region(f"{name}_left", "cortex", capacity, -1, (x, y, -z), spread),
        Region(f"{name}_right", "cortex", capacity, 1, (x, y, z), spread),
    ]


REGIONS: list[Region] = [
    *_cortex("frontal", (0.85, 0.40, 0.42), 0.55, 1.0),
    *_cortex("parietal", (-0.25, 0.88, 0.42), 0.50, 0.8),
    *_cortex("temporal", (0.20, -0.40, 0.90), 0.42, 0.6),
    *_cortex("occipital", (-0.92, 0.18, 0.40), 0.40, 0.5),
    Region("cerebellum", "blob", 0.5, 0, tuple(CEREBELLUM_CENTER), radii=tuple(CEREBELLUM_RADII)),
    Region("hippocampus", "blob", 0.3, 0, tuple(HIPPOCAMPUS_CENTER), radii=tuple(HIPPOCAMPUS_RADII)),
]
REGION_BY_NAME = {r.name: r for r in REGIONS}


def lobe(region: str) -> str:
    return region.rsplit("_", 1)[0] if region.endswith(("_left", "_right")) else region


# ── layout ────────────────────────────────────────────────────────────────


def _rng_for(node_id: str) -> np.random.Generator:
    seed = int.from_bytes(hashlib.blake2b(node_id.encode(), digest_size=8).digest(), "little")
    return np.random.default_rng(seed)


class BrainShapeLayout:
    def __init__(self, iterations: int = 60):
        self.iterations = iterations

    # regions ------------------------------------------------------------
    def assign_regions(self, graph: nx.Graph) -> dict[str, str]:
        """Louvain communities → brain regions (largest community → largest region)."""
        if graph.number_of_nodes() == 0:
            return {}
        communities = nx.community.louvain_communities(graph, weight="weight", seed=42)
        communities = sorted(communities, key=lambda c: (-len(c), min(c)))
        slots = sorted(REGIONS, key=lambda r: -r.capacity)
        load = {r.name: 0 for r in REGIONS}
        assignment: dict[str, str] = {}
        for i, community in enumerate(communities):
            if i < len(slots):
                region = slots[i]
            else:  # more communities than regions: fill the emptiest region
                region = min(REGIONS, key=lambda r: load[r.name] / r.capacity)
            load[region.name] += len(community)
            for node in community:
                assignment[node] = region.name
        return assignment

    # sampling -----------------------------------------------------------
    def _sample(self, node_id: str, region: Region, node_type: str) -> np.ndarray:
        rng = _rng_for(node_id)
        if region.kind == "blob":
            d = _unit(rng.normal(size=3))
            r = rng.uniform(0.25, 1.0) ** (1 / 3)
            p = np.array(region.center) + d * np.array(region.radii) * r
            if region.name == "hippocampus":  # one per side
                p[2] = abs(p[2]) * (1 if rng.random() < 0.5 else -1)
            return p
        center = _unit(np.array(region.center, dtype=float))
        # random direction inside a cone around the region centre
        for _ in range(20):
            d = _unit(center + rng.normal(scale=math.tan(region.spread) * 0.6, size=3))
            if d[2] * region.hemi > 0.06:
                break
        depth = rng.uniform(0.88, 0.98) if node_type == "concept" else rng.uniform(0.62, 0.9)
        return d * cortex_radius(d[None])[0] * depth

    # public ---------------------------------------------------------------
    def compute(
        self,
        graph: nx.Graph,
        scale: float,
        previous: dict[str, dict] | None = None,
    ) -> dict[str, dict]:
        """Return `{node: {x, y, z, region}}` in world units."""
        nodes = list(graph.nodes)
        if not nodes:
            return {}
        regions = self.assign_regions(graph)
        types = nx.get_node_attributes(graph, "type")
        index = {n: i for i, n in enumerate(nodes)}

        anchors = np.array([self._sample(n, REGION_BY_NAME[regions[n]], types.get(n, "fact")) for n in nodes])
        pos = anchors.copy()
        if previous:  # keep neurons where they were if they stayed in the same region
            for n, i in index.items():
                p = previous.get(n)
                if p and p.get("region") == regions[n]:
                    pos[i] = np.array([p["x"], p["y"], p["z"]]) / scale

        warm = previous is not None and len(previous) > 0
        pos = self._relax(graph, nodes, index, regions, anchors, pos, self.iterations // 3 if warm else self.iterations)
        return {
            n: {
                "x": float(pos[i, 0] * scale),
                "y": float(pos[i, 1] * scale),
                "z": float(pos[i, 2] * scale),
                "region": regions[n],
            }
            for n, i in index.items()
        }

    def _relax(self, graph, nodes, index, regions, anchors, pos, iterations: int) -> np.ndarray:
        """Short force pass: separate neighbours, pull linked notes together, keep the brain shape."""
        n = len(nodes)
        if n < 2:
            return pos
        min_dist = 0.9 / math.sqrt(n) + 0.03
        edges = np.array([(index[u], index[v]) for u, v in graph.edges()], dtype=int).reshape(-1, 2)
        weights = np.array([d.get("weight", 0.5) for _, _, d in graph.edges(data=True)])
        same = np.array([regions[nodes[i]] == regions[nodes[j]] for i, j in edges], dtype=bool)
        hemi = np.array([REGION_BY_NAME[regions[x]].hemi for x in nodes])
        is_cortex = np.array([REGION_BY_NAME[regions[x]].kind == "cortex" for x in nodes])
        iterations = iterations if n <= 1500 else max(10, iterations // 4)

        for _ in range(iterations):
            force = np.zeros_like(pos)
            # repulsion between neurons closer than min_dist
            diff = pos[:, None, :] - pos[None, :, :]
            dist = np.linalg.norm(diff, axis=-1) + np.eye(n)
            push = np.clip(min_dist - dist, 0, None) / dist
            force += (diff * push[..., None]).sum(axis=1) * 0.5
            # springs along synapses (strong inside a region, weak across)
            if len(edges):
                d = pos[edges[:, 1]] - pos[edges[:, 0]]
                length = np.linalg.norm(d, axis=1, keepdims=True).clip(1e-6)
                k = np.where(same, 0.06, 0.008)[:, None] * weights[:, None]
                f = d / length * (length - min_dist * 1.6) * k
                np.add.at(force, edges[:, 0], f)
                np.add.at(force, edges[:, 1], -f)
            # anchor spring keeps each neuron in its lobe
            force += (anchors - pos) * 0.06
            pos = pos + force

            # constraints: stay under the cortex and in the right hemisphere
            u = _unit(pos)
            r = np.linalg.norm(pos, axis=1)
            limit = cortex_radius(u) * 0.99
            over = is_cortex & (r > limit)
            pos[over] = u[over] * limit[over, None]
            wrong = is_cortex & (pos[:, 2] * hemi < 0.05)
            pos[wrong, 2] = 0.05 * hemi[wrong]
        return pos

    # edges ------------------------------------------------------------------
    @staticmethod
    def edge_range(region_a: str | None, region_b: str | None) -> str:
        """`long` for fibres joining different lobes or hemispheres (corpus-callosum-like)."""
        return "local" if region_a == region_b else "long"

    # silhouette ---------------------------------------------------------------
    @staticmethod
    def shell_points(scale: float, count: int = 2400, seed: int = 7) -> list[list[float]]:
        """Points on the cortex, cerebellum and brainstem, for a holographic silhouette."""
        rng = np.random.default_rng(seed)
        n_cortex = int(count * 0.78)
        n_cereb = int(count * 0.14)
        n_stem = count - n_cortex - n_cereb

        d = _unit(rng.normal(size=(n_cortex * 2, 3)))
        d = d[np.abs(d[:, 2]) > 0.035][:n_cortex]  # leave the fissure open
        cortex = d * cortex_radius(d)[:, None]

        e = _unit(rng.normal(size=(n_cereb, 3)))
        cereb = CEREBELLUM_CENTER + e * CEREBELLUM_RADII * (1 + 0.04 * np.sin(40 * e[:, 1:2]))

        t = rng.uniform(0, 1, size=(n_stem, 1))
        ang = rng.uniform(0, 2 * math.pi, size=(n_stem, 1))
        axis = np.array([-0.18, -0.35, 0.0]) + t * np.array([-0.08, -0.55, 0.0])
        ring = np.hstack([np.cos(ang) * 0.09, np.zeros_like(ang), np.sin(ang) * 0.11]) * (1 - 0.3 * t)
        stem = axis + ring

        pts = np.vstack([cortex, cereb, stem]) * scale
        return np.round(pts, 2).tolist()

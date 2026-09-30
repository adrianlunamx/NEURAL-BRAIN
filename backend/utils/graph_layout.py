"""Layouts for the knowledge graph.

- `brain` (default): anatomical layout, see `utils/brain_shape.py`.
- `force`: 3D force-directed layout with type clusters (concepts / facts).
"""

from __future__ import annotations

import math

import networkx as nx
import numpy as np

# Offset between the concept and fact clusters, in layout units (before scaling).
TYPE_OFFSETS = {"fact": np.array([0.45, 0.0, 0.0]), "concept": np.array([-0.15, 0.0, 0.0])}


def layout_scale(n_nodes: int) -> float:
    """Grow the scene with the graph so dense brains don't collapse into a ball."""
    return 15.0 + 1.6 * math.sqrt(max(n_nodes, 1))


def compute_3d_layout(
    graph: nx.Graph,
    iterations: int = 200,
    previous: dict[str, dict[str, float]] | None = None,
    seed: int = 42,
) -> dict[str, dict[str, float]]:
    """Return `{node: {x, y, z}}` using a Fruchterman-Reingold spring layout.

    Wide node spacing (`k`), more iterations, and a per-type offset so
    concepts and facts form two visually distinct clusters. `previous`
    positions seed the simulation so adding a node nudges the graph instead
    of reshuffling it.
    """
    n = graph.number_of_nodes()
    if n == 0:
        return {}
    scale = layout_scale(n)
    if n == 1:
        only = next(iter(graph.nodes))
        return {only: {"x": 0.0, "y": 0.0, "z": 0.0}}

    types = nx.get_node_attributes(graph, "type")
    rng = np.random.default_rng(seed)
    init: dict[str, np.ndarray] | None = None
    if previous:
        init = {}
        for node in graph.nodes:
            if node in previous and "x" in previous[node]:
                p = previous[node]
                init[node] = np.array([p["x"], p["y"], p["z"]]) / scale
        for node in graph.nodes:
            if node in init:
                continue
            placed = [init[nb] for nb in graph.neighbors(node) if nb in init]
            base = np.mean(placed, axis=0) if placed else np.zeros(3)
            init[node] = base + rng.normal(0, 0.15, 3)

    pos = nx.spring_layout(
        graph,
        dim=3,
        pos=init,
        iterations=iterations,
        weight="weight",
        seed=seed,
        k=2.5 / math.sqrt(n),
    )
    coords = np.array([pos[node] + TYPE_OFFSETS.get(types.get(node), 0) for node in graph.nodes])
    coords -= coords.mean(axis=0)
    coords *= scale / max(np.abs(coords).max(), 1e-9)
    return {
        node: {"x": float(c[0]), "y": float(c[1]), "z": float(c[2])}
        for node, c in zip(graph.nodes, coords)
    }


# ── oval: flattened brain seen from above ─────────────────────────────────

OVAL_ASPECT = np.array([1.25, 1.0, 0.4])  # wider than tall, compressed in Z
NEAR_DISTANCE = 8.0                      # idle view only draws synapses shorter than this (at scale 12)


def oval_scale(n_nodes: int) -> float:
    """12 world units for a ~55-neuron brain, growing gently for bigger ones."""
    return 12.0 * max(1.0, math.sqrt(max(n_nodes, 1) / 55))


def compute_oval_layout(
    graph: nx.Graph,
    iterations: int = 200,
    previous: dict[str, dict[str, float]] | None = None,
    seed: int = 42,
) -> dict[str, dict[str, float]]:
    """Force-directed 3D layout squashed into a flat oval (dense centre, sparse rim)."""
    n = graph.number_of_nodes()
    if n == 0:
        return {}
    if n == 1:
        only = next(iter(graph.nodes))
        return {only: {"x": 0.0, "y": 0.0, "z": 0.0}}
    scale = oval_scale(n)

    init = None
    if previous:
        rng = np.random.default_rng(seed)
        init = {}
        for node in graph.nodes:
            p = previous.get(node)
            if p and "x" in p:
                init[node] = np.array([p["x"], p["y"], p["z"]]) / scale / OVAL_ASPECT
        for node in graph.nodes:
            if node not in init:
                placed = [init[nb] for nb in graph.neighbors(node) if nb in init]
                init[node] = (np.mean(placed, axis=0) if placed else np.zeros(3)) + rng.normal(0, 0.1, 3)

    pos = nx.spring_layout(graph, dim=3, pos=init, iterations=iterations, weight="weight", seed=seed,
                           k=2.0 / math.sqrt(n))
    coords = np.array([pos[node] for node in graph.nodes])
    coords -= coords.mean(axis=0)
    if not init and n >= 3:
        # principal axes: widest spread → x, next → y, flattest → z (so squashing keeps the most structure)
        _, _, vt = np.linalg.svd(coords, full_matrices=False)
        coords = coords @ vt.T
    # normalise so the farthest neuron sits on the unit sphere, then squash into the oval
    coords /= max(np.linalg.norm(coords, axis=1).max(), 1e-9)
    coords *= OVAL_ASPECT * scale
    return {node: {"x": float(c[0]), "y": float(c[1]), "z": float(c[2])} for node, c in zip(graph.nodes, coords)}

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

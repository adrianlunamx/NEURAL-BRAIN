"""3D force-directed layout for the knowledge graph."""

from __future__ import annotations

import math

import networkx as nx
import numpy as np


def layout_scale(n_nodes: int) -> float:
    """Grow the scene with the graph so dense brains don't collapse into a ball."""
    return 10.0 + 2.2 * math.sqrt(max(n_nodes, 1))


def compute_3d_layout(
    graph: nx.Graph,
    iterations: int = 100,
    previous: dict[str, dict[str, float]] | None = None,
    seed: int = 42,
) -> dict[str, dict[str, float]]:
    """Return `{node: {x, y, z}}` using a Fruchterman-Reingold spring layout.

    `previous` positions are reused as the starting point so that adding a
    node nudges the brain instead of reshuffling it. New nodes are seeded
    next to the centroid of their already-placed neighbours.
    """
    n = graph.number_of_nodes()
    if n == 0:
        return {}
    scale = layout_scale(n)
    if n == 1:
        only = next(iter(graph.nodes))
        return {only: {"x": 0.0, "y": 0.0, "z": 0.0}}

    rng = np.random.default_rng(seed)
    init: dict[str, np.ndarray] | None = None
    if previous:
        init = {}
        for node in graph.nodes:
            if node in previous:
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
        scale=scale,
        k=1.6 / math.sqrt(n),
    )
    return {
        node: {"x": float(c[0]), "y": float(c[1]), "z": float(c[2])}
        for node, c in pos.items()
    }

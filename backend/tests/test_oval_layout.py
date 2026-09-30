import asyncio

import numpy as np


def test_default_layout_is_a_flattened_oval(brain):
    asyncio.run(brain.seed())
    payload = asyncio.run(brain.graph_payload())
    assert payload["layout"] == "oval" and payload["brain"] is None
    pts = np.array([[n["position"][k] for k in "xyz"] for n in payload["nodes"]])
    span = pts.max(axis=0) - pts.min(axis=0)
    assert span[0] > span[1] > span[2] * 2          # wide, then tall, then flat
    assert all(0.3 <= n["size"] <= 0.5 for n in payload["nodes"])


def test_denser_in_the_centre_than_at_the_rim(brain):
    asyncio.run(brain.seed())
    pts = np.array([[p["x"], p["y"], p["z"]] for p in brain.graph.positions().values()])
    r = np.linalg.norm(pts[:, :2] / np.array([1.25, 1.0]), axis=1) / brain.graph.scale
    inner_area, outer_area = 0.5**2, 1 - 0.5**2
    assert (r < 0.5).sum() / inner_area > (r >= 0.5).sum() / outer_area


def test_edges_report_distance_and_near_flag(brain):
    asyncio.run(brain.seed())
    edges = asyncio.run(brain.graph_payload())["edges"]
    assert all(e["near"] == (e["distance"] < 8.0 * brain.graph.scale / 12) for e in edges)
    assert any(e["near"] for e in edges)


def test_neurons_never_touch(brain):
    asyncio.run(brain.seed())
    pts = np.array([[p["x"], p["y"], p["z"]] for p in brain.graph.positions().values()])
    d = np.linalg.norm(pts[:, None] - pts[None], axis=-1) + np.eye(len(pts)) * 1e9
    assert d.min() > 1.0  # neuron radius is at most 0.5

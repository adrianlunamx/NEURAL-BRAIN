import asyncio
import math

import networkx as nx
import numpy as np

from utils.brain_shape import REGION_BY_NAME, BrainShapeLayout, cortex_radius, lobe


def seeded(brain):
    asyncio.run(brain.seed())
    return brain.graph


def test_every_neuron_sits_inside_the_brain(brain):
    graph = seeded(brain)
    pos = graph.positions()
    scale = graph.scale
    for node, p in pos.items():
        region = REGION_BY_NAME[p["region"]]
        v = np.array([p["x"], p["y"], p["z"]]) / scale
        if region.kind == "cortex":
            u = v / np.linalg.norm(v)
            assert np.linalg.norm(v) <= cortex_radius(u[None])[0] * 1.001, node
            assert v[2] * region.hemi > 0, f"{node} crossed into the other hemisphere"


def test_knowledge_is_spread_over_several_lobes(brain):
    pos = seeded(brain).positions()
    lobes = {lobe(p["region"]) for p in pos.values()}
    assert len(lobes) >= 4
    assert {"frontal", "parietal"} <= lobes


def test_neurons_do_not_overlap(brain):
    graph = seeded(brain)
    pos = graph.positions()
    pts = np.array([[p["x"], p["y"], p["z"]] for p in pos.values()])
    d = np.linalg.norm(pts[:, None] - pts[None], axis=-1) + np.eye(len(pts)) * 1e9
    # neurons are ~0.35-1.0 units wide; keep centres comfortably apart
    assert d.min() > 0.8


def test_linked_notes_share_a_region_more_often_than_chance(brain):
    graph = seeded(brain)
    pos = graph.positions()
    same = [pos[u]["region"] == pos[v]["region"] for u, v in graph.graph.edges()]
    regions = [p["region"] for p in pos.values()]
    chance = sum((regions.count(r) / len(regions)) ** 2 for r in set(regions))
    assert sum(same) / len(same) > chance * 2


def test_layout_is_deterministic_and_incremental():
    g = nx.les_miserables_graph()
    for n, d in g.nodes(data=True):
        d["type"] = "concept" if g.degree(n) > 8 else "fact"
    layout = BrainShapeLayout()
    a = layout.compute(g, 20.0)
    b = layout.compute(g, 20.0)
    assert a == b
    g.add_node("new", type="fact")
    g.add_edge("new", "Valjean", weight=0.8)
    c = layout.compute(g, 20.0, previous=a)
    moved = [math.dist((a[n]["x"], a[n]["y"], a[n]["z"]), (c[n]["x"], c[n]["y"], c[n]["z"]))
             for n in a if a[n]["region"] == c[n]["region"]]
    assert np.median(moved) < 1.5  # adding a note nudges the brain, it doesn't reshuffle it


def test_graph_payload_describes_the_brain(client):
    client.post("/api/seed")
    g = client.get("/api/graph").json()
    assert g["layout"] == "brain"
    assert len(g["brain"]["shell"]) > 1000
    assert {e["range"] for e in g["edges"]} <= {"local", "long"}
    assert all(n["color"].startswith("#") and n["region"] for n in g["nodes"])


def test_search_reports_relative_percentages(brain):
    asyncio.run(brain.seed())

    async def first():
        async for e in brain.query_stream("¿Qué es RAG?", animate=False):
            return e

    search = asyncio.run(first())["data"]
    pct = [n["percentage"] for n in search["nodes"]]
    assert pct[0] == 100 and pct == sorted(pct, reverse=True)
    assert search["percentages"] == {n["id"]: n["percentage"] for n in search["nodes"]}

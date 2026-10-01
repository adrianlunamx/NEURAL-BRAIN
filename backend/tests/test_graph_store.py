from collections import Counter

import numpy as np

from backend.app.graph_store import LOD_LEVELS, MAX_NEURONS, SNAPSHOT_VERSION, GraphStore
from backend.brain_layout import classify_regions, sdf_brain
from backend.app.models import EdgeType, Region


def seeded() -> GraphStore:
    g = GraphStore(seed=42)
    g.seed_brain()
    return g


def test_seeds_19000_neurons_with_local_edges_and_fibers():
    g = seeded()
    assert g.graph.number_of_nodes() == MAX_NEURONS
    assert all(len(ids) > 0 for ids in g.region_index.values())
    types = Counter(d["type"] for _, _, d in g.graph.edges(data=True))
    assert types[EdgeType.LOCAL] > MAX_NEURONS
    assert 200 <= types[EdgeType.FIBER] <= 240


def test_every_lod_prefix_is_stratified_by_region():
    g = seeded()
    for level, count in LOD_LEVELS.items():
        nodes = g.get_visible_nodes(level)
        assert len(nodes) == count
        share = Counter(n["region"] for n in nodes)
        assert len(share) == 6, level
        for region, ids in g.region_index.items():
            expected = count * len(ids) / MAX_NEURONS
            assert abs(share[region] - expected) <= 1.5, (level, region)


def test_add_neuron_recycles_the_stalest_seed_when_full():
    g = seeded()
    order_before = list(g.render_order)
    nid, recycled = g.add_neuron("Read: src/auth.py", Region.TEMPORAL, source="hook")
    assert recycled and g.graph.number_of_nodes() == MAX_NEURONS
    assert g.graph.nodes[nid]["label"] == "Read: src/auth.py"
    assert nid in g.region_index[Region.TEMPORAL]
    assert g.render_order == order_before  # recycled neurons keep their LOD slot
    assert g.graph.out_degree(nid) == 2
    # the recycled neuron is never picked again while seeds remain
    nid2, _ = g.add_neuron("Edit: x", Region.FRONTAL, source="hook")
    assert nid2 != nid


def test_recycle_heap_matches_a_full_sort_after_activations():
    g = seeded()
    g.add_neuron("warm up the heap", Region.FRONTAL, source="hook")
    # activate (in order) the seeds the heap would pick next: its entries go stale
    fresh = [nid for nid in g.render_order[:50] if g.graph.nodes[nid]["source"] == "seed"][:10]
    for nid in fresh:
        g.activate(nid, 0.5)
    for i in range(30):
        seeds = [(str(d.get("last_activated_at") or "1970-01-01"), n)
                 for n, d in g.graph.nodes(data=True) if d.get("source") == "seed"]
        stalest = min(key for key, _ in seeds)
        candidates = {n for key, n in seeds if key == stalest}
        nid, recycled = g.add_neuron(f"hook {i}", Region.TEMPORAL, source="hook")
        assert recycled and nid in candidates and nid not in fresh


def test_neurons_live_inside_one_brain_in_their_region():
    g = seeded()
    ids = g.render_order[:3000]
    pts = np.array([g.graph.nodes[i]["position"] for i in ids])
    assert (sdf_brain(pts) < 1e-3).all()
    regions = [str(getattr(g.graph.nodes[i]["region"], "value", g.graph.nodes[i]["region"])) for i in ids]
    assert list(classify_regions(pts)) == regions


def test_lateral_anatomy():
    info = {r["region"]: r for r in seeded().get_region_info()}
    assert info["frontal"]["center"][0] > info["parietal"]["center"][0] > info["occipital"]["center"][0]
    assert info["cerebellum"]["center"][1] < info["temporal"]["center"][1] < info["parietal"]["center"][1]
    assert info["hippocampus"]["neuron_count"] == min(r["neuron_count"] for r in info.values())


def test_new_neurons_land_inside_the_brain_in_the_requested_region():
    g = seeded()
    for region in Region:
        nid, _ = g.add_neuron(f"hook {region.value}", region, source="hook")
        p = np.array([g.graph.nodes[nid]["position"]])
        assert sdf_brain(p)[0] < 0
        assert classify_regions(p)[0] == region.value


def test_v1_snapshot_is_migrated_into_the_anatomical_brain():
    g = seeded()
    data = g.serialize()
    data["version"] = 1
    for n in data["nodes"]:
        n["position"] = [40.0, 40.0, 40.0]  # far outside, like the old ellipsoid layout
    g2 = GraphStore()
    g2.deserialize(data)
    pts = np.array([d["position"] for _, d in g2.graph.nodes(data=True)])
    assert (sdf_brain(pts) < 1e-3).all()
    assert g2.graph.number_of_edges() == g.graph.number_of_edges()
    assert g2.serialize()["version"] == SNAPSHOT_VERSION


def test_serialize_roundtrip():
    g = seeded()
    g.add_neuron("Ingest: hola", Region.HIPPOCAMPUS, source="ingest")
    data = g.serialize()
    g2 = GraphStore()
    g2.deserialize(data)
    assert g2.graph.number_of_nodes() == g.graph.number_of_nodes()
    assert g2.graph.number_of_edges() == g.graph.number_of_edges()
    assert g2.render_order == g.render_order
    assert g2.event_count == g.event_count

from collections import Counter

from backend.app.graph_store import LOD_LEVELS, MAX_NEURONS, REGION_BUDGET, GraphStore
from backend.app.models import EdgeType, Region


def seeded() -> GraphStore:
    g = GraphStore(seed=42)
    g.seed_brain()
    return g


def test_seeds_19000_neurons_with_local_edges_and_fibers():
    g = seeded()
    assert g.graph.number_of_nodes() == MAX_NEURONS == sum(REGION_BUDGET.values())
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
        for region, budget in REGION_BUDGET.items():
            expected = count * budget / MAX_NEURONS
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


def test_positions_stay_inside_the_region_ellipsoids():
    g = seeded()
    from backend.app.graph_store import REGION_ELLIPSOIDS

    for nid in g.render_order[:2000]:
        d = g.graph.nodes[nid]
        x, y, z = d["position"]
        inside = any(
            sum(((p - c) / r) ** 2 for p, c, r in zip((x, y, z), e["center"], e["radii"])) <= 1.0001
            for e in REGION_ELLIPSOIDS[Region(d["region"])]
        )
        assert inside, nid


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

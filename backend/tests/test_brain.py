import asyncio

from core.embeddings import HashingEmbedder
from models.schemas import IngestMetadata
from utils.graph_layout import compute_3d_layout


def run(coro):
    return asyncio.run(coro)


def test_hashing_embedder_is_normalised_and_semantic():
    emb = HashingEmbedder()
    a = emb.encode_one("redes neuronales y aprendizaje profundo")
    b = emb.encode_one("aprendizaje con redes neuronales")
    c = emb.encode_one("receta de tortilla de patatas")
    assert abs(float((a**2).sum()) - 1.0) < 1e-5
    assert a @ b > a @ c


def test_ingest_links_similar_notes_and_tags(brain):
    r1 = run(brain.ingest("Las redes neuronales aprenden con backpropagation",
                          IngestMetadata(type="fact", tags=["IA"])))
    r2 = run(brain.ingest("Backpropagation entrena redes neuronales profundas",
                          IngestMetadata(type="fact", tags=["ia"])))
    assert r1["created"] and r2["created"]
    assert brain.graph.has_node("c_ia")                      # tag became a concept hub
    assert brain.graph.graph.has_edge(r2["node_id"], r1["node_id"])  # semantic link
    assert r2["connections"] >= 2
    assert brain.vector_db.count() == brain.graph.graph.number_of_nodes()


def test_duplicate_content_is_not_reingested(brain):
    first = run(brain.ingest("Una nota única sobre grafos"))
    again = run(brain.ingest("Una nota única sobre grafos"))
    assert again["node_id"] == first["node_id"] and again["created"] is False


def test_query_stream_emits_all_phases_in_order(brain):
    run(brain.seed())

    async def collect():
        return [e async for e in brain.query_stream("¿Qué es RAG y cómo usa embeddings?", animate=False)]

    events = run(collect())
    kinds = [e["type"] for e in events]
    assert kinds[0] == "search" and kinds[1] == "connect" and kinds[-1] == "synthesize"
    assert "token" in kinds
    search = events[0]["data"]["nodes"]
    assert 0 < len(search) <= brain.settings.top_k
    synth = events[-1]["data"]
    assert synth["offline"] is True and "Offline mode" in synth["answer"]
    for edge in events[1]["data"]["edges"]:
        assert brain.graph.graph.has_edge(edge["from"], edge["to"])


def test_layout_is_3d_and_stable():
    import networkx as nx

    g = nx.path_graph(["a", "b", "c", "d"])
    p1 = compute_3d_layout(g, iterations=50)
    assert set(p1) == set(g.nodes) and set(p1["a"]) == {"x", "y", "z"}
    g.add_edge("d", "e")
    p2 = compute_3d_layout(g, iterations=50, previous=p1)
    assert "e" in p2


def test_graph_persists_across_restarts(settings, brain):
    from core.brain import BrainCore
    from core.embeddings import Embedder

    run(brain.ingest("Persistencia del conocimiento", IngestMetadata(tags=["memoria"])))
    reborn = BrainCore(settings, embedder=Embedder(backend="hash"))
    assert reborn.graph.graph.number_of_nodes() == brain.graph.graph.number_of_nodes()
    assert reborn.vector_db.count() == brain.vector_db.count()

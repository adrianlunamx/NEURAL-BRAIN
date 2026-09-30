import asyncio

from backend.app.events import EventBus
from backend.app.graph_store import GraphStore
from backend.app.query_engine import run_query_phases
from backend.app.vector_store import VectorStore

FAST = {"INPUT": 0.0, "SEARCH": 0.0, "CONNECT": 0.0, "SYNTHESIZE": 0.0}


async def collect(bus, sink, n_subscribers_ready):
    async for event in bus.stream():
        sink.append(event)
        if event["type"] == "phase" and event["data"]["phase"] == "IDLE":
            return


def test_every_subscriber_receives_every_event():
    async def scenario():
        bus = EventBus()
        a, b = [], []
        ta = asyncio.create_task(collect(bus, a, 2))
        tb = asyncio.create_task(collect(bus, b, 2))
        await asyncio.sleep(0)
        await bus.publish("stats", {"x": 1})
        await bus.publish("phase", {"phase": "IDLE"})
        await asyncio.gather(ta, tb)
        return a, b

    a, b = asyncio.run(scenario())
    assert [e["type"] for e in a] == [e["type"] for e in b] == ["stats", "phase"]


def test_query_runs_four_phases_and_finds_the_closest_memory(tmp_path):
    async def scenario():
        bus = EventBus()
        graph = GraphStore()
        graph.seed_brain()
        vector = VectorStore(tmp_path, backend="hash")
        texts = {
            "hippocampus": "El hipocampo consolida la memoria a largo plazo durante el sueño",
            "rag": "RAG recupera documentos relevantes y se los pasa al modelo de lenguaje",
            "cyber": "Neuromante de William Gibson popularizó el ciberespacio",
        }
        ids = {}
        for key, text in texts.items():
            nid, _ = graph.add_neuron(text[:40], __import__("backend.app.models", fromlist=["Region"]).Region.HIPPOCAMPUS, "ingest")
            vector.add_neuron(nid, text)
            ids[key] = nid
        events = []
        listener = asyncio.create_task(collect(bus, events, 1))
        await asyncio.sleep(0)
        await run_query_phases("¿qué pasa con la memoria durante el sueño?", 3, bus, graph, vector, timings=FAST)
        await listener
        return events, ids, graph

    events, ids, graph = asyncio.run(scenario())
    phases = [e["data"]["phase"] for e in events if e["type"] == "phase"]
    assert phases == ["INPUT", "SEARCH", "CONNECT", "SYNTHESIZE", "IDLE"]
    connect = next(e["data"] for e in events if e["type"] == "phase" and e["data"]["phase"] == "CONNECT")
    scores = [h["score"] for h in connect["hits"]]
    assert scores == sorted(scores, reverse=True)
    assert connect["hits"][0]["id"] == ids["hippocampus"]
    synth = next(e["data"] for e in events if e["type"] == "phase" and e["data"]["phase"] == "SYNTHESIZE")
    assert synth["summary_source"] == "extractive" and synth["center"] == [0.0, 1.2, 0.0]
    added = [e for e in events if e["type"] == "neuron_added"]
    assert added and added[-1]["data"]["label"].startswith("query:")
    assert graph.phase.value == "IDLE"


def test_empty_memory_falls_back_to_hippocampus_neurons(tmp_path):
    async def scenario():
        bus = EventBus()
        graph = GraphStore()
        graph.seed_brain()
        vector = VectorStore(tmp_path, backend="hash")
        events = []
        listener = asyncio.create_task(collect(bus, events, 1))
        await asyncio.sleep(0)
        await run_query_phases("hola", 5, bus, graph, vector, timings=FAST)
        await listener
        return events

    events = asyncio.run(scenario())
    search = next(e["data"] for e in events if e["type"] == "phase" and e["data"]["phase"] == "SEARCH")
    assert len(search["targets"]) == 4

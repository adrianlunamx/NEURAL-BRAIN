import json


def parse_sse(text: str) -> list[dict]:
    events = []
    for block in text.strip().split("\n\n"):
        for line in block.splitlines():
            if line.startswith("data: "):
                events.append(json.loads(line[6:]))
    return events


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    body = r.json()
    assert body["llm"] is False and body["embeddings"] == "hash"


def test_ingest_graph_query_reset_flow(client):
    r = client.post("/api/ingest", json={
        "content": "ChromaDB guarda embeddings para búsqueda semántica",
        "metadata": {"type": "fact", "tags": ["busqueda semantica"]},
    })
    assert r.status_code == 200
    node_id = r.json()["node_id"]
    assert r.json()["connections"] == 1

    g = client.get("/api/graph").json()
    ids = {n["id"] for n in g["nodes"]}
    assert node_id in ids and "c_busqueda-semantica" in ids
    assert g["edges"][0].keys() >= {"from", "to", "weight"}
    assert all({"x", "y", "z"} <= n["position"].keys() for n in g["nodes"])

    r = client.post("/api/query", json={"question": "¿Dónde se guardan los embeddings?", "animate": False})
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/event-stream")
    events = parse_sse(r.text)
    kinds = [e["type"] for e in events]
    assert kinds[:2] == ["search", "connect"] and kinds[-2:] == ["synthesize", "done"]
    assert events[0]["data"]["nodes"][0]["id"] in ids

    assert client.get(f"/api/node/{node_id}").json()["neighbors"]
    assert client.delete("/api/reset").json()["ok"] is True
    assert client.get("/api/graph").json()["nodes"] == []


def test_seed_endpoint(client):
    r = client.post("/api/seed")
    assert r.status_code == 200
    stats = r.json()["stats"]
    assert r.json()["ingested"] == 30
    assert stats["concepts"] > 5 and stats["edges"] > 30


def test_validation(client):
    assert client.post("/api/ingest", json={"content": "   "}).status_code == 422
    assert client.post("/api/query", json={"question": ""}).status_code == 422
    assert client.get("/api/node/nope").status_code == 404

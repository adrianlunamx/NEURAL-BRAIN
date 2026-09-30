import time


def wait_idle(client, timeout=10.0):
    """The phase machine runs in the background: wait for it instead of sleeping a fixed time."""
    from backend.app import api

    deadline = time.time() + timeout
    while time.time() < deadline:
        task = api._query_task
        if (task is None or task.done()) and client.get("/stats").json()["phase"] == "IDLE":
            return
        time.sleep(0.05)
    raise AssertionError("query phases did not return to IDLE")


def test_health_graph_regions_fibers(client):
    assert client.get("/health").json()["ok"] is True
    low = client.get("/graph", params={"detail": "low"}).json()
    assert len(low["nodes"]) == 1000 and low["total_neurons"] == 19000
    assert {n["region"] for n in low["nodes"]} == {
        "frontal", "parietal", "temporal", "occipital", "hippocampus", "cerebellum"}
    assert client.get("/graph", params={"detail": "nope"}).status_code == 400
    assert len(client.get("/regions").json()) == 6
    fibers = client.get("/fibers").json()
    assert len(fibers) >= 200 and len(fibers[0]["start"]) == 3


def test_ingest_query_and_hooks(client):
    r = client.post("/ingest", json={"text": "El hipocampo consolida la memoria durante el sueño"})
    assert r.status_code == 200 and r.json()["count"] == 1
    client.post("/ingest", json={"text": "Neuromante popularizó el ciberespacio", "region_hint": "occipital"})

    q = client.post("/query", json={"text": "memoria y sueño", "top_k": 5})
    assert q.status_code == 200
    body = q.json()
    assert body["hits"][0]["id"] == r.json()["neuron_ids"][0]
    assert body["hits"][0]["score"] >= body["hits"][-1]["score"]
    wait_idle(client)

    h = client.post("/hooks/event", json={"hook_type": "file_read", "tool_name": "Read", "summary": "Read: src/auth.py"})
    assert h.status_code == 200
    assert h.json()["region"] == "temporal"


def test_ingest_batch(client):
    notes = [
        {"text": "El cerebelo coordina el movimiento. También ajusta la postura", "title": "Cerebelo",
         "group": "Anatomía", "tags": ["motor"]},
        {"text": "La corteza visual procesa lo que vemos", "title": "Visión", "group": "Anatomía"},
    ]
    r = client.post("/ingest/batch", json={"notes": notes})
    assert r.status_code == 200
    body = r.json()
    assert [n["count"] for n in body["notes"]] == [2, 1] and body["count"] == 3
    titles = {n["title"]: n for n in client.get("/notes").json()["notes"]}
    assert len(titles["Cerebelo"]["neuron_ids"]) == 2 and titles["Visión"]["group"] == "Anatomía"
    hits = client.post("/query", json={"text": "coordina el movimiento", "top_k": 3}).json()["hits"]
    assert hits[0]["id"] in body["notes"][0]["neuron_ids"]
    wait_idle(client)
    assert client.post("/ingest/batch", json={"notes": []}).status_code == 422


def test_git_commit_log_restore(client):
    first = client.post("/git/commit", json={"message": "checkpoint A"}).json()["commit_hash"]
    client.post("/hooks/event", json={"hook_type": "file_edit", "tool_name": "Edit", "summary": "Edit: main.py"})
    client.post("/git/commit", json={"message": "checkpoint B"})
    log = client.get("/git/log").json()
    assert [e["message"] for e in log[:2]] == ["checkpoint B", "checkpoint A"]
    restored = client.post("/git/restore", json={"commit_hash": first})
    assert restored.status_code == 200
    stats = client.get("/stats").json()
    assert stats["total_neurons"] == 19000
    assert client.post("/git/restore", json={"commit_hash": "deadbeef"}).status_code == 404


def test_validation(client):
    assert client.post("/ingest", json={"text": ""}).status_code == 422
    assert client.post("/query", json={"text": "x", "top_k": 99}).status_code == 422


def test_past_questions_are_not_returned_as_sources(client):
    client.post("/ingest", json={"text": "El hipocampo consolida la memoria durante el sueño"})
    assert client.post("/query", json={"text": "memoria y sueño", "top_k": 5}).status_code == 200
    wait_idle(client)
    again = client.post("/query", json={"text": "memoria y sueño", "top_k": 5}).json()
    assert again["hits"] and all(not h["label"].startswith("query:") for h in again["hits"])

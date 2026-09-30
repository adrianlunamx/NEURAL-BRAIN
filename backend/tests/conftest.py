import os

import pytest

# Offline, fast, isolated: no model download, no Claude calls.
os.environ["EMBEDDING_BACKEND"] = "hash"
os.environ["ANTHROPIC_API_KEY"] = ""


@pytest.fixture()
def fast_phases(monkeypatch):
    from backend.app import query_engine

    monkeypatch.setattr(query_engine, "TIMINGS", {"INPUT": 0.01, "SEARCH": 0.01, "CONNECT": 0.01, "SYNTHESIZE": 0.01})


@pytest.fixture()
def client(tmp_path, monkeypatch, fast_phases):
    from fastapi.testclient import TestClient

    from backend.app import main

    monkeypatch.setattr(main, "CHROMA_DIR", tmp_path / "chroma")
    monkeypatch.setattr(main, "GRAPH_REPO_DIR", tmp_path / "graph_repo")
    with TestClient(main.app) as c:
        yield c

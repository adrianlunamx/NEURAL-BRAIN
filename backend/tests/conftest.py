import pytest
from fastapi.testclient import TestClient

from core.brain import BrainCore
from core.config import load_settings
from core.embeddings import Embedder


@pytest.fixture()
def settings(tmp_path):
    return load_settings(
        anthropic_api_key=None,           # offline mode: no network in tests
        embedding_backend="hash",
        storage_dir=tmp_path / "storage",
        layout_iterations=30,
    )


@pytest.fixture()
def brain(settings):
    return BrainCore(settings, embedder=Embedder(backend="hash"))


@pytest.fixture()
def client(brain):
    import main

    main.app.state.brain = brain
    with TestClient(main.app) as c:
        yield c
    main.app.state.brain = None

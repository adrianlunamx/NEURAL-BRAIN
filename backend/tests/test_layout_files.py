import json
from pathlib import Path

import numpy as np

from backend.brain_layout import REGIONS, build_layout, sdf_brain, validate_layout

ROOT = Path(__file__).resolve().parents[2]


def test_shipped_layout_is_valid_and_deterministic():
    shipped = json.loads((ROOT / "backend" / "brain_layout.json").read_text())
    counts = validate_layout(shipped)
    assert set(counts) == set(REGIONS) and sum(counts.values()) == 19000
    regenerated = build_layout(19000, shipped["seed"])
    assert np.allclose(regenerated["positions"][:50], shipped["positions"][:50], atol=1e-3)


def test_shipped_shell_is_a_mesh_on_the_brain_surface():
    shell = json.loads((ROOT / "frontend" / "public" / "brain_shell.json").read_text())
    verts = np.array(shell["vertices"]).reshape(-1, 3)
    idx = np.array(shell["indices"])
    assert len(idx) % 3 == 0 and idx.max() < len(verts)
    assert len(shell["normals"]) == len(shell["vertices"])
    assert np.abs(sdf_brain(verts[::50])).max() < 0.3  # close to the surface

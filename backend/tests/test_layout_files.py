import json
from pathlib import Path

import numpy as np

from backend.brain_layout import (
    LAYOUT_VERSION, REGIONS, build_layout, classify_regions, sdf_brain, surface_detail, validate_layout,
)

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
    assert shell["version"] == LAYOUT_VERSION
    sample = verts[::50]
    # on the folded surface (smooth SDF + sulci) ...
    assert np.abs(sdf_brain(sample) + surface_detail(sample)).max() < 0.2
    # ... which never strays far from the smooth one neurons and notes are kept in
    assert np.abs(sdf_brain(sample)).max() < 0.7


def test_brain_shape_landmarks():
    """v3 anatomy: two hemispheres split on top, a temporal lobe, the cerebellum
    under the occipital lobe, and every region where it belongs."""
    inside = lambda *p: sdf_brain(np.array([p]))[0] < 0  # noqa: E731
    assert inside(0.0, -0.5, 0.0)            # corpus callosum / core joins the hemispheres
    assert not inside(0.0, 3.6, 0.0)         # longitudinal fissure on top
    assert inside(0.0, 3.6, 1.5) and inside(0.0, 3.6, -1.5)
    assert inside(4.6, 0.5, 1.2) and not inside(5.6, 0.5, 1.2)    # frontal pole
    assert inside(-5.0, 0.3, 1.0) and not inside(-5.8, 0.3, 1.0)  # occipital pole
    region = lambda *p: classify_regions(np.array([p]))[0]  # noqa: E731
    assert region(3.5, 1.0, 1.2) == "frontal"
    assert region(-0.5, 3.0, 1.2) == "parietal"
    assert region(-4.3, 0.8, 1.0) == "occipital"
    assert region(1.5, -1.8, 2.2) == "temporal"
    assert region(0.5, -1.2, 1.4) == "hippocampus"
    assert region(-3.0, -2.6, 1.1) == region(-3.0, -2.6, -1.1) == "cerebellum"

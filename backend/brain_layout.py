#!/usr/bin/env python3
"""Anatomical brain layout (v2): one brain in lateral view instead of six separate ellipsoids.

The brain is a signed distance field (SDF): negative inside, positive outside.
Neurons are sampled uniformly inside it and each point is classified into one of
the six regions, so regions appear as coloured zones of a single volume.

Axes (same as the rest of the project):
    x = front(+) / back(-)   y = up(+) / down(-)   z = right(+) / left(-)

CLI (run from backend/):
    python brain_layout.py --neurons 19000 --out brain_layout.json \
        --shell ../frontend/public/brain_shell.json --seed 42
    python brain_layout.py --no-shell            # layout only (no scikit-image needed)

Library:
    sdf_brain(points) -> distances           classify_regions(points) -> region names
    sample_region(region, k, rng)            load_into_graphstore(graph, layout_path)
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from typing import Dict, List, Optional, Tuple

import numpy as np

HERE = Path(__file__).resolve().parent
DEFAULT_LAYOUT = HERE / "brain_layout.json"
LAYOUT_VERSION = 2

# Sampling box that fully contains the brain (also used by GraphStore.add_neuron).
BOUNDS_MIN = np.array([-6.0, -5.0, -3.5])
BOUNDS_MAX = np.array([5.5, 4.0, 3.5])

REGIONS = ["frontal", "parietal", "temporal", "occipital", "hippocampus", "cerebellum"]


# ---------------------------------------------------------------------------
# SDF primitives
# ---------------------------------------------------------------------------

def _sd_ellipsoid(p: np.ndarray, center, radii) -> np.ndarray:
    """Approximate signed distance to an axis-aligned ellipsoid (Inigo Quilez bound)."""
    q = (p - np.asarray(center)) / np.asarray(radii)
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / np.asarray(radii), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-9)


def _sd_capsule(p: np.ndarray, a, b, r: float) -> np.ndarray:
    a, b = np.asarray(a, float), np.asarray(b, float)
    pa, ba = p - a, b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
    return np.linalg.norm(pa - h[:, None] * ba, axis=-1) - r


def _smin(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    """Smooth union (polynomial smooth-min)."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b * (1 - h) + a * h - k * h * (1 - h)


def _smax(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    return -_smin(-a, -b, k)


# ---------------------------------------------------------------------------
# The brain
# ---------------------------------------------------------------------------

CEREBRUM = {"center": (-0.2, 0.55, 0.0), "radii": (5.6, 3.55, 3.2)}
TEMPORAL_LOBES = [{"center": (0.9, -1.55, s * 2.0), "radii": (2.7, 1.45, 1.15)} for s in (1, -1)]
CEREBELLUM = {"center": (-3.55, -2.95, 0.0), "radii": (1.95, 1.3, 2.25)}
BRAINSTEM = {"a": (-1.3, -2.0, 0.0), "b": (-1.85, -4.7, 0.0), "r": 0.62}
HIPPOCAMPI = [{"center": (-0.3, -1.05, s * 1.0), "radii": (1.5, 0.5, 0.45)} for s in (1, -1)]


def sdf_brain(points: np.ndarray) -> np.ndarray:
    """Signed distance to the whole brain surface. `points` is (n, 3); < 0 means inside."""
    p = np.atleast_2d(np.asarray(points, dtype=float))
    x, y, z = p[:, 0], p[:, 1], p[:, 2]

    cerebrum = _sd_ellipsoid(p, **CEREBRUM)
    # flatten the base of the cerebrum (it rests on the temporal lobes / cerebellum)
    cerebrum = _smax(cerebrum, -(y + 1.25), 0.6)
    # frontal pole a little lower and rounder than the occipital pole
    cerebrum = cerebrum + 0.18 * np.clip(x / 5.6, 0, 1) * np.clip(y / 3.5, 0, 1)
    # longitudinal fissure between the hemispheres (a thin slab carved from the top)
    fissure = np.where(y > 0.9, 0.12 - np.abs(z), -10.0)
    cerebrum = _smax(cerebrum, fissure, 0.15)

    temporal = np.minimum(*(_sd_ellipsoid(p, **t) for t in TEMPORAL_LOBES))
    cerebellum = _sd_ellipsoid(p, **CEREBELLUM)
    brainstem = _sd_capsule(p, BRAINSTEM["a"], BRAINSTEM["b"], BRAINSTEM["r"])

    d = _smin(cerebrum, temporal, 0.7)
    d = _smin(d, brainstem, 0.5)
    d = _smin(d, cerebellum, 0.35)
    # shallow gyri: a gentle ripple on the surface
    ripple = 0.045 * np.sin(3.1 * x + 1.7 * y) * np.sin(2.9 * y + 2.3 * z) * np.sin(2.2 * z + 1.3 * x)
    return d + ripple


def classify_regions(points: np.ndarray) -> np.ndarray:
    """Region name for each point (points are assumed to be inside the brain)."""
    p = np.atleast_2d(np.asarray(points, dtype=float))
    x, y, z = p[:, 0], p[:, 1], p[:, 2]
    out = np.full(len(p), "parietal", dtype=object)

    out[x > 1.3 - 0.35 * y] = "frontal"                        # central sulcus slants backwards
    out[x < -3.0 + 0.25 * y] = "occipital"
    temporal = (y < -0.55 + 0.12 * x) & (np.abs(z) > 0.95) & (x > -3.2)
    out[temporal] = "temporal"
    hippo = np.zeros(len(p), dtype=bool)
    for h in HIPPOCAMPI:
        hippo |= _sd_ellipsoid(p, **h) < 0
    out[hippo] = "hippocampus"
    hindbrain = (_sd_ellipsoid(p, **CEREBELLUM) < 0.05) | (_sd_capsule(p, BRAINSTEM["a"], BRAINSTEM["b"], BRAINSTEM["r"]) < 0.05)
    out[hindbrain & (y < -1.6)] = "cerebellum"
    return out


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------

def sample_inside(n: int, rng: np.random.Generator, batch: int = 8192) -> np.ndarray:
    """n points uniformly distributed inside the brain (rejection sampling)."""
    chunks: List[np.ndarray] = []
    count = 0
    while count < n:
        cand = rng.uniform(BOUNDS_MIN, BOUNDS_MAX, size=(batch, 3))
        inside = cand[sdf_brain(cand) < 0.0]
        chunks.append(inside)
        count += len(inside)
    return np.concatenate(chunks)[:n]


def sample_region(region: str, k: int, rng: np.random.Generator, max_batches: int = 400) -> np.ndarray:
    """k points inside the brain that fall in `region` (used for new neurons)."""
    found: List[np.ndarray] = []
    total = 0
    for _ in range(max_batches):
        cand = rng.uniform(BOUNDS_MIN, BOUNDS_MAX, size=(2048, 3))
        cand = cand[sdf_brain(cand) < 0.0]
        cand = cand[classify_regions(cand) == region]
        found.append(cand)
        total += len(cand)
        if total >= k:
            break
    pts = np.concatenate(found) if found else np.zeros((0, 3))
    if len(pts) < k:
        raise RuntimeError(f"could not sample {k} points in region {region!r}")
    return pts[:k]


def build_layout(n: int, seed: int) -> Dict:
    rng = np.random.default_rng(seed)
    pts = sample_inside(n, rng)
    regions = classify_regions(pts)
    return {
        "version": LAYOUT_VERSION,
        "seed": seed,
        "count": int(n),
        "positions": np.round(pts, 3).tolist(),
        "regions": regions.tolist(),
    }


def validate_layout(layout: Dict) -> Dict[str, int]:
    pts = np.asarray(layout["positions"], dtype=float)
    regions = np.asarray(layout["regions"])
    assert len(pts) == len(regions) == layout["count"], "count mismatch"
    assert (sdf_brain(pts) < 1e-3).all(), "neurons outside the brain"
    counts = {r: int((regions == r).sum()) for r in REGIONS}
    empty = [r for r, c in counts.items() if c == 0]
    assert not empty, f"empty regions: {empty}"
    return counts


# ---------------------------------------------------------------------------
# Shell mesh (translucent brain surface for the frontend)
# ---------------------------------------------------------------------------

def build_shell(resolution: float = 0.19, offset: float = 0.08) -> Dict:
    """Marching cubes over the SDF. Requires scikit-image."""
    from skimage.measure import marching_cubes

    axes = [np.arange(lo - 0.3, hi + 0.3, resolution) for lo, hi in zip(BOUNDS_MIN, BOUNDS_MAX)]
    gx, gy, gz = np.meshgrid(*axes, indexing="ij")
    grid = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    field = sdf_brain(grid).reshape(gx.shape)
    verts, faces, normals, _ = marching_cubes(field, level=offset, spacing=(resolution,) * 3)
    verts += np.array([a[0] for a in axes])
    return {
        "version": LAYOUT_VERSION,
        "vertices": np.round(verts, 3).ravel().tolist(),
        "normals": np.round(normals, 3).ravel().tolist(),
        "indices": faces.astype(int).ravel().tolist(),
    }


# ---------------------------------------------------------------------------
# GraphStore integration
# ---------------------------------------------------------------------------

def load_layout(layout_path: Path | str = DEFAULT_LAYOUT, n: int = 19000, seed: int = 42) -> Tuple[np.ndarray, List[str]]:
    """Positions + regions from the precomputed JSON; generated (and cached) if missing."""
    path = Path(layout_path)
    if not path.is_absolute():
        path = HERE / path
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
    else:
        data = build_layout(n, seed)
        validate_layout(data)
        try:
            path.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
        except OSError:
            pass
    return np.asarray(data["positions"], dtype=float), list(data["regions"])


def load_into_graphstore(graph, layout_path: Path | str = "brain_layout.json") -> int:
    """Seed a GraphStore from the anatomical layout. Returns the neuron count."""
    positions, regions = load_layout(layout_path)
    return graph.seed_from_layout(positions, regions)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--neurons", type=int, default=19000)
    ap.add_argument("--out", default="brain_layout.json")
    ap.add_argument("--shell", default="../frontend/public/brain_shell.json")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--no-shell", action="store_true", help="skip the shell mesh (no scikit-image needed)")
    args = ap.parse_args(argv)

    t0 = time.time()
    layout = build_layout(args.neurons, args.seed)
    counts = validate_layout(layout)
    Path(args.out).write_text(json.dumps(layout, separators=(",", ":")), encoding="utf-8")
    print(f"layout: {args.neurons} neurons -> {args.out} ({time.time() - t0:.1f}s)")
    for region, c in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {region:<12} {c:>6}  ({100 * c / args.neurons:.1f}%)")
    print("validation OK")

    if not args.no_shell:
        try:
            shell = build_shell()
        except ImportError:
            print("scikit-image not installed: skipping the shell (pip install scikit-image)", file=sys.stderr)
            return 0
        Path(args.shell).write_text(json.dumps(shell, separators=(",", ":")), encoding="utf-8")
        print(f"shell: {len(shell['indices']) // 3} triangles -> {args.shell}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

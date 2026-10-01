#!/usr/bin/env python3
"""Anatomical brain layout (v3): one brain in lateral view instead of six separate ellipsoids.

The brain is a signed distance field (SDF): negative inside, positive outside.
Neurons are sampled uniformly inside it and each point is classified into one of
the six regions, so regions appear as coloured zones of a single volume.

v3: two hemispheres split by the longitudinal fissure, a real lateral profile
(round frontal pole, tapered occipital pole, highest at the parietal), a
temporal lobe under the Sylvian fissure, a two-lobed cerebellum notched under
the occipital lobe and an angled brainstem with the pons. The shell mesh adds
gyri/sulci (and cerebellar folia) on top of the smooth SDF; neurons, notes and
the frontend use the smooth SDF only.

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
LAYOUT_VERSION = 3

# Sampling box that fully contains the brain (also used by GraphStore.add_neuron).
BOUNDS_MIN = np.array([-6.0, -5.0, -4.0])
BOUNDS_MAX = np.array([6.0, 4.4, 4.0])
BOX_MIN, BOX_MAX = BOUNDS_MIN, BOUNDS_MAX

REGIONS = ["frontal", "parietal", "temporal", "occipital", "hippocampus", "cerebellum"]


# ---------------------------------------------------------------------------
# SDF primitives
# ---------------------------------------------------------------------------

def _sd_ellipsoid(p: np.ndarray, center, radii) -> np.ndarray:
    """Approximate signed distance to an axis-aligned ellipsoid (Inigo Quilez bound)."""
    q = (p - np.asarray(center)) / np.asarray(radii)
    k0 = np.linalg.norm(q, axis=-1)
    k1 = np.linalg.norm(q / np.asarray(radii), axis=-1)
    return k0 * (k0 - 1.0) / np.maximum(k1, 1e-12)


def _sd_capsule(p: np.ndarray, a, b, r: float) -> np.ndarray:
    """Exact signed distance to the segment a-b inflated by r."""
    a, b = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    pa, ba = p - a, b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
    return np.linalg.norm(pa - h[:, None] * ba, axis=-1) - r


def _smin(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    """Smooth union (polynomial smooth-min)."""
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return b + (a - b) * h - k * h * (1.0 - h)


def _smoothstep(edge0: float, edge1: float, x: np.ndarray) -> np.ndarray:
    t = np.clip((x - edge0) / (edge1 - edge0), 0.0, 1.0)
    return t * t * (3.0 - 2.0 * t)


# ---------------------------------------------------------------------------
# The brain (v3)
# ---------------------------------------------------------------------------
# Hemisphere parts are given for the right hemisphere (z > 0) and mirrored:
# the SDF is evaluated with |z|, so both hemispheres are identical.

HEMI_MAIN = {"center": (-0.5, 0.95, 1.55), "radii": (4.2, 2.85, 2.0)}    # highest and widest at the parietal
HEMI_FRONTAL = {"center": (2.45, 0.5, 1.3), "radii": (2.55, 2.4, 1.75)}  # round, narrower frontal pole
HEMI_OCCIPITAL = {"center": (-3.15, 0.35, 1.2), "radii": (2.05, 2.0, 1.6)}  # tapered occipital pole
TEMPORAL_LOBE = {"center": (0.85, -1.45, 1.85), "radii": (2.65, 1.2, 1.3)}
# fills the fissure below the corpus callosum, so the hemispheres only split on top
CORE = {"center": (-0.3, -0.35, 0.0), "radii": (3.1, 1.7, 1.5)}
CEREBELLUM = {"center": (-3.0, -2.55, 1.1), "radii": (1.65, 1.1, 1.45)}  # one lobe per side
VERMIS = {"center": (-3.0, -2.45, 0.0), "radii": (1.35, 1.0, 0.75)}
BRAINSTEM = {"a": (-0.55, -1.1, 0.0), "b": (-1.25, -4.2, 0.0), "r": 0.46}
PONS = {"center": (-0.75, -2.45, 0.0), "radii": (0.85, 0.9, 0.85)}
HIPPOCAMPUS = {"center": (0.4, -1.2, 1.35), "radii": (1.75, 0.62, 0.68)}  # medial temporal lobe

BLEND_LOBES_K = 0.9         # main + frontal + occipital: one smooth hemisphere
BLEND_TEMPORAL_K = 0.3      # small: leaves the Sylvian fissure as a crease
BLEND_HEMISPHERES_K = 0.12  # small: deep longitudinal fissure along the top
BLEND_CORE_K = 0.6
BLEND_CEREBELLUM_K = 0.25   # small: the cerebellum sits in a notch under the occipital lobe
BLEND_STEM_K = 0.4


def _mirror(p: np.ndarray) -> np.ndarray:
    q = p.copy()
    q[:, 2] = np.abs(q[:, 2])
    return q


def _parts(p: np.ndarray) -> Dict[str, np.ndarray]:
    """Distances to the cerebrum, cerebellum and brainstem (each smooth)."""
    q = _mirror(p)
    hemi = _smin(_sd_ellipsoid(q, **HEMI_MAIN), _sd_ellipsoid(q, **HEMI_FRONTAL), BLEND_LOBES_K)
    hemi = _smin(hemi, _sd_ellipsoid(q, **HEMI_OCCIPITAL), BLEND_LOBES_K)
    hemi = _smin(hemi, _sd_ellipsoid(q, **TEMPORAL_LOBE), BLEND_TEMPORAL_K)
    # mirrored: hemi is already the union of both hemispheres; deepen the midline split
    midline = 1.0 - _smoothstep(0.0, BLEND_HEMISPHERES_K + 0.25, q[:, 2])
    hemi = hemi + 0.35 * midline * _smoothstep(0.2, 1.4, p[:, 1])
    cerebrum = _smin(hemi, _sd_ellipsoid(p, **CORE), BLEND_CORE_K)
    cerebellum = _smin(_sd_ellipsoid(q, **CEREBELLUM), _sd_ellipsoid(p, **VERMIS), 0.4)
    stem = _smin(_sd_capsule(p, BRAINSTEM["a"], BRAINSTEM["b"], BRAINSTEM["r"]),
                 _sd_ellipsoid(p, **PONS), 0.35)
    return {"cerebrum": cerebrum, "cerebellum": cerebellum, "stem": stem}


def sdf_brain(points: np.ndarray) -> np.ndarray:
    """Signed distance to the whole (smooth) brain surface. `points` is (n, 3); < 0 means inside.
    Mirrors sdfBrain() in frontend/src/config/brainConfig.ts — keep in sync."""
    p = np.atleast_2d(np.asarray(points, dtype=float))
    d = _parts(p)
    out = _smin(d["cerebrum"], d["cerebellum"], BLEND_CEREBELLUM_K)
    return _smin(out, d["stem"], BLEND_STEM_K)


def classify_regions(points: np.ndarray) -> np.ndarray:
    """Region name for each point (points are assumed to be inside the brain).

    Later rules win: parietal (default) < frontal (in front of the slanted central
    sulcus) < occipital < temporal lobe < hippocampus < cerebellum (+ brainstem).
    Mirrors classifyRegion() in frontend/src/config/brainConfig.ts — keep in sync.
    """
    p = np.atleast_2d(np.asarray(points, dtype=float))
    q = _mirror(p)
    x, y = p[:, 0], p[:, 1]
    d = _parts(p)
    out = np.empty(len(p), dtype=object)
    out[:] = "parietal"
    out[x + 0.35 * y > 1.3] = "frontal"
    out[x - 0.25 * y < -2.5] = "occipital"
    out[((_sd_ellipsoid(q, **TEMPORAL_LOBE) < 0.0) & (y < -0.4))
        | ((q[:, 2] > 1.9) & (y < 0.1) & (x > -2.2) & (x < 3.0))] = "temporal"
    out[_sd_ellipsoid(q, **HIPPOCAMPUS) < 0.0] = "hippocampus"
    out[(d["cerebellum"] < 0.0) | ((d["stem"] < 0.0) & (d["cerebrum"] > 0.0))] = "cerebellum"
    return out


# ---------------------------------------------------------------------------
# Surface detail (shell mesh only): gyri and sulci, cerebellar folia
# ---------------------------------------------------------------------------

def _hash3(ix: np.ndarray, iy: np.ndarray, iz: np.ndarray) -> np.ndarray:
    """Deterministic pseudo-random value in [-1, 1] per lattice point."""
    with np.errstate(over="ignore"):
        h = (ix * 73856093) ^ (iy * 19349663) ^ (iz * 83492791)
        h = (h ^ (h >> 13)) * 1274126177
        h = h ^ (h >> 16)
    return (h & 0xFFFF).astype(float) / 32767.5 - 1.0


def _value_noise(p: np.ndarray) -> np.ndarray:
    """Smooth 3D value noise (quintic interpolation), roughly in [-1, 1]."""
    f = np.floor(p)
    i = f.astype(np.int64)
    t = p - f
    u = t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
    out = np.zeros(len(p))
    for dx in (0, 1):
        wx = u[:, 0] if dx else 1.0 - u[:, 0]
        for dy in (0, 1):
            wy = u[:, 1] if dy else 1.0 - u[:, 1]
            for dz in (0, 1):
                wz = u[:, 2] if dz else 1.0 - u[:, 2]
                out += wx * wy * wz * _hash3(i[:, 0] + dx, i[:, 1] + dy, i[:, 2] + dz)
    return out


SULCUS_FREQ = 0.8       # gyri wavelength ~1.25 brain units
SULCUS_WIDTH = 0.2      # narrow grooves along the noise zero-set
SULCUS_DEPTH = 0.32
# Sylvian (lateral) fissure: between the frontal/parietal lobes and the temporal lobe
SYLVIAN = {"a": (3.3, -0.7), "b": (-0.9, 0.35), "width": 0.2, "depth": 0.45}
FOLIA_FREQ = 5.5        # thin parallel ridges of the cerebellum
FOLIA_DEPTH = 0.06


def surface_detail(points: np.ndarray) -> np.ndarray:
    """Offset added to sdf_brain() for the shell: > 0 carves sulci into the surface."""
    p = np.atleast_2d(np.asarray(points, dtype=float))
    q = _mirror(p)  # symmetric folds, like a real brain
    n = _value_noise(q * SULCUS_FREQ) + 0.5 * _value_noise(q * SULCUS_FREQ * 2.1 + 17.3)
    sulci = np.exp(-((n / SULCUS_WIDTH) ** 2))
    d = _parts(p)
    on_cerebrum = _smoothstep(0.25, -0.15, d["cerebrum"] - np.minimum(d["cerebellum"], d["stem"]))
    on_cerebellum = _smoothstep(0.25, -0.15, d["cerebellum"] - np.minimum(d["cerebrum"], d["stem"]))
    folia = 0.5 + 0.5 * np.cos(FOLIA_FREQ * (p[:, 1] + 0.35 * p[:, 0]))
    # distance (in the lateral x-y plane) to the Sylvian fissure line, only on the outer face
    a, b = np.array(SYLVIAN["a"]), np.array(SYLVIAN["b"])
    pa, ba = p[:, :2] - a, b - a
    h = np.clip((pa @ ba) / (ba @ ba), 0.0, 1.0)
    dist = np.linalg.norm(pa - h[:, None] * ba, axis=-1)
    sylvian = np.exp(-((dist / SYLVIAN["width"]) ** 2)) * _smoothstep(1.2, 2.2, q[:, 2])
    return (SULCUS_DEPTH * sulci + SYLVIAN["depth"] * sylvian) * on_cerebrum         + FOLIA_DEPTH * folia ** 4 * on_cerebellum


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
    # classify the stored (rounded) positions, so a point on a region border keeps its region
    pts = np.round(sample_inside(n, rng), 3)
    regions = classify_regions(pts)
    return {
        "version": LAYOUT_VERSION,
        "seed": seed,
        "count": int(n),
        "positions": pts.tolist(),
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

def build_shell(resolution: float = 0.13, offset: float = 0.08) -> Dict:
    """Marching cubes over the SDF plus the gyri/folia detail. Requires scikit-image."""
    from skimage.measure import marching_cubes

    axes = [np.arange(lo - 0.3, hi + 0.3, resolution) for lo, hi in zip(BOUNDS_MIN, BOUNDS_MAX)]
    gx, gy, gz = np.meshgrid(*axes, indexing="ij")
    grid = np.stack([gx.ravel(), gy.ravel(), gz.ravel()], axis=1)
    field = (sdf_brain(grid) + surface_detail(grid)).reshape(gx.shape)
    verts, faces, normals, _ = marching_cubes(field, level=offset, spacing=(resolution,) * 3)
    verts += np.array([a[0] for a in axes])
    return {
        "version": LAYOUT_VERSION,
        "vertices": np.round(verts, 3).ravel().tolist(),
        "normals": np.round(normals, 2).ravel().tolist(),  # shading only: 2 decimals keep the file small
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

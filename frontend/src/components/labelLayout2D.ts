// labelLayout2D — screen-space de-collision for floating 3D labels.
//
// Supersedes labelLayout.ts (v2.1), whose world-Y stagger could not fix the
// real problem: labels overlap on SCREEN, and the CONNECT "%" labels never
// saw the region-name labels, so the two systems collided with each other.
//
// This module takes the UNION of both label systems, projects every anchor
// with the live camera, resolves 2D rectangle collisions greedily by
// priority, and unprojects the result back to world space at the original
// depth. Because it works in screen space it stays correct while the brain
// rotates or the camera auto-zooms.
//
// Pure functions (only three.js math types); no React.

import * as THREE from "three";

export type V3 = [number, number, number];

export interface ScreenLabelInput {
  /** Stable unique id ("region:frontal", "hit:<neuron-id>", ...). */
  id: string;
  /** 3D anchor of the label. */
  world: V3;
  /** Rendered text, used to estimate the on-screen box. */
  text: string;
  /** World-unit font size of the drei <Text>. */
  fontSize: number;
  /**
   * Higher priority claims its spot first; lower priority labels are pushed
   * away on collision. Region names use 2, CONNECT hits use their match
   * score (0..1), so region names stay put and hit labels dodge them.
   */
  priority: number;
}

export interface ScreenLabelOutput {
  id: string;
  /** De-collided 3D position for the billboard. */
  world: V3;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface ScreenPoint {
  x: number;
  y: number;
  /** NDC depth, reused to unproject back to the same view ray. */
  depth: number;
}

/** Project a world point to screen pixels (CSS px, matches useThree size). */
export function projectToScreen(
  world: V3,
  camera: THREE.Camera,
  viewport: Viewport,
): ScreenPoint {
  const v = new THREE.Vector3(world[0], world[1], world[2]).project(camera);
  return {
    x: (v.x * 0.5 + 0.5) * viewport.width,
    y: (-v.y * 0.5 + 0.5) * viewport.height,
    depth: v.z,
  };
}

/**
 * True when the point is behind (or essentially at) the camera plane.
 * project() would mirror such points, so we leave those labels untouched.
 */
function isBehindCamera(world: V3, camera: THREE.Camera): boolean {
  const v = new THREE.Vector3(world[0], world[1], world[2])
    .applyMatrix4(camera.matrixWorldInverse);
  return v.z > -0.05; // three.js cameras look down -Z
}

/**
 * Estimate the on-screen box of a drei <Text> label.
 * Measures pixels-per-world-unit at the label's depth, then scales by text
 * length (average glyph ~0.52 x fontSize for the Inter font in use).
 */
export function estimateLabelSize(
  text: string,
  fontSize: number,
  world: V3,
  camera: THREE.Camera,
  viewport: Viewport,
): { width: number; height: number } {
  const a = projectToScreen(world, camera, viewport);
  const b = projectToScreen([world[0], world[1] + fontSize, world[2]], camera, viewport);
  const pxPerUnit = Math.abs(a.y - b.y) / fontSize;
  const pad = 10; // breathing room between boxes
  return {
    width: Math.max(1, text.length) * fontSize * 0.52 * pxPerUnit + pad,
    height: fontSize * 1.3 * pxPerUnit + pad,
  };
}

const MAX_PASSES = 40;
const SEPARATION_PX = 6;

interface PlacedRect {
  id: string;
  cx: number;
  cy: number;
  w: number;
  h: number;
}

function overlaps(cx: number, cy: number, w: number, h: number, q: PlacedRect): boolean {
  return Math.abs(cx - q.cx) < (w + q.w) / 2 && Math.abs(cy - q.cy) < (h + q.h) / 2;
}

/**
 * Move a box along screen Y in direction `dir` (+1 down, -1 up) until it
 * overlaps no placed box. Movement is monotonic, so it always terminates.
 * Returns the free centre Y, or null after MAX_PASSES.
 */
function pushClear(
  cx: number, cy: number, w: number, h: number, dir: number, placed: PlacedRect[],
): number | null {
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    const hit = placed.find((q) => overlaps(cx, cy, w, h, q));
    if (!hit) return cy;
    cy = hit.cy + dir * ((h + hit.h) / 2 + SEPARATION_PX);
  }
  return null;
}

/**
 * Greedy 2D de-collision.
 *
 * Projects every label to screen space, processes them highest-priority
 * first, and pushes each colliding label away from the collider's centre
 * until its box is clear (or MAX_PASSES is hit). The final screen positions
 * are unprojected back to world space on their original view ray, so each
 * billboard stays at the same depth, close to its neuron.
 *
 * Runs in O(n^2); trivial for ~14 labels. Returns outputs in INPUT order.
 */
export function resolveLabelCollisions(
  inputs: ScreenLabelInput[],
  camera: THREE.Camera,
  viewport: Viewport,
): ScreenLabelOutput[] {
  if (inputs.length === 0) return [];
  camera.updateMatrixWorld();

  const items = inputs.map((inp) => {
    const behind = isBehindCamera(inp.world, camera);
    const p = behind ? null : projectToScreen(inp.world, camera, viewport);
    const { width, height } = behind
      ? { width: 0, height: 0 }
      : estimateLabelSize(inp.text, inp.fontSize, inp.world, camera, viewport);
    return {
      ...inp,
      behind,
      sx: p ? p.x : 0,
      sy: p ? p.y : 0,
      depth: p ? p.depth : 0,
      width,
      height,
    };
  });

  // Highest priority first; ties keep their original screen order (stable).
  const order = [...items].sort((a, b) => b.priority - a.priority || a.sy - b.sy);

  const placed: PlacedRect[] = [];
  for (const it of order) {
    let cx = it.sx;
    let cy = it.sy;
    if (!it.behind) {
      // Keep the label inside the viewport horizontally.
      cx = Math.min(Math.max(cx, it.width / 2), viewport.width - it.width / 2);
      const first = placed.find((q) => overlaps(cx, it.sy, it.width, it.height, q));
      if (first) {
        // Push monotonically in ONE direction (away from the first collider).
        // Alternating directions made a label caught between two placed ones
        // bounce between them and stay overlapped once MAX_PASSES ran out.
        const dir = it.sy === first.cy ? 1 : Math.sign(it.sy - first.cy);
        const a = pushClear(cx, it.sy, it.width, it.height, dir, placed);
        const b = pushClear(cx, it.sy, it.width, it.height, -dir, placed);
        const fits = (y: number | null) =>
          y !== null && y >= it.height / 2 && y <= viewport.height - it.height / 2;
        // prefer the away direction; fall back to the other if it leaves the screen
        const pick = fits(a) ? a : fits(b) ? b : (a ?? b);
        if (pick !== null) cy = pick;
      }
      cy = Math.min(Math.max(cy, it.height / 2), viewport.height - it.height / 2);
    }
    placed.push({ id: it.id, cx, cy, w: it.width, h: it.height });
  }

  const byId = new Map<string, PlacedRect>();
  for (const p of placed) byId.set(p.id, p);
  const srcById = new Map<string, (typeof items)[number]>();
  for (const i of items) srcById.set(i.id, i);

  return inputs.map((inp) => {
    const src = srcById.get(inp.id)!;
    if (src.behind) return { id: inp.id, world: inp.world }; // leave it alone
    const p = byId.get(inp.id)!;
    const ndc = new THREE.Vector3(
      (p.cx / viewport.width) * 2 - 1,
      -((p.cy / viewport.height) * 2 - 1),
      src.depth,
    );
    ndc.unproject(camera);
    const world: V3 = [ndc.x, ndc.y, ndc.z];
    return { id: inp.id, world };
  });
}

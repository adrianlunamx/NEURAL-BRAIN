/**
 * @deprecated Superseded by labelLayout2D.ts (screen-space de-collision).
 * FloatingLabels.tsx is now the single renderer for region + CONNECT labels;
 * this module is kept for reference only and is no longer imported.
 */
// labelLayout — v2.1 de-collision for the CONNECT-phase floating labels.
//
// Pure function (no React, no three.js): given the floating "%" labels of
// the CONNECT phase as 3D anchors, it staggers them along the Y axis so no
// two labels overlap. Labels are only ever pushed DOWNWARD, never sideways,
// which keeps the layout stable while the brain rotates.
//
// Usage:
//   import { layoutLabels } from "./labelLayout";
//
//   const laidOut = layoutLabels(
//     hits.map((h) => ({
//       id: h.id,
//       x: h.position[0],
//       y: h.position[1] + 0.6, // float above the neuron
//       z: h.position[2],
//       priority: h.score ?? 0, // best match keeps its spot
//     })),
//     { minGap: 0.9 },
//   );
//   // laidOut[i] matches hits[i] (input order preserved).
//   // Render each billboard at (x, ly, z) instead of (x, y, z).

export interface LabelItem {
  /** Stable unique id of the label (neuron id, hit id, ...). */
  id: string;
  /** Original 3D anchor of the label. */
  x: number;
  y: number;
  z: number;
  /**
   * Higher-priority labels claim their original position first; lower
   * priority ones are pushed down on collision. Use the semantic match
   * score (0..1) here so the best matches stay closest to their neurons.
   */
  priority: number;
}

export interface LaidOutLabel extends LabelItem {
  /** De-collided Y position. Render the billboard at (x, ly, z). */
  ly: number;
}

export interface LayoutOptions {
  /**
   * Minimum vertical gap between two labels, in world units.
   * Default 0.9 (~2x the CONNECT label font size of 0.42). Raise it if
   * you render labels with a larger fontSize.
   */
  minGap?: number;
}

export const DEFAULT_MIN_GAP = 0.9;

/**
 * Stagger labels along Y so none overlap.
 *
 * Algorithm: process labels top-down (highest y first, ties broken by
 * priority); each label keeps its y unless it lands within `minGap` of an
 * already placed label, in which case it is pushed just below it. Runs in
 * O(n^2) — trivial for the tens of labels of a CONNECT phase.
 *
 * Note: staggering happens in 3D world space on the Y axis, not in screen
 * space. That is deliberate: it is camera-independent and stays stable
 * while the brain rotates. Labels at very different x/z can still overlap
 * on screen at extreme angles; the Y stagger covers the common case.
 *
 * Returns the labels in the SAME order as the input array.
 */
export function layoutLabels(
  items: LabelItem[],
  options: LayoutOptions = {},
): LaidOutLabel[] {
  const minGap = options.minGap ?? DEFAULT_MIN_GAP;
  if (items.length === 0) return [];

  // Top-down: highest anchor first; on ties, higher priority wins its spot.
  const order = [...items].sort(
    (a, b) => b.y - a.y || b.priority - a.priority,
  );

  const placed: LaidOutLabel[] = [];
  for (const item of order) {
    let ly = item.y;
    // Every previously placed label sits at or above the candidate level
    // (we only ever push downward), so a single pass is enough.
    for (const p of placed) {
      if (Math.abs(p.ly - ly) < minGap) {
        ly = p.ly - minGap;
      }
    }
    placed.push({ ...item, ly });
  }

  const byId = new Map<string, LaidOutLabel>();
  for (const p of placed) byId.set(p.id, p);
  return items.map((item) => {
    const laid = byId.get(item.id);
    // Defensive fallback (ids are unique by contract).
    return laid ?? { ...item, ly: item.y };
  });
}

// Screen-space de-collision for the small HTML chips of the agents and sessions
// ("#1 · busca", "web-app · Cursor"...). They are fixed-size DOM pills, so they
// are laid out in pixels: every chip keeps its anchor and is only shifted
// vertically (monotonically, so it always settles) until it overlaps no other.
import { useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

export interface Pill {
  /** DOM element of the chip (its transform is rewritten here). */
  el: HTMLElement;
  /** World anchor (the marker or hub it belongs to). */
  world: THREE.Vector3;
  /** Higher keeps its place; lower moves out of the way. */
  priority: number;
  /** Base vertical offset in px (chips sit above their dot). */
  lift: number;
}

export const pills = new Map<string, Pill>();

const RELAYOUT_MS = 150;
const GAP = 3;
const MAX_PASSES = 30;

interface Rect { cx: number; cy: number; w: number; h: number }

function overlaps(a: Rect, b: Rect): boolean {
  return Math.abs(a.cx - b.cx) < (a.w + b.w) / 2 && Math.abs(a.cy - b.cy) < (a.h + b.h) / 2;
}

/** Mount once inside the Canvas. */
export function PillDecollider() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const v = useMemo(() => new THREE.Vector3(), []);
  const last = useRef(0);

  useFrame(() => {
    const now = performance.now();
    if (now - last.current < RELAYOUT_MS) return;
    last.current = now;
    const items = [...pills.entries()]
      .filter(([, p]) => p.el.isConnected)
      .map(([id, p]) => {
        v.copy(p.world).project(camera);
        return {
          id, p, behind: v.z > 1,
          cx: (v.x * 0.5 + 0.5) * size.width,
          cy: (-v.y * 0.5 + 0.5) * size.height - p.lift,
          w: p.el.offsetWidth || 60, h: p.el.offsetHeight || 16,
        };
      })
      .sort((a, b) => b.p.priority - a.p.priority || a.cy - b.cy);

    const placed: Rect[] = [];
    for (const it of items) {
      const r: Rect = { cx: it.cx, cy: it.cy, w: it.w + GAP, h: it.h + GAP };
      if (!it.behind) {
        for (let pass = 0; pass < MAX_PASSES; pass++) {
          const hit = placed.find((q) => overlaps(r, q));
          if (!hit) break;
          r.cy = hit.cy - (r.h + hit.h) / 2;  // always upward: monotonic, terminates
        }
        placed.push(r);
      }
      const dy = r.cy - it.cy;
      it.p.el.style.transform = `translateY(${Math.round(-it.p.lift + dy)}px)`;
    }
  });
  return null;
}

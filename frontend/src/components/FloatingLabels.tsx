import { useEffect, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Text } from "@react-three/drei";
import * as THREE from "three";
import { FONT_URL } from "../config";
import { useBrainStore } from "../store/brainStore";
import { livePositions, searchMatches, useNotesStore, visibleNotes } from "../store/notesStore";
import { arousal, lit } from "../store/arousal";
import { resolveLabelCollisions, ScreenLabelInput, V3 } from "./labelLayout2D";

const GROUP_FONT = 0.1;       // region/group names: tiny and faint...
const SCALE_REF = 14;         // camera distance at which labels have their nominal size
const GROUP_NEAR = 9;         // ...and only when the camera comes this close (world units)
const GROUP_FADE = 2;         // fade-in distance before GROUP_NEAR
const NOTE_FONT = 0.16;
const HIT_FONT = 0.34;
const RELAYOUT_MS = 300;
const TOP_NOTES = 12;

type Kind = "group" | "note" | "focus" | "hit";

interface LabelSpec extends ScreenLabelInput {
  kind: Kind;
  color: string;
  /** 0..1 visibility (group names fade in as the camera approaches) */
  fade?: number;
}

interface Placed extends LabelSpec {
  at: V3;
}

/**
 * World-size text grows as the camera approaches; shrink it with the distance
 * so labels keep a near-constant size on screen instead of turning into stickers.
 */
function screenScale(camera: THREE.Camera, p: THREE.Vector3 | V3): number {
  const d = Array.isArray(p) ? camera.position.distanceTo(new THREE.Vector3(...p)) : camera.position.distanceTo(p);
  return Math.min(1, Math.max(0.25, d / SCALE_REF));
}

/** Collects every label that should be on screen right now (positions are live). */
function collectSpecs(camera: THREE.Camera): LabelSpec[] {
  const ns = useNotesStore.getState();
  const bs = useBrainStore.getState();
  const specs: LabelSpec[] = [];
  const view = ns.view;
  if (view) {
    const notes = visibleNotes(ns);
    // group names over the centre of their notes (only up close, see GROUP_NEAR)
    const sums = new Map<string, { p: THREE.Vector3; n: number }>();
    for (const n of notes) {
      const p = livePositions.get(n.id);
      if (!p) continue;
      const s = sums.get(n.group) ?? { p: new THREE.Vector3(), n: 0 };
      s.p.add(p);
      s.n++;
      sums.set(n.group, s);
    }
    for (const g of view.groups) {
      const s = sums.get(g.name);
      if (!s) continue;
      const c = s.p.divideScalar(s.n);
      c.y += 0.45;
      const dist = camera.position.distanceTo(c);
      if (dist > GROUP_NEAR) continue;  // far away: the brain speaks for itself
      specs.push({
        id: `group:${g.name}`, kind: "group", world: [c.x, c.y, c.z],
        text: g.name, fontSize: GROUP_FONT * screenScale(camera, c), priority: 0.5, color: g.color,
        fade: Math.min(1, (GROUP_NEAR - dist) / GROUP_FADE),
      });
    }
    // note titles: the most connected ones, search matches, hovered / selected
    const matches = searchMatches(view, ns.search);
    const focus = new Set([ns.hovered, ns.selected].filter(Boolean) as string[]);
    const chosen = new Set<string>(focus);
    if (matches) notes.filter((n) => matches.has(n.id)).slice(0, TOP_NOTES).forEach((n) => chosen.add(n.id));
    else [...notes].sort((a, b) => b.degree - a.degree).slice(0, TOP_NOTES).forEach((n) => chosen.add(n.id));
    for (const n of notes) {
      if (!chosen.has(n.id)) continue;
      const p = livePositions.get(n.id);
      if (!p) continue;
      const isFocus = focus.has(n.id);
      const k = screenScale(camera, p);
      specs.push({
        id: `note:${n.id}`, kind: isFocus ? "focus" : "note", world: [p.x, p.y + 0.32, p.z],
        text: n.title.length > 34 ? `${n.title.slice(0, 33)}…` : n.title,
        fontSize: (isFocus ? NOTE_FONT * 1.4 : NOTE_FONT) * k, priority: isFocus ? 4 : 1 + n.degree / 100,
        color: isFocus ? "#ffffff" : "#c9d4ee",
      });
    }
  }
  // query CONNECT phase: the matched memories with their score
  if (bs.phase === "CONNECT") {
    for (const h of bs.phasePayload?.hits ?? []) {
      specs.push({
        id: `hit:${h.id}`, kind: "hit", world: [h.position[0], h.position[1] + 0.6, h.position[2]],
        text: `${h.label.slice(0, 26)}  ${(h.score * 100).toFixed(0)}%`,
        fontSize: HIT_FONT, priority: 5 + (h.score ?? 0), color: "#ffffff",  // the query owns the screen
      });
    }
  }
  return specs;
}

/**
 * Single renderer for every floating label: group names, note titles and the
 * query "%" labels, de-collided together in screen space (labelLayout2D).
 * Re-laid out every 300 ms, so labels follow the animated layout and camera.
 */
export function FloatingLabels() {
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const [placed, setPlaced] = useState<Placed[]>([]);
  const last = useRef(0);
  const shownLevel = useRef(-1);
  const [, setTick] = useState(0);

  const relayout = () => {
    const specs = collectSpecs(camera);
    const out = resolveLabelCollisions(specs, camera, { width: size.width, height: size.height });
    setPlaced(specs.map((s, i) => ({ ...s, at: out[i].world })));
    last.current = performance.now();
  };

  // hover / selection / filters change: lay out right away
  useEffect(() => useNotesStore.subscribe(() => {
    if (performance.now() - last.current > 60) relayout();
  }));

  useFrame(() => {
    if (performance.now() - last.current >= RELAYOUT_MS) relayout();
    // Smooth arousal dimming: fillOpacity reads arousal.level at render time,
    // so re-render while the level is moving (it settles, so this stops on its own).
    if (Math.abs(arousal.level - shownLevel.current) > 0.02) {
      shownLevel.current = arousal.level;
      setTick((t) => t + 1);
    }
  });

  return (
    <group>
      {placed.map((l) => (
        <Billboard key={l.id} position={l.at}>
          <Text
            font={FONT_URL}
            renderOrder={l.kind === "note" ? 0 : 10}
            material-depthTest={false}
            fontSize={l.fontSize}
            letterSpacing={l.kind === "group" ? 0.04 : 0}
            color={l.color}
            fillOpacity={l.kind === "group"
              ? 0.6 * (l.fade ?? 1)
              : (l.kind === "note" ? 0.7 : 1) * (l.kind === "hit" || l.kind === "focus" ? 1 : lit(0.35))}
            anchorX="center"
            anchorY="middle"
            outlineWidth={l.kind === "group" ? 0.003 : 0.018 * Math.min(1, l.fontSize / NOTE_FONT)}
            outlineColor="#05060a"
            outlineOpacity={l.kind === "group" ? 0.45 * (l.fade ?? 1) : 0.8}
          >
            {l.text}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}

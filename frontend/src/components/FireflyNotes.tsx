import { useEffect, useMemo, useRef } from "react";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  livePositions, noteAwake, onNotePulse, searchMatches, useNotesStore, visibleNotes,
} from "../store/notesStore";
import { arousal } from "../store/arousal";
import { useBrainStore } from "../store/brainStore";
import { Note, NoteType } from "../types";

/**
 * Kept for the 2D legend (ui/common.tsx TypeIcon draws these glyphs).
 * The 3D layer no longer draws shapes — every note is a firefly — but the
 * panel legend keeps its ▲◆● glyphs so note types stay identifiable there.
 */
export const TYPE_SHAPE: Record<NoteType, number> = {
  instrucciones: 0, referencia: 0, documento: 0, // triangle
  indice: 1,        // diamond
  usuario: 2,       // circle
  feedback: 3,      // inverted triangle
  proyecto: 4,      // square
  handoff: 5,       // small dot
};

/** Base size multiplier per note type: the type now shows as firefly "species". */
export const FIREFLY_SIZE: Record<NoteType, number> = {
  instrucciones: 1.15,
  indice: 1.0,
  usuario: 1.25,
  feedback: 0.95,
  proyecto: 1.1,
  referencia: 1.0,
  documento: 0.9,
  handoff: 0.7,
};

/** Deterministic pseudo-random in [0,1) from a string id (stable across renders). */
function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float phase;
  attribute float emphasis;
  attribute float pulse;
  attribute float awake;
  uniform float uScale;
  uniform float uTime;
  uniform float uArousal;
  varying vec3 vColor;
  varying float vGlow;
  varying float vEmphasis;
  varying float vPulse;
  void main() {
    // Firefly rhythm: irregular "breathing" flash, each with its own phase.
    // pow() sharpens the sine into flashes; the second sine detunes the rhythm
    // so neighbouring fireflies never blink in sync.
    float w = 0.9 + 0.6 * sin(phase * 3.1);
    float s1 = 0.5 + 0.5 * sin(uTime * w + phase);
    float s2 = 0.5 + 0.5 * sin(uTime * w * 2.63 + phase * 1.7 + 1.3);
    float blink = pow(s1, 3.0) * (0.55 + 0.45 * s2);
    float glow = 0.22 + 0.78 * blink; // never fully dark: a dim ember remains
    // asleep until used: a note an agent/query just touched (or hovered, found)
    // shines fully; the rest follow how awake the whole brain is
    float wake = max(awake, max(uArousal * 0.6, step(1.5, emphasis)));
    glow *= mix(0.16, 1.0, wake);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = size * mix(0.7, 1.0, wake) * (0.85 + 0.35 * blink)
      * (1.0 + pulse * 1.2 + max(emphasis - 1.0, 0.0) * 0.5)
      * uScale / -mv.z;
    gl_PointSize = min(px, 96.0); // cap: no giant blobs when zoomed in close
    vColor = color;
    vGlow = glow;
    vEmphasis = emphasis;
    vPulse = pulse;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vGlow;
  varying float vEmphasis;
  varying float vPulse;
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    float d = length(p);
    if (d > 1.0) discard;
    // Soft radial firefly: hot white core + wide faint halo.
    float core = exp(-d * d * 10.0);
    float halo = exp(-d * 4.0) * 0.45;
    float alpha = (core + halo) * vGlow * clamp(vEmphasis, 0.0, 1.0);
    if (alpha < 0.01) discard;
    vec3 c = mix(vColor, vec3(1.0), core * (0.35 + 0.45 * vPulse));
    gl_FragColor = vec4(c * (core * 1.6 + halo) * (1.0 + vPulse * 2.0), alpha);
  }
`;

const USAGE_RAMP = ["#1b2a6b", "#2f6bff", "#29d3e6", "#ffd24d", "#ffffff"].map((c) => new THREE.Color(c));

function usageColor(t: number, out: THREE.Color): THREE.Color {
  const x = Math.min(0.999, Math.max(0, t)) * (USAGE_RAMP.length - 1);
  const i = Math.floor(x);
  return out.copy(USAGE_RAMP[i]).lerp(USAGE_RAMP[i + 1], x - i);
}

/** Moves livePositions toward the D3 layout targets (smooth "Reacomodar"). */
export function NotesAnimator() {
  useFrame((_, delta) => {
    const { targets, view } = useNotesStore.getState();
    const k = 1 - Math.exp(-delta * 3.2);
    for (const [id, t] of targets) {
      let p = livePositions.get(id);
      if (!p) {
        const note = view?.notes.find((n) => n.id === id);
        const g = view?.groups.find((gr) => gr.name === note?.group);
        p = new THREE.Vector3(...(g?.anchor ?? t));
        livePositions.set(id, p);
      }
      p.x += (t[0] - p.x) * k;
      p.y += (t[1] - p.y) * k;
      p.z += (t[2] - p.z) * k;
    }
    for (const id of livePositions.keys()) if (!targets.has(id)) livePositions.delete(id);
    const fade = Math.exp(-delta * 0.12);
    for (const [id, v] of noteAwake) {
      if (v * fade < 0.02) noteAwake.delete(id); else noteAwake.set(id, v * fade);
    }
  });
  return null;
}

/** Every note as a firefly: soft pulsing glow, coloured by group (or by usage). */
export function FireflyNotes() {
  const view = useNotesStore((s) => s.view);
  const hiddenGroups = useNotesStore((s) => s.hiddenGroups);
  const hiddenTypes = useNotesStore((s) => s.hiddenTypes);
  const search = useNotesStore((s) => s.search);
  const hovered = useNotesStore((s) => s.hovered);
  const selected = useNotesStore((s) => s.selected);
  const colorBy = useNotesStore((s) => s.colorBy);
  const usage = useNotesStore((s) => s.activity?.note_usage);
  const setHovered = useNotesStore((s) => s.setHovered);
  const select = useNotesStore((s) => s.select);
  const size = useThree((s) => s.size);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const pointsRef = useRef<THREE.Points>(null!);
  const frame = useRef(0);

  const notes: Note[] = useMemo(
    () => visibleNotes({ view, hiddenGroups, hiddenTypes }),
    [view, hiddenGroups, hiddenTypes],
  );

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uScale: { value: 700 }, uTime: { value: 0 }, uArousal: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  const geometry = useMemo(() => {
    const n = notes.length;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    g.setAttribute("size", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("phase", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("emphasis", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("pulse", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("awake", new THREE.BufferAttribute(new Float32Array(n), 1));
    return g;
  }, [notes]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // static attributes: colour, size, blink phase, emphasis
  useEffect(() => {
    if (!view) return;
    const groupColor = new Map(view.groups.map((g) => [g.name, new THREE.Color(g.color)]));
    const matches = searchMatches(view, search);
    const maxUse = Math.max(1, ...Object.values(usage ?? {}));
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const sz = geometry.getAttribute("size") as THREE.BufferAttribute;
    const ph = geometry.getAttribute("phase") as THREE.BufferAttribute;
    const em = geometry.getAttribute("emphasis") as THREE.BufferAttribute;
    const c = new THREE.Color();
    notes.forEach((n, i) => {
      if (colorBy === "uso") usageColor(Math.log1p(usage?.[n.id] ?? 0) / Math.log1p(maxUse), c);
      else c.copy(groupColor.get(n.group) ?? c.set("#ffffff"));
      col.setXYZ(i, c.r, c.g, c.b);
      sz.setX(i, (0.5 + Math.min(0.6, Math.sqrt(n.degree) * 0.09)) * (FIREFLY_SIZE[n.type] ?? 1));
      ph.setX(i, hash01(n.id) * Math.PI * 2);
      let e = 1;
      if (matches) e = matches.has(n.id) ? 1.6 : 0.18;
      if (n.id === hovered || n.id === selected) e = 2;
      em.setX(i, e);
    });
    col.needsUpdate = sz.needsUpdate = ph.needsUpdate = em.needsUpdate = true;
  }, [geometry, notes, view, search, hovered, selected, colorBy, usage]);

  // pulses: an agent touched a note -> its firefly flares up
  const pulses = useRef(new Map<string, number>());
  useEffect(() => onNotePulse((id) => { pulses.current.set(id, 1); }), []);

  useFrame((_, delta) => {
    const anim = useBrainStore.getState().settings.anim;
    if (anim) material.uniforms.uTime.value += delta; // frozen blink when animations off
    material.uniforms.uScale.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 50) / 2));
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const pul = geometry.getAttribute("pulse") as THREE.BufferAttribute;
    const awk = geometry.getAttribute("awake") as THREE.BufferAttribute;
    material.uniforms.uArousal.value = arousal.level;
    const decay = Math.exp(-delta * 0.8);
    notes.forEach((n, i) => {
      const p = livePositions.get(n.id);
      if (p) pos.setXYZ(i, p.x, p.y, p.z);
      awk.setX(i, noteAwake.get(n.id) ?? 0);
      const v = pulses.current.get(n.id) ?? 0;
      pul.setX(i, v);
      if (v > 0) {
        const next = v * decay;
        if (next < 0.02) pulses.current.delete(n.id); else pulses.current.set(n.id, next);
      }
    });
    pos.needsUpdate = pul.needsUpdate = awk.needsUpdate = true;
    if (frame.current++ % 30 === 0) geometry.computeBoundingSphere();
  });

  const idAt = (e: ThreeEvent<PointerEvent | MouseEvent>) =>
    e.index !== undefined ? notes[e.index]?.id ?? null : null;

  return (
    <points
      ref={pointsRef}
      geometry={geometry}
      material={material}
      frustumCulled={false}
      onPointerMove={(e) => { e.stopPropagation(); const id = idAt(e); if (id !== hovered) setHovered(id); }}
      onPointerOut={() => setHovered(null)}
      onClick={(e) => { e.stopPropagation(); select(idAt(e)); }}
    />
  );
}

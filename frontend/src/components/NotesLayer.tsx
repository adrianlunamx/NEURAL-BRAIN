import { useEffect, useMemo, useRef } from "react";
import { ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import {
  livePositions, onNotePulse, searchMatches, useNotesStore, visibleNotes,
} from "../store/notesStore";
import { Note, NoteType } from "../types";

/** Shape drawn for each note type (see the fragment shader). */
export const TYPE_SHAPE: Record<NoteType, number> = {
  instrucciones: 0, referencia: 0, documento: 0, // triangle
  indice: 1,        // diamond
  usuario: 2,       // circle
  feedback: 3,      // inverted triangle
  proyecto: 4,      // square
  handoff: 5,       // small dot
};

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float size;
  attribute float shape;
  attribute float emphasis;
  attribute float pulse;
  uniform float uScale;
  varying vec3 vColor;
  varying float vShape;
  varying float vEmphasis;
  varying float vPulse;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = size * (1.0 + pulse * 0.8 + max(emphasis - 1.0, 0.0) * 0.5) * uScale / -mv.z;
    vColor = color;
    vShape = shape;
    vEmphasis = emphasis;
    vPulse = pulse;
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vShape;
  varying float vEmphasis;
  varying float vPulse;
  float sdTri(vec2 p, float r) {
    const float k = 1.7320508;
    p.x = abs(p.x) - r;
    p.y = p.y + r / k;
    if (p.x + k * p.y > 0.0) p = vec2(p.x - k * p.y, -k * p.x - p.y) / 2.0;
    p.x -= clamp(p.x, -2.0 * r, 0.0);
    return -length(p) * sign(p.y);
  }
  void main() {
    vec2 p = gl_PointCoord * 2.0 - 1.0;
    p.y = -p.y;
    float d;
    int s = int(vShape + 0.5);
    if (s == 0) d = sdTri(p - vec2(0.0, -0.05), 0.36);
    else if (s == 1) d = (abs(p.x) + abs(p.y)) * 0.7071 - 0.26;
    else if (s == 2) d = length(p) - 0.26;
    else if (s == 3) d = sdTri(vec2(p.x, -p.y) - vec2(0.0, -0.05), 0.36);
    else if (s == 4) { vec2 q = abs(p) - vec2(0.22); d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
    else d = length(p) - 0.14;
    float core = 1.0 - smoothstep(-0.02, 0.03, d);
    float glow = exp(-max(d, 0.0) * 6.0) * (0.7 + vPulse * 0.9);
    float alpha = clamp(core + glow, 0.0, 1.0) * clamp(vEmphasis, 0.0, 1.0);
    if (alpha < 0.01) discard;
    vec3 c = mix(vColor, vec3(1.0), core * (0.25 + vPulse * 0.5));
    gl_FragColor = vec4(c * (core * 1.25 + glow), alpha);
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
  });
  return null;
}

/** Every note as a glowing shape (triangle, diamond...) coloured by group or by usage. */
export function NotesLayer() {
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
    uniforms: { uScale: { value: 700 } },
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
    g.setAttribute("shape", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("emphasis", new THREE.BufferAttribute(new Float32Array(n), 1));
    g.setAttribute("pulse", new THREE.BufferAttribute(new Float32Array(n), 1));
    return g;
  }, [notes]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // static attributes: colour, size, shape, emphasis
  useEffect(() => {
    if (!view) return;
    const groupColor = new Map(view.groups.map((g) => [g.name, new THREE.Color(g.color)]));
    const matches = searchMatches(view, search);
    const maxUse = Math.max(1, ...Object.values(usage ?? {}));
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const sz = geometry.getAttribute("size") as THREE.BufferAttribute;
    const sh = geometry.getAttribute("shape") as THREE.BufferAttribute;
    const em = geometry.getAttribute("emphasis") as THREE.BufferAttribute;
    const c = new THREE.Color();
    notes.forEach((n, i) => {
      if (colorBy === "uso") usageColor(Math.log1p(usage?.[n.id] ?? 0) / Math.log1p(maxUse), c);
      else c.copy(groupColor.get(n.group) ?? c.set("#ffffff"));
      col.setXYZ(i, c.r, c.g, c.b);
      sz.setX(i, 0.5 + Math.min(0.6, Math.sqrt(n.degree) * 0.09));
      sh.setX(i, TYPE_SHAPE[n.type] ?? 0);
      let e = 1;
      if (matches) e = matches.has(n.id) ? 1.6 : 0.18;
      if (n.id === hovered || n.id === selected) e = 2;
      em.setX(i, e);
    });
    col.needsUpdate = sz.needsUpdate = sh.needsUpdate = em.needsUpdate = true;
  }, [geometry, notes, view, search, hovered, selected, colorBy, usage]);

  // pulses: an agent touched a note
  const pulses = useRef(new Map<string, number>());
  useEffect(() => onNotePulse((id) => { pulses.current.set(id, 1); }), []);

  useFrame((_, delta) => {
    material.uniforms.uScale.value = size.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov ?? 50) / 2));
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const pul = geometry.getAttribute("pulse") as THREE.BufferAttribute;
    const decay = Math.exp(-delta * 0.8);
    notes.forEach((n, i) => {
      const p = livePositions.get(n.id);
      if (p) pos.setXYZ(i, p.x, p.y, p.z);
      const v = pulses.current.get(n.id) ?? 0;
      pul.setX(i, v);
      if (v > 0) {
        const next = v * decay;
        if (next < 0.02) pulses.current.delete(n.id); else pulses.current.set(n.id, next);
      }
    });
    pos.needsUpdate = pul.needsUpdate = true;
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

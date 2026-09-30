import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_NEURONS } from "../types";
import { onActivation, onNeuronUpsert, onSpark, useBrainStore } from "../store/brainStore";
import { arousal } from "../store/arousal";

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float seed;
  attribute float act;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uArousal;
  uniform float uWarm;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + seed * 1.7) + seed * 40.0);
    gl_PointSize = (2.1 + act * 5.0) * uPixelRatio * (16.0 / -mv.z);
    vColor = mix(color, vec3(1.0), 0.35 + act * 0.5);
    vColor = mix(vColor, vec3(1.0, 0.74, 0.42), 0.75 * uWarm);  // organic: golden sparks
    // at rest only a faint silhouette; the whole field brightens while thinking,
    // and each fired neuron glows on its own until it fades
    float rest = mix(0.045, 0.42, uArousal) * mix(1.0, 0.18, uWarm);  // organic: only the firing neurons spark
    vAlpha = rest * twinkle + act * mix(0.95, 0.8, uWarm);
    gl_Position = projectionMatrix * mv;
  }
`;

const fragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float a = smoothstep(0.5, 0.0, d);
    gl_FragColor = vec4(vColor * a, a * vAlpha);
  }
`;

const CELL = 0.6;           // spatial hash cell (world units)
const WAVE_SPEED = 3.5;     // units per second: how fast a firing spreads
const FADE_PER_SECOND = 0.3; // fired neurons fade in ~15 s (exp decay, cut at 0.01)

interface Pending { i: number; at: number; amount: number }

function cellKey(x: number, y: number, z: number): string {
  return `${Math.floor(x / CELL)},${Math.floor(y / CELL)},${Math.floor(z / CELL)}`;
}

/**
 * The 19,000 neurons as fine luminous dust that draws the brain.
 * Dark at rest: neurons light up when they fire (hooks, queries) and the firing
 * spreads to their neighbours as a wave, then everything fades back.
 * One THREE.Points (1 draw call); no React re-renders on activity.
 */
export function NeuronDust() {
  const graphVersion = useBrainStore((s) => s.graphVersion);
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const pointsRef = useRef<THREE.Points>(null!);
  const indexOf = useRef(new Map<string, number>());
  const active = useRef(new Set<number>());
  const grid = useRef(new Map<string, number[]>());
  const pending = useRef<Pending[]>([]);
  const clockRef = useRef(0);

  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAX_NEURONS * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(MAX_NEURONS * 3), 3));
    g.setAttribute("seed", new THREE.BufferAttribute(new Float32Array(MAX_NEURONS), 1));
    g.setAttribute("act", new THREE.BufferAttribute(new Float32Array(MAX_NEURONS), 1));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({
      vertexShader: vertex,
      fragmentShader: fragment,
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uArousal: { value: 0 }, uWarm: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, []);

  const addToGrid = (i: number, x: number, y: number, z: number) => {
    const key = cellKey(x, y, z);
    const list = grid.current.get(key);
    if (list) list.push(i); else grid.current.set(key, [i]);
  };

  // (re)build every point from the store after a full graph load
  useEffect(() => {
    const { neurons, neuronOrder } = useBrainStore.getState();
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const seed = geometry.getAttribute("seed") as THREE.BufferAttribute;
    const c = new THREE.Color();
    indexOf.current.clear();
    grid.current.clear();
    let i = 0;
    for (const id of neuronOrder) {
      const n = neurons.get(id);
      if (!n || i >= MAX_NEURONS) continue;
      pos.setXYZ(i, n.position[0], n.position[1], n.position[2]);
      c.set(n.color);
      col.setXYZ(i, c.r, c.g, c.b);
      seed.setX(i, Math.random());
      indexOf.current.set(id, i);
      addToGrid(i, n.position[0], n.position[1], n.position[2]);
      i++;
    }
    geometry.setDrawRange(0, i);
    pos.needsUpdate = col.needsUpdate = seed.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [geometry, graphVersion]);

  useEffect(() => {
    const act = geometry.getAttribute("act") as THREE.BufferAttribute;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;

    const fire = (i: number, amount: number) => {
      act.setX(i, Math.max(act.getX(i), amount));
      active.current.add(i);
    };

    // schedule a wave of firings around a point: nearer neurons fire first and stronger
    const spark = (p: [number, number, number], amount: number, radius: number) => {
      const r = Math.ceil(radius / CELL);
      const cx = Math.floor(p[0] / CELL), cy = Math.floor(p[1] / CELL), cz = Math.floor(p[2] / CELL);
      for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) for (let dz = -r; dz <= r; dz++) {
        const list = grid.current.get(`${cx + dx},${cy + dy},${cz + dz}`);
        if (!list) continue;
        for (const i of list) {
          if (Math.random() > 0.65) continue; // not every neuron answers: looks organic
          const d = Math.hypot(pos.getX(i) - p[0], pos.getY(i) - p[1], pos.getZ(i) - p[2]);
          if (d > radius) continue;
          const falloff = Math.pow(1 - d / radius, 1.5);
          pending.current.push({ i, at: clockRef.current + d / WAVE_SPEED, amount: amount * falloff * (0.5 + Math.random() * 0.5) });
        }
      }
    };

    const offAct = onActivation((id, amount) => {
      const i = indexOf.current.get(id);
      if (i === undefined) return;
      fire(i, amount);
      if (amount > 0.5) spark([pos.getX(i), pos.getY(i), pos.getZ(i)], amount * 0.7, 0.9);
    });
    const offSpark = onSpark(spark);
    const offUpsert = onNeuronUpsert((n) => {
      let i = indexOf.current.get(n.id);
      if (i === undefined) {
        i = geometry.drawRange.count;
        if (i >= MAX_NEURONS) return;
        indexOf.current.set(n.id, i);
        geometry.setDrawRange(0, i + 1);
      }
      pos.setXYZ(i, n.position[0], n.position[1], n.position[2]);
      addToGrid(i, n.position[0], n.position[1], n.position[2]);
      const col = geometry.getAttribute("color") as THREE.BufferAttribute;
      const c = new THREE.Color(n.color);
      col.setXYZ(i, c.r, c.g, c.b);
      pos.needsUpdate = col.needsUpdate = true;
    });
    return () => { offAct(); offSpark(); offUpsert(); };
  }, [geometry]);

  useFrame(({ clock }, delta) => {
    clockRef.current = clock.elapsedTime;
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = pixelRatio;
    material.uniforms.uArousal.value = arousal.level;
    material.uniforms.uWarm.value = arousal.warm;
    const act = geometry.getAttribute("act") as THREE.BufferAttribute;

    // fire the wave fronts that have arrived
    if (pending.current.length) {
      const now = clock.elapsedTime;
      const later: Pending[] = [];
      for (const p of pending.current) {
        if (p.at <= now) {
          act.setX(p.i, Math.max(act.getX(p.i), p.amount));
          active.current.add(p.i);
        } else later.push(p);
      }
      pending.current = later;
    }
    if (active.current.size === 0) return;
    const decay = Math.exp(-delta * FADE_PER_SECOND);
    for (const i of active.current) {
      const v = act.getX(i) * decay;
      if (v < 0.01) { act.setX(i, 0); active.current.delete(i); } else act.setX(i, v);
    }
    act.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

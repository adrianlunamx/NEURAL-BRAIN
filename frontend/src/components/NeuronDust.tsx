import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_NEURONS } from "../types";
import { onActivation, onNeuronUpsert, onRegionBurst, onSpark, useBrainStore } from "../store/brainStore";
import { arousal } from "../store/arousal";
import { neuralSim, REGIONS } from "../sim/neuralSim";

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float seed;
  attribute float act;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uArousal;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float up = max(act, 0.0);
    float down = min(act, 0.0);   // after-hyperpolarisation: dimmer than rest for a moment
    float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + seed * 1.7) + seed * 40.0);
    // slow wave travelling front to back (same one that drives spontaneous firing)
    float slow = 0.72 + 0.28 * sin((position.x * 0.8 + position.y * 0.35) * 0.9 - uTime * 0.9);
    gl_PointSize = (2.1 + up * 5.0) * uPixelRatio * (16.0 / -mv.z);
    vColor = mix(color, vec3(1.0, 0.97, 0.9), 0.35 + up * 0.55);
    // at rest only a faint silhouette; the whole field brightens while thinking,
    // and each neuron flashes when it fires
    float rest = mix(0.045, 0.42, uArousal) * slow;
    vAlpha = rest * twinkle * (1.0 + down) + up * 0.95;
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

/** Neurons an agent or a query touched directly keep glowing, fading over ~15 s. */
const GLOW_FADE_PER_SECOND = 0.3;
/** Action potential as the eye sees it (time slowed ~100x): flash, then a dip below rest. */
const SPIKE_TAU = 0.28;
const DIP_DEPTH = 0.6;
const DIP_TAU = 0.7;
const FORGET_AFTER = 2.5;

function spikeCurve(t: number): number {
  if (t < 0) return 0;
  const flash = Math.exp(-t / SPIKE_TAU);
  const dip = t < 0.1 ? 0 : -DIP_DEPTH * Math.min(1, (t - 0.1) / 0.2) * Math.exp(-Math.max(0, t - 0.3) / DIP_TAU);
  return flash + dip;
}

/**
 * The 19,000 neurons as fine luminous dust that draws the brain, driven by a
 * spiking network (sim/neuralSim.ts): each point flashes when its neuron fires,
 * dims while it is refractory, and the firing spreads through synapses and
 * tracts. Hooks, queries and agents inject spikes; the network does the rest.
 * One THREE.Points (1 draw call); no React re-renders on activity.
 */
export function NeuronDust() {
  const graphVersion = useBrainStore((s) => s.graphVersion);
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const pointsRef = useRef<THREE.Points>(null!);
  const indexOf = useRef(new Map<string, number>());
  const active = useRef(new Set<number>());
  const glow = useRef(new Float32Array(MAX_NEURONS));

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
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 }, uArousal: { value: 0 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, []);

  // (re)build every point, and the network, from the store after a full graph load
  useEffect(() => {
    const { neurons, neuronOrder } = useBrainStore.getState();
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const seed = geometry.getAttribute("seed") as THREE.BufferAttribute;
    const region = new Uint8Array(MAX_NEURONS);
    const c = new THREE.Color();
    indexOf.current.clear();
    let i = 0;
    for (const id of neuronOrder) {
      const n = neurons.get(id);
      if (!n || i >= MAX_NEURONS) continue;
      pos.setXYZ(i, n.position[0], n.position[1], n.position[2]);
      c.set(n.color);
      col.setXYZ(i, c.r, c.g, c.b);
      seed.setX(i, Math.random());
      region[i] = Math.max(0, REGIONS.indexOf(n.region));
      indexOf.current.set(id, i);
      i++;
    }
    geometry.setDrawRange(0, i);
    pos.needsUpdate = col.needsUpdate = seed.needsUpdate = true;
    geometry.computeBoundingSphere();
    // the network shares the position buffer (moved neurons stay in sync)
    if (i) neuralSim.build(pos.array as Float32Array, region, i);
  }, [geometry, graphVersion]);

  useEffect(() => {
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;

    // an event touched this neuron: it fires now and keeps a long glow
    const offAct = onActivation((id, amount) => {
      const i = indexOf.current.get(id);
      if (i === undefined) return;
      glow.current[i] = Math.max(glow.current[i], amount);
      active.current.add(i);
      neuralSim.inject(i);
      if (amount > 0.5) neuralSim.stimulateAt([pos.getX(i), pos.getY(i), pos.getZ(i)], 0.9, amount * 0.7);
    });
    const offSpark = onSpark((p, amount, radius) => neuralSim.stimulateAt(p, radius, amount));
    const offBurst = onRegionBurst((region, fraction) => neuralSim.stimulateRegion(region, fraction));
    const offUpsert = onNeuronUpsert((n) => {
      let i = indexOf.current.get(n.id);
      if (i === undefined) {
        i = geometry.drawRange.count;
        if (i >= MAX_NEURONS) return;
        indexOf.current.set(n.id, i);
        geometry.setDrawRange(0, i + 1);
      }
      pos.setXYZ(i, n.position[0], n.position[1], n.position[2]);
      neuralSim.moveNeuron(i, n.position[0], n.position[1], n.position[2], Math.max(0, REGIONS.indexOf(n.region)));
      const col = geometry.getAttribute("color") as THREE.BufferAttribute;
      const c = new THREE.Color(n.color);
      col.setXYZ(i, c.r, c.g, c.b);
      pos.needsUpdate = col.needsUpdate = true;
    });
    return () => { offAct(); offSpark(); offBurst(); offUpsert(); };
  }, [geometry]);

  useFrame(({ clock }, delta) => {
    const now = clock.elapsedTime;
    material.uniforms.uTime.value = now;
    material.uniforms.uPixelRatio.value = pixelRatio;
    material.uniforms.uArousal.value = arousal.level;

    neuralSim.step(now, arousal.level);
    for (const i of neuralSim.fired) active.current.add(i);
    if (active.current.size === 0) return;

    const act = geometry.getAttribute("act") as THREE.BufferAttribute;
    const g = glow.current;
    const fade = Math.exp(-delta * GLOW_FADE_PER_SECOND);
    const last = neuralSim.last;
    for (const i of active.current) {
      if (g[i] > 0) g[i] = g[i] * fade < 0.01 ? 0 : g[i] * fade;
      const t = now - last[i];
      const v = Math.max(g[i], spikeCurve(t));
      if (g[i] === 0 && t > FORGET_AFTER) { act.setX(i, 0); active.current.delete(i); } else act.setX(i, v);
    }
    act.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

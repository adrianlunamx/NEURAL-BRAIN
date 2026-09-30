import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_NEURONS } from "../types";
import { onActivation, onNeuronUpsert, useBrainStore } from "../store/brainStore";

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float seed;
  attribute float act;
  uniform float uTime;
  uniform float uPixelRatio;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float twinkle = 0.75 + 0.25 * sin(uTime * (0.6 + seed * 1.7) + seed * 40.0);
    gl_PointSize = (2.1 + act * 5.0) * uPixelRatio * (16.0 / -mv.z);
    vColor = mix(color, vec3(1.0), 0.35 + act * 0.5);
    vAlpha = (0.42 * twinkle + act * 0.9);
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

/**
 * The 19,000 neurons as fine luminous dust that draws the brain.
 * One THREE.Points (1 draw call); activations brighten single points from the
 * activation bus without re-rendering React.
 */
export function NeuronDust() {
  const graphVersion = useBrainStore((s) => s.graphVersion);
  const pixelRatio = useThree((s) => s.viewport.dpr);
  const pointsRef = useRef<THREE.Points>(null!);
  const indexOf = useRef(new Map<string, number>());
  const active = useRef(new Set<number>());

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
      uniforms: { uTime: { value: 0 }, uPixelRatio: { value: 1 } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    return { geometry: g, material: m };
  }, []);

  // (re)build every point from the store after a full graph load
  useEffect(() => {
    const { neurons, neuronOrder } = useBrainStore.getState();
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const seed = geometry.getAttribute("seed") as THREE.BufferAttribute;
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
      indexOf.current.set(id, i);
      i++;
    }
    geometry.setDrawRange(0, i);
    pos.needsUpdate = col.needsUpdate = seed.needsUpdate = true;
    geometry.computeBoundingSphere();
  }, [geometry, graphVersion]);

  useEffect(() => {
    const act = geometry.getAttribute("act") as THREE.BufferAttribute;
    const offAct = onActivation((id, amount) => {
      const i = indexOf.current.get(id);
      if (i === undefined) return;
      act.setX(i, Math.max(act.getX(i), amount));
      active.current.add(i);
    });
    const offUpsert = onNeuronUpsert((n) => {
      let i = indexOf.current.get(n.id);
      if (i === undefined) {
        i = geometry.drawRange.count;
        if (i >= MAX_NEURONS) return;
        indexOf.current.set(n.id, i);
        geometry.setDrawRange(0, i + 1);
      }
      const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
      const col = geometry.getAttribute("color") as THREE.BufferAttribute;
      pos.setXYZ(i, n.position[0], n.position[1], n.position[2]);
      const c = new THREE.Color(n.color);
      col.setXYZ(i, c.r, c.g, c.b);
      pos.needsUpdate = col.needsUpdate = true;
    });
    return () => { offAct(); offUpsert(); };
  }, [geometry]);

  useFrame(({ clock }, delta) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uPixelRatio.value = pixelRatio;
    if (active.current.size === 0) return;
    const act = geometry.getAttribute("act") as THREE.BufferAttribute;
    const decay = Math.exp(-delta * 0.9);
    for (const i of active.current) {
      const v = act.getX(i) * decay;
      if (v < 0.01) { act.setX(i, 0); active.current.delete(i); } else act.setX(i, v);
    }
    act.needsUpdate = true;
  });

  return <points ref={pointsRef} geometry={geometry} material={material} frustumCulled={false} />;
}

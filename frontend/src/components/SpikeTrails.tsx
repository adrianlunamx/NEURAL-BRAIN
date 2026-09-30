import { useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { neuralSim, TRAILS } from "../sim/neuralSim";

/** Length of the lit stretch of axon behind the spike, as a fraction of the path. */
const LOCAL_STREAK = 0.55;
const TRACT_STREAK = 0.18;
/** After arriving, the streak drains into the synapse for this long (s). */
const DRAIN = 0.12;

/**
 * Action potentials travelling down the axons: every visible spike of the
 * network (sim/neuralSim.ts) is a short bright streak moving from the neuron
 * that fired to the synapse it reaches, at conduction speed. Long-range ones
 * run along the fiber tracts between regions. One LineSegments, CPU-updated.
 */
export function SpikeTrails() {
  const { geometry, material } = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAILS * 6), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAILS * 6), 3));
    const m = new THREE.LineBasicMaterial({
      vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    });
    return { geometry: g, material: m };
  }, []);

  useFrame(({ clock }) => {
    const now = clock.elapsedTime;
    const tr = neuralSim.trail;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const P = pos.array as Float32Array;
    const C = col.array as Float32Array;
    for (let k = 0; k < TRAILS; k++) {
      const t0 = tr.t0[k], t1 = tr.t1[k];
      const o = k * 6;
      if (now < t0 || now > t1 + DRAIN) {
        if (C[o] !== 0 || C[o + 3] !== 0) C.fill(0, o, o + 6);
        continue;
      }
      const span = Math.max(1e-3, t1 - t0);
      const head = Math.min(1, (now - t0) / span);
      const isTract = tr.tract[k] === 1;
      const streak = isTract ? TRACT_STREAK : LOCAL_STREAK;
      const tailP = Math.max(0, head - streak - Math.max(0, now - t1) / DRAIN * streak);
      const fx = tr.from[k * 3], fy = tr.from[k * 3 + 1], fz = tr.from[k * 3 + 2];
      const dx = tr.to[k * 3] - fx, dy = tr.to[k * 3 + 1] - fy, dz = tr.to[k * 3 + 2] - fz;
      P[o] = fx + dx * tailP; P[o + 1] = fy + dy * tailP; P[o + 2] = fz + dz * tailP;
      P[o + 3] = fx + dx * head; P[o + 4] = fy + dy * head; P[o + 5] = fz + dz * head;
      // warm, like the flash of the neuron that sent it (the static structure is
      // blue-white): bright head, dark tail; tract spikes brighter and longer-lived
      const fadeOut = now > t1 ? 1 - (now - t1) / DRAIN : 1;
      const b = (isTract ? 1 : 0.75) * fadeOut;
      C[o] = 0; C[o + 1] = 0; C[o + 2] = 0;
      C[o + 3] = b; C[o + 4] = b * 0.72; C[o + 5] = b * 0.36;
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} renderOrder={2} />;
}

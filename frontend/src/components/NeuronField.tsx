import { useLayoutEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { MAX_NEURONS } from "../types";
import { onActivation, onNeuronUpsert, useBrainStore } from "../store/brainStore";
import { GlowMaterial } from "../shaders/glowMaterial";
import { useLOD } from "../hooks/useLOD";

const tmpObject = new THREE.Object3D();
const tmpColor = new THREE.Color();

export function NeuronField() {
  const baseRef = useRef<THREE.InstancedMesh>(null!);
  const glowRef = useRef<THREE.InstancedMesh>(null!);
  const graphLoaded = useBrainStore((s) => s.graphLoaded);
  const graphVersion = useBrainStore((s) => s.graphVersion);

  // id -> instance index (built once the graph loads)
  const indexOf = useRef(new Map<string, number>());
  const activations = useRef(new Float32Array(MAX_NEURONS));
  const dirty = useRef(new Set<number>());

  const loadedCount = useRef(0);

  const glowMaterial = useMemo(() => {
    const m = new GlowMaterial();
    // additive, transparent halo that never occludes the neurons behind it
    m.transparent = true;
    m.depthWrite = false;
    m.blending = THREE.AdditiveBlending;
    m.toneMapped = false;
    return m;
  }, []);

  const glowGeometry = useMemo(() => {
    const g = new THREE.SphereGeometry(0.085, 8, 8);
    const attr = new THREE.InstancedBufferAttribute(new Float32Array(MAX_NEURONS), 1);
    attr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute("aActivation", attr);
    return g;
  }, []);

  // ---- one-time instance setup ------------------------------------------------
  useLayoutEffect(() => {
    if (!graphLoaded) return;
    const { neurons, neuronOrder } = useBrainStore.getState();
    const base = baseRef.current;
    const glow = glowRef.current;
    indexOf.current.clear();
    activations.current.fill(0);
    neuronOrder.forEach((id, i) => {
      const n = neurons.get(id);
      if (!n || i >= MAX_NEURONS) return;
      indexOf.current.set(id, i);
      tmpObject.position.set(n.position[0], n.position[1], n.position[2]);
      const s = 0.75 + n.size * 0.35;
      tmpObject.scale.setScalar(s);
      tmpObject.updateMatrix();
      base.setMatrixAt(i, tmpObject.matrix);
      glow.setMatrixAt(i, tmpObject.matrix);
      tmpColor.set(n.color);
      base.setColorAt(i, tmpColor);
    });
    loadedCount.current = Math.min(neuronOrder.length, MAX_NEURONS);
    base.instanceMatrix.needsUpdate = true;
    glow.instanceMatrix.needsUpdate = true;
    if (base.instanceColor) base.instanceColor.needsUpdate = true;
  }, [graphLoaded, graphVersion]);

  // ---- neurons added / recycled after load: rewrite just that instance -------
  useLayoutEffect(() => {
    const off = onNeuronUpsert((n) => {
      const base = baseRef.current;
      const glow = glowRef.current;
      if (!base || !glow) return;
      let i = indexOf.current.get(n.id);
      if (i === undefined) {
        if (loadedCount.current >= MAX_NEURONS) return;
        i = loadedCount.current++;
        indexOf.current.set(n.id, i);
      }
      tmpObject.position.set(n.position[0], n.position[1], n.position[2]);
      tmpObject.scale.setScalar(0.75 + n.size * 0.35);
      tmpObject.updateMatrix();
      base.setMatrixAt(i, tmpObject.matrix);
      glow.setMatrixAt(i, tmpObject.matrix);
      base.setColorAt(i, tmpColor.set(n.color));
      base.instanceMatrix.needsUpdate = true;
      glow.instanceMatrix.needsUpdate = true;
      if (base.instanceColor) base.instanceColor.needsUpdate = true;
    });
    return off;
  }, []);

  // ---- live activation path (no react renders) -------------------------------
  useLayoutEffect(() => {
    const off = onActivation((id, amount) => {
      const i = indexOf.current.get(id);
      if (i === undefined) return;
      activations.current[i] = Math.max(activations.current[i], amount);
      dirty.current.add(i);
    });
    return off;
  }, []);

  const applyCount = (n: number) => {
    if (baseRef.current) baseRef.current.count = n;
    if (glowRef.current) glowRef.current.count = n;
  };
  useLOD(applyCount, 0.12, () => loadedCount.current);

  // ---- per-frame: decay + push dirty activations to GPU -----------------------
  useFrame(({ clock }) => {
    glowMaterial.uniforms.uTime.value = clock.elapsedTime;
    const arr = activations.current;
    const attr = glowGeometry.getAttribute("aActivation") as THREE.InstancedBufferAttribute;
    let anyDirty = false;
    // decay everything (19k float mults is cheap)
    for (let i = 0; i < MAX_NEURONS; i++) {
      const a = arr[i];
      if (a > 0.004) {
        arr[i] = a * 0.94;
        dirty.current.add(i);
      } else if (a !== 0) {
        arr[i] = 0;
        dirty.current.add(i);
      }
    }
    dirty.current.forEach((i) => {
      attr.setX(i, arr[i]);
      anyDirty = true;
    });
    dirty.current.clear();
    if (anyDirty) attr.needsUpdate = true;
  });

  if (!graphLoaded) return null;
  return (
    <group>
      <instancedMesh
        ref={baseRef}
        args={[undefined, undefined, MAX_NEURONS]}
        frustumCulled={false}
      >
        <sphereGeometry args={[0.06, 6, 6]} />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
      <instancedMesh
        ref={glowRef}
        args={[glowGeometry, undefined, MAX_NEURONS]}
        frustumCulled={false}
        renderOrder={2}
      >
        <primitive object={glowMaterial} attach="material" />
      </instancedMesh>
    </group>
  );
}

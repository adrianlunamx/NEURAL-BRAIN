import { Component, ReactNode, Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { useBrainSocket } from "../hooks/useBrainSocket";
import { useBrainStore } from "../store/brainStore";
import { NeuronDust } from "./NeuronDust";
import { BrainShell } from "./BrainShell";
import { FloatingLabels } from "./FloatingLabels";
import { Fibers } from "./Fibers";
import { QueryAnimation } from "./QueryAnimation";
import { NotesAnimator, FireflyNotes } from "./FireflyNotes";
import { LinksLayer } from "./LinksLayer";
import { AgentMarkers, markerPositions } from "./AgentMarkers";
import { livePositions, useNotesStore } from "../store/notesStore";
import { ArousalDriver, arousal } from "../store/arousal";
import { BRAIN_CENTER } from "../config/brainConfig";

/** Keeps a failing subtree (e.g. a font that can't load) from unmounting the whole scene. */
class SceneErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn("[brain] 3D overlay disabled:", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// lateral view: frontal lobe to the right (+x), occipital to the left
const HOME_POSITION = new THREE.Vector3(0.4, 3.2, 14.5);
const HOME_TARGET = new THREE.Vector3(...BRAIN_CENTER);

/** Drives camera for AUTO-ZOOM phases and the HOME reset button. */
function CameraRig() {
  // two selectors: an object-returning selector would re-render on every store update
  const camera = useThree((s) => s.camera);
  const controls = useThree((s) => s.controls) as unknown as
    { target: THREE.Vector3; update: () => void } | null;
  const autoZoom = useBrainStore((s) => s.settings.autoZoom);
  const phase = useBrainStore((s) => s.phase);
  const payload = useBrainStore((s) => s.phasePayload);
  const resetToken = useBrainStore((s) => s.resetToken);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    camera.position.copy(HOME_POSITION);
    controls?.target.copy(HOME_TARGET);
    controls?.update();
  }, [resetToken, camera, controls]);

  // + / − / Encuadrar from the graph controls
  const camCmd = useNotesStore((s) => s.camera);
  useEffect(() => {
    if (!camCmd || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    if (camCmd.command === "in") offset.multiplyScalar(0.8);
    if (camCmd.command === "out") offset.multiplyScalar(1.25);
    if (camCmd.command === "fit") {
      const box = new THREE.Box3();
      livePositions.forEach((p) => box.expandByPoint(p));
      const sphere = box.isEmpty() ? new THREE.Sphere(HOME_TARGET.clone(), 6) : box.getBoundingSphere(new THREE.Sphere());
      controls.target.copy(sphere.center);
      offset.normalize().multiplyScalar(Math.max(8, sphere.radius * 2.6));
    }
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }, [camCmd, camera, controls]);

  useFrame((_, delta) => {
    // "Seguir": keep the most recently active agent in the centre
    const follow = useNotesStore.getState().follow;
    if (follow && controls && markerPositions.size) {
      const last = [...markerPositions.values()].pop()!;
      controls.target.lerp(last, Math.min(1, delta * 1.5));
      controls.update();
    }
    if (!autoZoom || !controls) return;
    let goal: THREE.Vector3 | null = null;
    if (phase === "INPUT" || phase === "SEARCH") {
      const p = payload?.position ?? payload?.query_position;
      if (p) goal = new THREE.Vector3(p[0], p[1] + 1.5, p[2] + 9);
    } else if (phase === "SYNTHESIZE") {
      goal = new THREE.Vector3(0, 3.5, 13);
    } else if (phase === "CONNECT") {
      goal = new THREE.Vector3(0, 4.5, 16);
    }
    if (goal) {
      camera.position.lerp(goal, Math.min(1, delta * 1.6));
      controls.target.lerp(HOME_TARGET, Math.min(1, delta * 1.6));
      controls.update();
    }
  });
  return null;
}

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
const skyFragment = /* glsl */ `
  uniform float uWarm;
  varying vec3 vDir;
  void main() {
    float h = vDir.y * 0.5 + 0.5;
    // neon: deep blue-violet night
    vec3 top = vec3(0.004, 0.006, 0.028);
    vec3 mid = vec3(0.016, 0.009, 0.045);
    vec3 low = vec3(0.002, 0.002, 0.012);
    vec3 neon = mix(mix(low, mid, smoothstep(0.0, 0.5, h)), top, smoothstep(0.5, 1.0, h));
    // organic: warm dark room with a soft spotlight from above
    vec3 room = mix(vec3(0.004, 0.003, 0.002), vec3(0.018, 0.012, 0.008), smoothstep(0.1, 0.9, h));
    float spot = pow(max(dot(vDir, normalize(vec3(0.0, 1.0, 0.35))), 0.0), 5.0);
    vec3 organic = room + vec3(0.09, 0.06, 0.035) * spot;
    gl_FragColor = vec4(mix(neon, organic, uWarm), 1.0);
  }
`;

/** Background: blue-violet night (neon) or a warm dark room with a spotlight (organic). */
function Sky() {
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false,
    uniforms: { uWarm: { value: 1 } },
  }), []);
  useFrame(() => { material.uniforms.uWarm.value = arousal.warm; });
  return (
    <mesh material={material} renderOrder={-10} raycast={() => null}>
      <sphereGeometry args={[150, 32, 16]} />
    </mesh>
  );
}

export function BrainCanvas() {
  useBrainSocket();
  const anim = useBrainStore((s) => s.settings.anim);
  const dof = useBrainStore((s) => s.settings.dof);
  const bloom = useBrainStore((s) => s.settings.bloom);
  const style = useBrainStore((s) => s.settings.style);

  return (
    <Canvas
      camera={{ position: HOME_POSITION.toArray(), fov: 50, near: 0.1, far: 200 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      raycaster={{ params: { Points: { threshold: 0.22 } } as unknown as THREE.RaycasterParameters }}
      onPointerMissed={() => useNotesStore.getState().select(null)}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#060817"]} />
      <Sky />
      {style === "neon" && <Stars radius={70} depth={45} count={3500} factor={2.6} saturation={0.5} fade speed={0.4} />}
      <ambientLight intensity={0.7} />
      <Suspense fallback={null}>
        <NeuronDust />
        <Fibers />
        <BrainShell />
        <ArousalDriver />
        <NotesAnimator />
        <LinksLayer />
        <FireflyNotes />
        <AgentMarkers />
      </Suspense>
      {/* text (fonts) loads in its own boundary: it can never blank the neurons */}
      <SceneErrorBoundary>
        <Suspense fallback={null}>
          <FloatingLabels />
          <QueryAnimation />
        </Suspense>
      </SceneErrorBoundary>
      <OrbitControls
        makeDefault
        target={BRAIN_CENTER}
        enableDamping
        dampingFactor={0.08}
        minDistance={4}
        maxDistance={45}
        autoRotate={anim}
        autoRotateSpeed={0.35}
      />
      <CameraRig />
      {bloom && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={1.25}
            luminanceThreshold={style === "organico" ? 0.6 : 0.22}
            luminanceSmoothing={0.2}
            mipmapBlur
          />
          {dof ? (
            <DepthOfField
              focusDistance={0.02}
              focalLength={0.06}
              bokehScale={3.5}
            />
          ) : (
            <></>
          )}
        </EffectComposer>
      )}
    </Canvas>
  );
}

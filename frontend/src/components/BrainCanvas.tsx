import { Component, ReactNode, Suspense, useEffect, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, DepthOfField, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { useBrainSocket } from "../hooks/useBrainSocket";
import { useBrainStore } from "../store/brainStore";
import { NeuronField } from "./NeuronField";
import { RegionShells } from "./RegionShells";
import { Fibers } from "./Fibers";
import { QueryAnimation } from "./QueryAnimation";

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

const HOME_POSITION = new THREE.Vector3(0, 6, 22);
const HOME_TARGET = new THREE.Vector3(0, 0.5, 0);

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

  useFrame((_, delta) => {
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
      controls.target.lerp(new THREE.Vector3(0, 1.5, 0), Math.min(1, delta * 1.6));
      controls.update();
    }
  });
  return null;
}

export function BrainCanvas() {
  useBrainSocket();
  const anim = useBrainStore((s) => s.settings.anim);
  const dof = useBrainStore((s) => s.settings.dof);
  const bloom = useBrainStore((s) => s.settings.bloom);

  return (
    <Canvas
      camera={{ position: HOME_POSITION.toArray(), fov: 50, near: 0.1, far: 200 }}
      gl={{ antialias: true, powerPreference: "high-performance" }}
      dpr={[1, 2]}
    >
      <color attach="background" args={["#05060a"]} />
      <fog attach="fog" args={["#05060a", 32, 75]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[10, 12, 10]} intensity={0.6} />
      <Suspense fallback={null}>
        <NeuronField />
        <Fibers />
      </Suspense>
      {/* text (fonts) loads in its own boundary: it can never blank the neurons */}
      <SceneErrorBoundary>
        <Suspense fallback={null}>
          <RegionShells />
          <QueryAnimation />
        </Suspense>
      </SceneErrorBoundary>
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.08}
        minDistance={6}
        maxDistance={45}
        autoRotate={anim}
        autoRotateSpeed={0.55}
      />
      <CameraRig />
      {bloom && (
        <EffectComposer multisampling={0}>
          <Bloom
            intensity={1.15}
            luminanceThreshold={0.32}
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

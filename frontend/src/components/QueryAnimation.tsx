import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard, Line, Text } from "@react-three/drei";
import { animated, useSpring } from "@react-spring/three";
import * as THREE from "three";
import { QueryHit } from "../types";
import { FONT_URL } from "../config";
import { emitActivation, useBrainStore } from "../store/brainStore";

type V3 = [number, number, number];

const UP = new THREE.Vector3(0, 1, 0);

/** Thin glowing beam between two points. */
function Beam({ from, to, color, radius = 0.03, opacity = 0.9 }: {
  from: V3; to: V3; color: string; radius?: number; opacity?: number;
}) {
  const { position, quaternion, length } = useMemo(() => {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const dir = b.clone().sub(a);
    const length = dir.length();
    return {
      position: a.clone().add(b).multiplyScalar(0.5),
      quaternion: new THREE.Quaternion().setFromUnitVectors(UP, dir.clone().normalize()),
      length,
    };
  }, [from, to]);
  return (
    <mesh position={position} quaternion={quaternion}>
      <cylinderGeometry args={[radius, radius, length, 6, 1, true]} />
      <meshBasicMaterial color={color} transparent opacity={opacity} toneMapped={false} />
    </mesh>
  );
}

/** Small sphere travelling from->to in a loop (the "scan" pulse). */
function ScanPulse({ from, to, color, speed = 0.55, offset = 0 }: {
  from: V3; to: V3; color: string; speed?: number; offset?: number;
}) {
  const ref = useRef<THREE.Mesh>(null!);
  const a = useMemo(() => new THREE.Vector3(...from), [from]);
  const b = useMemo(() => new THREE.Vector3(...to), [to]);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * speed + offset) % 1;
    ref.current.position.lerpVectors(a, b, t);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.14, 12, 12]} />
      <meshBasicMaterial color={color} toneMapped={false} />
    </mesh>
  );
}

// ---------------------------------------------------------------- INPUT
function InputPhase({ position, text }: { position: V3; text: string }) {
  const { scale } = useSpring({
    scale: 1,
    from: { scale: 0 },
    config: { tension: 170, friction: 14 },
  });
  return (
    <group position={position}>
      <animated.mesh scale={scale}>
        <sphereGeometry args={[0.55, 24, 24]} />
        <meshBasicMaterial color="#ff4dff" toneMapped={false} />
      </animated.mesh>
      <pointLight color="#ff4dff" intensity={30} distance={12} />
      <Text font={FONT_URL} position={[0, 1.1, 0]} fontSize={0.4} color="#ff8aff" anchorX="center">
        {text.slice(0, 42)}
      </Text>
    </group>
  );
}

// ---------------------------------------------------------------- SEARCH
function SearchPhase({ origin, targets, status }: {
  origin: V3;
  targets: { id: string; position: V3 }[];
  status: string;
}) {
  return (
    <group>
      {targets.map((t, i) => (
        <group key={t.id}>
          <Beam from={origin} to={t.position} color="#ff4dff" radius={0.035} opacity={0.85} />
          <ScanPulse from={origin} to={t.position} color="#ff9dff" offset={i * 0.23} />
        </group>
      ))}
      <Billboard position={[origin[0], origin[1] + 1.7, origin[2]]}>
        <Text font={FONT_URL} fontSize={0.5} color="#ff8aff" anchorX="center" outlineWidth={0.02} outlineColor="#05060a">
          {status || "escaneando memoria..."}
        </Text>
      </Billboard>
    </group>
  );
}

// ---------------------------------------------------------------- CONNECT
function ConnectPhase({ origin, hits }: { origin: V3; hits: QueryHit[] }) {
  const showLabels = useBrainStore((s) => s.settings.labels);
  // light up every hit once when the phase mounts
  useEffect(() => {
    hits.forEach((h) => emitActivation(h.id, 1));
  }, [hits]);
  return (
    <group>
      {hits.map((h) => (
        <group key={h.id}>
          <Line
            points={[new THREE.Vector3(...origin), new THREE.Vector3(...h.position)]}
            color="#ffffff"
            lineWidth={4}
            transparent
            opacity={0.95}
          />
          {showLabels && (
            <Billboard position={[h.position[0], h.position[1] + 0.75, h.position[2]]}>
              <Text font={FONT_URL}
                fontSize={0.38}
                color="#ffffff"
                anchorX="center"
                outlineWidth={0.025}
                outlineColor="#05060a"
              >
                {`${h.label.slice(0, 26)}  ${(h.score * 100).toFixed(0)}%`}
              </Text>
            </Billboard>
          )}
        </group>
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- SYNTHESIZE
const EXPLOSION_RAYS = 28;

function SynthesizePhase({ center, hits }: { center: V3; hits: QueryHit[] }) {
  const { scale } = useSpring({
    scale: 3.2,
    from: { scale: 0.2 },
    config: { tension: 120, friction: 12 },
  });
  const raysRef = useRef<THREE.Group>(null!);
  const rayDirs = useMemo(() => {
    const dirs: THREE.Vector3[] = [];
    for (let i = 0; i < EXPLOSION_RAYS; i++) {
      const theta = (i / EXPLOSION_RAYS) * Math.PI * 2;
      const phi = Math.acos(2 * ((i * 0.61803398875) % 1) - 1); // golden spiral
      dirs.push(new THREE.Vector3(
        Math.sin(phi) * Math.cos(theta),
        Math.cos(phi),
        Math.sin(phi) * Math.sin(theta),
      ));
    }
    return dirs;
  }, []);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    raysRef.current.children.forEach((child, i) => {
      const s = 1 + 0.35 * Math.sin(t * 5 + i);
      child.scale.set(1, s, 1);
    });
    raysRef.current.rotation.y = t * 0.35;
  });
  useEffect(() => {
    hits.forEach((h) => emitActivation(h.id, 1));
  }, [hits]);

  return (
    <group position={center}>
      <animated.mesh scale={scale}>
        <sphereGeometry args={[0.9, 32, 32]} />
        <meshBasicMaterial color="#ffe14d" toneMapped={false} />
      </animated.mesh>
      <pointLight color="#ffe14d" intensity={60} distance={20} />
      <group ref={raysRef}>
        {rayDirs.map((d, i) => {
          const len = 4.5;
          const mid: V3 = [d.x * len * 0.5, d.y * len * 0.5, d.z * len * 0.5];
          const quat = new THREE.Quaternion().setFromUnitVectors(UP, d);
          return (
            <mesh key={i} position={mid} quaternion={quat}>
              <cylinderGeometry args={[0.05, 0.01, len, 6, 1, true]} />
              <meshBasicMaterial color="#fff3b0" transparent opacity={0.8} toneMapped={false} />
            </mesh>
          );
        })}
      </group>
      {hits.map((h) => (
        <Beam
          key={`conv-${h.id}`}
          from={[0, 0, 0]}
          to={[h.position[0] - center[0], h.position[1] - center[1], h.position[2] - center[2]]}
          color="#ffffff"
          radius={0.05}
          opacity={0.9}
        />
      ))}
    </group>
  );
}

// ---------------------------------------------------------------- root
export function QueryAnimation() {
  const phase = useBrainStore((s) => s.phase);
  const payload = useBrainStore((s) => s.phasePayload);

  if (!payload || phase === "IDLE") return null;

  if (phase === "INPUT" && payload.position) {
    return <InputPhase position={payload.position} text={payload.text ?? ""} />;
  }
  if (phase === "SEARCH" && payload.query_position) {
    return (
      <SearchPhase
        origin={payload.query_position}
        targets={payload.targets ?? []}
        status={payload.status ?? "escaneando memoria..."}
      />
    );
  }
  if (phase === "CONNECT" && payload.query_position) {
    return <ConnectPhase origin={payload.query_position} hits={payload.hits ?? []} />;
  }
  if (phase === "SYNTHESIZE" && payload.center) {
    return <SynthesizePhase center={payload.center} hits={payload.hits ?? []} />;
  }
  return null;
}

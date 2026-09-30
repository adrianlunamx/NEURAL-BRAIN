import { Text } from "@react-three/drei";
import { FONT_URL } from "../config";
import { REGION_COLORS, Region } from "../types";

interface Shell {
  region: Region;
  label: string;
  center: [number, number, number];
  radii: [number, number, number];
  labelAt: [number, number, number];
}

const SHELLS: Shell[] = [
  { region: "frontal", label: "FRONTAL", center: [4.0, 1.0, 0], radii: [2.6, 2.4, 2.2], labelAt: [4.0, 4.1, 0] },
  { region: "parietal", label: "PARIETAL", center: [0.2, 2.4, 0], radii: [2.2, 1.8, 2.0], labelAt: [0.2, 4.9, 0] },
  { region: "temporal", label: "TEMPORAL", center: [0.8, -1.4, 1.9], radii: [1.6, 1.2, 1.0], labelAt: [0.8, -3.1, 2.6] },
  { region: "temporal", label: "", center: [0.8, -1.4, -1.9], radii: [1.6, 1.2, 1.0], labelAt: [0, 0, 0] },
  { region: "occipital", label: "OCCIPITAL", center: [-4.2, 0.8, 0], radii: [1.8, 2.0, 1.8], labelAt: [-4.2, 3.4, 0] },
  { region: "hippocampus", label: "HIPOCAMPO", center: [-0.5, -0.6, 0.7], radii: [1.1, 0.6, 0.5], labelAt: [-0.5, -1.7, 1.4] },
  { region: "hippocampus", label: "", center: [-0.5, -0.6, -0.7], radii: [1.1, 0.6, 0.5], labelAt: [0, 0, 0] },
  { region: "cerebellum", label: "CEREBELO", center: [-3.4, -3.2, 0], radii: [1.9, 1.4, 1.6], labelAt: [-3.4, -5.2, 0] },
];

export function RegionShells() {
  return (
    <group>
      {SHELLS.map((s, i) => (
        <group key={i}>
          <mesh position={s.center} scale={s.radii} renderOrder={1}>
            <sphereGeometry args={[1, 24, 18]} />
            <meshBasicMaterial
              color={REGION_COLORS[s.region]}
              transparent
              opacity={0.05}
              depthWrite={false}
              side={2 /* THREE.BackSide as number */}
            />
          </mesh>
          <mesh position={s.center} scale={s.radii}>
            <sphereGeometry args={[1, 24, 18]} />
            <meshBasicMaterial
              color={REGION_COLORS[s.region]}
              transparent
              opacity={0.10}
              wireframe
              depthWrite={false}
            />
          </mesh>
          {s.label && (
            <Text font={FONT_URL}
              position={s.labelAt}
              fontSize={0.42}
              color={REGION_COLORS[s.region]}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="#05060a"
            >
              {s.label}
            </Text>
          )}
        </group>
      ))}
    </group>
  );
}

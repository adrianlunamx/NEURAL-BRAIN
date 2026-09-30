import { Billboard, Line, Text } from "@react-three/drei";
import { FONT_URL } from "../config";
import { REGION_LABELS } from "../config/brainConfig";
import { REGION_COLORS } from "../types";
import { useBrainStore } from "../store/brainStore";

/** Region names floating around the anatomical brain. Hidden when LABELS is off. */
export function RegionLabels() {
  const show = useBrainStore((s) => s.settings.labels);
  if (!show) return null;
  return (
    <group>
      {REGION_LABELS.map((l) => (
        <group key={l.region}>
          {l.anchor && (
            <Line
              points={[[l.position[0], l.position[1] + 0.3, l.position[2]], l.anchor]}
              color={REGION_COLORS[l.region]}
              lineWidth={1.2}
              dashed
              dashSize={0.18}
              gapSize={0.12}
              transparent
              opacity={0.7}
            />
          )}
          <Billboard position={l.position}>
            <Text
              font={FONT_URL}
              fontSize={0.42}
              color={REGION_COLORS[l.region]}
              anchorX="center"
              anchorY="middle"
              outlineWidth={0.02}
              outlineColor="#05060a"
            >
              {l.text}
            </Text>
          </Billboard>
        </group>
      ))}
    </group>
  );
}

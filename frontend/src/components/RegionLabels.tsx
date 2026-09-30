import { Billboard, Text } from "@react-three/drei";
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
        <Billboard key={l.region} position={l.position}>
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
      ))}
    </group>
  );
}

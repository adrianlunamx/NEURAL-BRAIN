import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, Line, Text } from "@react-three/drei";
import * as THREE from "three";
import { FONT_URL } from "../config";
import { REGION_LABELS } from "../config/brainConfig";
import { REGION_COLORS } from "../types";
import { useBrainStore } from "../store/brainStore";
import { resolveLabelCollisions, ScreenLabelInput, V3 } from "./labelLayout2D";

const REGION_FONT = 0.42;
const HIT_FONT = 0.38;
const RELAYOUT_MS = 250;

interface LabelSpec extends ScreenLabelInput {
  kind: "region" | "hit";
  color: string;
  /** Region labels only: point of the region the guide line goes to. */
  anchor?: V3;
}

/**
 * Single renderer for every floating label: the six region names and the
 * CONNECT "%" labels. Both sets are de-collided together in screen space
 * (labelLayout2D), so a "%" never covers another one or a region name.
 * Re-laid out when the labels change and every 250 ms while the camera moves.
 */
export function FloatingLabels() {
  const show = useBrainStore((s) => s.settings.labels);
  const phase = useBrainStore((s) => s.phase);
  const payload = useBrainStore((s) => s.phasePayload);
  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);

  const specs = useMemo<LabelSpec[]>(() => {
    const regions: LabelSpec[] = REGION_LABELS.map((l) => ({
      id: `region:${l.region}`,
      kind: "region",
      world: l.position,
      text: l.text,
      fontSize: REGION_FONT,
      priority: 2,
      color: REGION_COLORS[l.region],
      anchor: l.anchor,
    }));
    const hits: LabelSpec[] =
      phase === "CONNECT"
        ? (payload?.hits ?? []).map((h) => ({
            id: `hit:${h.id}`,
            kind: "hit",
            world: [h.position[0], h.position[1] + 0.6, h.position[2]],
            text: `${h.label.slice(0, 26)}  ${(h.score * 100).toFixed(0)}%`,
            fontSize: HIT_FONT,
            priority: h.score ?? 0,
            color: "#ffffff",
          }))
        : [];
    return [...regions, ...hits];
  }, [phase, payload]);

  const [placed, setPlaced] = useState<Map<string, V3>>(new Map());
  const lastCamera = useRef(new THREE.Matrix4());
  const lastLayout = useRef(0);

  const relayout = useCallback(() => {
    const out = resolveLabelCollisions(specs, camera, { width: size.width, height: size.height });
    setPlaced(new Map(out.map((o) => [o.id, o.world])));
    lastCamera.current.copy(camera.matrixWorld);
    lastLayout.current = performance.now();
  }, [specs, camera, size.width, size.height]);

  // new labels (phase / hits) or a resized viewport: lay out right away
  useEffect(() => {
    if (show) relayout();
  }, [show, relayout]);

  // camera moving (auto-rotate, auto-zoom, user orbit): throttled re-layout
  useFrame(() => {
    if (!show) return;
    if (performance.now() - lastLayout.current < RELAYOUT_MS) return;
    if (camera.matrixWorld.equals(lastCamera.current)) return;
    relayout();
  });

  if (!show) return null;
  return (
    <group>
      {specs.map((l) => {
        const pos = placed.get(l.id) ?? l.world;
        return (
          <group key={l.id}>
            {l.anchor && (
              <Line
                points={[pos, l.anchor]}
                color={l.color}
                lineWidth={1.2}
                dashed
                dashSize={0.18}
                gapSize={0.12}
                transparent
                opacity={0.7}
              />
            )}
            <Billboard position={pos}>
              <Text
                font={FONT_URL}
                renderOrder={l.kind === "hit" ? 10 : 0}
                material-depthTest={l.kind !== "hit"}
                fontSize={l.fontSize}
                color={l.color}
                anchorX="center"
                anchorY="middle"
                outlineWidth={l.kind === "hit" ? 0.025 : 0.02}
                outlineColor="#05060a"
              >
                {l.text}
              </Text>
            </Billboard>
          </group>
        );
      })}
    </group>
  );
}

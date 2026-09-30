import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { LOD_THRESHOLDS } from "../config";

/** Pure function: camera distance -> target instance count. */
export function getLODCount(distance: number): number {
  for (const t of LOD_THRESHOLDS) {
    if (distance <= t.maxDistance) return t.count;
  }
  return 1000;
}

/**
 * Smoothly drives `mesh.count` toward the LOD target every frame.
 * Because the backend render order is stratified by region, the first N
 * instances always form a representative whole brain.
 */
export function useLOD(
  setCount: (n: number) => void,
  smoothing = 0.12,
  maxCount: () => number = () => 19000,
) {
  const camera = useThree((s) => s.camera);
  const current = useRef(19000);
  useFrame(() => {
    const dist = camera.position.length();
    // never draw instances that were not initialised (they would pile up at the origin)
    const target = Math.min(getLODCount(dist), maxCount());
    current.current += (target - current.current) * smoothing;
    setCount(Math.round(current.current));
  });
}

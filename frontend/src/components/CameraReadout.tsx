// Live camera readout of the viewport ("AZ 132° EL 18° DIST 14.2"), written
// straight into a DOM node a few times per second: no React re-render.
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import { BRAIN_CENTER } from "../config/brainConfig";

let target: HTMLElement | null = null;

/** Ref callback for the overlay element that shows the readout. */
export function setCameraReadoutEl(el: HTMLElement | null) {
  target = el;
}

const CENTER = new THREE.Vector3(...BRAIN_CENTER);
const EVERY_MS = 120;
const fmt = (n: number, w: number, d = 0) => n.toFixed(d).padStart(w, " ");

/** Mount once inside the Canvas. */
export function CameraProbe() {
  const camera = useThree((s) => s.camera);
  const last = useRef(0);
  const off = useRef(new THREE.Vector3());

  useFrame(() => {
    const now = performance.now();
    if (!target || now - last.current < EVERY_MS) return;
    last.current = now;
    const o = off.current.copy(camera.position).sub(CENTER);
    const dist = o.length();
    const az = ((THREE.MathUtils.radToDeg(Math.atan2(o.x, o.z)) % 360) + 360) % 360;
    const el = THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(o.y / Math.max(dist, 1e-6), -1, 1)));
    target.innerHTML =
      `AZ <b>${fmt(az, 3)}°</b> · EL <b>${fmt(el, 3)}°</b> · DIST <b>${fmt(dist, 4, 1)}</b>`;
  });
  return null;
}

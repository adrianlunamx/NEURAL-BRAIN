import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { API_URL } from "../config";
import { arousal } from "../store/arousal";
import { neuralSim } from "../sim/neuralSim";

interface FiberDTO {
  source: string;
  target: string;
  start: [number, number, number];
  end: [number, number, number];
  weight: number;
}

const fiberVertex = /* glsl */ `
attribute float aDist;
varying float vDist;
void main() {
  vDist = aDist;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fiberFragment = /* glsl */ `
uniform float uTime;
uniform float uArousal;
uniform vec3 uColor;
varying float vDist;
void main() {
  // the tract itself is only a faint bundle of white matter; the spikes that
  // actually travel along it are drawn by SpikeTrails
  float ends = smoothstep(0.0, 0.08, vDist) * smoothstep(1.0, 0.92, vDist);
  float alpha = 0.07 * ends * mix(0.35, 1.0, uArousal);
  gl_FragColor = vec4(uColor, alpha);
}
`;

export function Fibers() {
  const matRef = useRef<THREE.ShaderMaterial>(null!);
  const geom = useMemo(() => new THREE.BufferGeometry(), []);

  useEffect(() => {
    let alive = true;
    (async () => {
      // GET /fibers returns every fiber with both endpoints. (Reading them from
      // /graph?detail=low loses almost all: both ends must be in the 1k sample.)
      let fibers: FiberDTO[] = [];
      try {
        const res = await fetch(`${API_URL}/fibers`);
        fibers = await res.json() as FiberDTO[];
      } catch (err) {
        console.error("[brain] failed to load fibers", err);
        return;
      }
      if (!alive) return;
      // each fiber is a reciprocal tract of the spiking network
      neuralSim.setTracts(fibers.map((f) => ({ start: f.start, end: f.end })));
      const positions = new Float32Array(fibers.length * 6);
      const dists = new Float32Array(fibers.length * 2);
      fibers.forEach((f, i) => {
        positions.set([...f.start, ...f.end], i * 6);
        dists.set([0, 1], i * 2);
      });
      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("aDist", new THREE.BufferAttribute(dists, 1));
      geom.computeBoundingSphere();
    })();
    return () => { alive = false; };
  }, [geom]);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: fiberVertex,
        fragmentShader: fiberFragment,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color("#cfe6ff") },
          uArousal: { value: 0 },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    [],
  );

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uArousal.value = arousal.level;
  });

  return (
    <lineSegments geometry={geom} material={material} frustumCulled={false} />
  );
}

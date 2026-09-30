import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BRAIN_SHELL_URL, SHELL_STYLE } from "../config/brainConfig";
import { lit } from "../store/arousal";

interface ShellJSON {
  vertices: number[];
  normals: number[];
  indices: number[];
}

const vertexShader = /* glsl */ `
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uRimColor;
uniform float uOpacity;
uniform float uRimOpacity;
uniform float uRimPower;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vViewDir;
void main() {
  float facing = abs(dot(normalize(vNormal), normalize(vViewDir)));
  float rim = pow(1.0 - facing, uRimPower);
  float breathe = 0.9 + 0.1 * sin(uTime * 0.8);
  vec3 color = mix(uColor, uRimColor, rim);
  gl_FragColor = vec4(color, (uOpacity + uRimOpacity * rim) * breathe);
}
`;

/**
 * Translucent brain surface (fresnel rim) from the precomputed marching-cubes mesh
 * in /brain_shell.json. If the file is missing the app keeps working without it.
 */
export function BrainShell() {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);

  useEffect(() => {
    let alive = true;
    let built: THREE.BufferGeometry | null = null;
    (async () => {
      try {
        const res = await fetch(BRAIN_SHELL_URL);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ShellJSON;
        if (!alive) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.Float32BufferAttribute(data.vertices, 3));
        g.setAttribute("normal", new THREE.Float32BufferAttribute(data.normals, 3));
        g.setIndex(data.indices);
        g.computeBoundingSphere();
        built = g;
        setGeometry(g);
      } catch (err) {
        console.warn(`[brain] shell not loaded (${BRAIN_SHELL_URL}); run brain_layout.py --shell`, err);
      }
    })();
    return () => {
      alive = false;
      built?.dispose();
    };
  }, []);

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uColor: { value: new THREE.Color(SHELL_STYLE.color) },
          uRimColor: { value: new THREE.Color(SHELL_STYLE.rimColor) },
          uOpacity: { value: SHELL_STYLE.opacity },
          uRimOpacity: { value: SHELL_STYLE.rimOpacity },
          uRimPower: { value: SHELL_STYLE.rimPower },
          uTime: { value: 0 },
        },
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    [],
  );
  useEffect(() => () => material.dispose(), [material]);

  // the cortex surface drawn as a fine dotted skin (the shell vertices as points)
  const dots = useMemo(() => new THREE.PointsMaterial({
    color: "#8fa8ff", size: 0.02, sizeAttenuation: true, transparent: true, opacity: 0.2,
    depthWrite: false, blending: THREE.AdditiveBlending,
  }), []);
  useEffect(() => () => dots.dispose(), [dots]);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    // the cortex is a faint outline at rest and glows while the brain thinks
    material.uniforms.uOpacity.value = SHELL_STYLE.opacity * lit(0.4);
    material.uniforms.uRimOpacity.value = SHELL_STYLE.rimOpacity * lit(0.45);
    dots.opacity = 0.2 * lit(0.3);
  });

  if (!geometry) return null;
  return (
    <group>
      <mesh geometry={geometry} material={material} renderOrder={1} raycast={() => null} />
      <points geometry={geometry} material={dots} raycast={() => null} />
    </group>
  );
}

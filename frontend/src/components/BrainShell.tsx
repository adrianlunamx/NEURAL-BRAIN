import { useEffect, useMemo, useState } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { BRAIN_SHELL_URL, SHELL_STYLE } from "../config/brainConfig";
import { arousal, lit } from "../store/arousal";
import { useBrainStore } from "../store/brainStore";

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

// ---------------------------------------------------------------- organic style
// A pearly, softly lit cortex: key light from above, the sulci shaded darker
// and glowing warm from inside when the brain thinks. GYRI mirrors
// gyri_field() in backend/brain_layout.py (keep in sync).
const organicVertex = /* glsl */ `
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vObjPos;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vObjPos = position;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const organicFragment = /* glsl */ `
uniform vec3 uBase;
uniform vec3 uWarm;
uniform float uArousal;
uniform float uTime;
varying vec3 vWorldNormal;
varying vec3 vWorldPos;
varying vec3 vObjPos;

// sin(phase) of the fold pattern: 0 on a sulcus, +-1 on a gyrus crown
float foldS(vec3 q) {
  vec3 p = q * 3.4;  // FOLD_SCALE
  float phase = 2.4 * (0.55 * p.x + 0.83 * p.y)
              + 2.6 * sin(0.65 * p.y + 0.35 * p.z)
              + 2.2 * sin(0.55 * p.z + 0.85 * p.x)
              + 1.4 * sin(1.15 * p.x - 0.55 * p.y + 0.4 * p.z)
              + 0.5 * sin(1.9 * p.y + 1.3 * p.z);
  return sin(phase);
}

float gyri(vec3 q) {           // groove mask (same as gyri_field)
  float s = foldS(q) / 0.35;   // SULCUS_WIDTH
  return exp(-s * s);
}

float crown(vec3 q) {          // rounded gyrus height: 0 in the sulcus, 1 on the crown
  return abs(foldS(q));
}

void main() {
  vec3 n = normalize(vWorldNormal);
  if (!gl_FrontFacing) n = -n;
  // rounded gyri: bend the normal with the slope of the crown height (bump map)
  float e = 0.02;
  float groove = gyri(vObjPos);
  float h = crown(vObjPos);
  vec3 grad = vec3(
    crown(vObjPos + vec3(e, 0.0, 0.0)) - crown(vObjPos - vec3(e, 0.0, 0.0)),
    crown(vObjPos + vec3(0.0, e, 0.0)) - crown(vObjPos - vec3(0.0, e, 0.0)),
    crown(vObjPos + vec3(0.0, 0.0, e)) - crown(vObjPos - vec3(0.0, 0.0, e))) / (2.0 * e);
  grad -= dot(grad, n) * n;
  float gl = length(grad);
  if (gl > 14.0) grad *= 14.0 / gl;
  n = normalize(n - 0.11 * grad);
  vec3 v = normalize(cameraPosition - vWorldPos);
  vec3 l = normalize(vec3(0.25, 1.0, 0.45));           // key light from above
  float ndl = max(dot(n, l), 0.0);
  float ndv = max(dot(n, v), 0.0);
  float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
  float rim = pow(1.0 - ndv, 2.2);

  float light = 0.16 + 0.84 * pow(ndl, 1.2);
  vec3 col = uBase * light * 0.85;
  col *= mix(0.3, 1.0, smoothstep(0.0, 0.8, h)) * mix(1.0, 0.55, groove);  // sulci in shadow, crowns lit
  col += vec3(1.0, 0.93, 0.85) * spec * 0.45;          // pearly highlight
  col += vec3(0.9, 0.82, 0.72) * rim * 0.35;
  // warm light from inside: stronger in the sulci and while thinking
  float inner = (0.18 + 0.4 * uArousal) * (0.5 * groove + 0.3 * rim + 0.1);
  col += uWarm * inner * (0.9 + 0.1 * sin(uTime * 1.3));

  float alpha = clamp(0.38 + 0.35 * rim + 0.12 * groove, 0.0, 0.92) * (0.72 + 0.28 * uArousal);
  gl_FragColor = vec4(col * (0.78 + 0.22 * uArousal), alpha);
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

  const style = useBrainStore((s) => s.settings.style);
  const organic = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: organicVertex,
    fragmentShader: organicFragment,
    uniforms: {
      uBase: { value: new THREE.Color("#d8c3ad") },
      uWarm: { value: new THREE.Color("#ff9a3c") },
      uArousal: { value: 0 },
      uTime: { value: 0 },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.FrontSide,
  }), []);
  useEffect(() => () => organic.dispose(), [organic]);

  useFrame(({ clock }) => {
    organic.uniforms.uTime.value = clock.elapsedTime;
    organic.uniforms.uArousal.value = arousal.level;
    material.uniforms.uTime.value = clock.elapsedTime;
    // the cortex is a faint outline at rest and glows while the brain thinks
    material.uniforms.uOpacity.value = SHELL_STYLE.opacity * lit(0.4);
    material.uniforms.uRimOpacity.value = SHELL_STYLE.rimOpacity * lit(0.45);
    dots.opacity = 0.07 * lit(0.3);  // the v3 shell has ~2x the vertices
  });

  if (!geometry) return null;
  if (style === "organico") {
    // drawn first: the glowing neurons inside show through the translucent cortex
    return <mesh geometry={geometry} material={organic} renderOrder={-1} raycast={() => null} />;
  }
  return (
    <group>
      <mesh geometry={geometry} material={material} renderOrder={1} raycast={() => null} />
      <points geometry={geometry} material={dots} raycast={() => null} />
    </group>
  );
}

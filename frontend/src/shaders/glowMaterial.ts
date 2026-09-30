import * as THREE from "three";
import { shaderMaterial } from "@react-three/drei";

export const GlowMaterial = shaderMaterial(
  {
    uTime: 0,
    uColor: new THREE.Color("#ffffff"),
    uIntensity: 1.6,
  },
  /* glsl vertex */
  `
  attribute float aActivation;
  varying float vActivation;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    vActivation = aActivation;
    vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
    // fresnel in view space (approx: ignore non-uniform scale of instances)
    vNormal = normalize(normalMatrix * normal);
    vViewDir = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
  `,
  /* glsl fragment */
  `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;
  varying float vActivation;
  varying vec3 vNormal;
  varying vec3 vViewDir;

  void main() {
    float a = clamp(vActivation, 0.0, 1.0);
    if (a < 0.003) discard;
    float fresnel = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewDir))), 2.0);
    float pulse = 0.65 + 0.35 * sin(uTime * 7.0);
    float alpha = a * (0.30 + 0.70 * fresnel) * pulse * uIntensity;
    gl_FragColor = vec4(uColor, alpha);
  }
  `,
);

export type GlowMaterialType = {
  uTime: number;
  uColor: THREE.Color;
  uIntensity: number;
} & THREE.ShaderMaterial;

import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { now } from '../utils/animations'
import { COLORS } from '../utils/colors'

/**
 * Holographic silhouette of the brain (cortex, cerebellum, brainstem) from
 * the point cloud the backend samples on the same surface the neurons use.
 * A slow scan band sweeps front to back; it brightens while thinking.
 */
export default function BrainShell({ points, thinking }) {
  const { gl } = useThree()
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(points.flat(), 3))
    const seeds = new Float32Array(points.length).map(() => Math.random())
    g.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1))
    g.computeBoundingSphere()
    return g
  }, [points])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(COLORS.shell) },
          uTime: { value: 0 },
          uBoost: { value: 0 },
          uRadius: { value: 1 },
          uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          uniform float uTime;
          uniform float uRadius;
          uniform float uPixelRatio;
          varying float vAlpha;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            float band = exp(-pow((position.x / uRadius) - sin(uTime * 0.35) * 1.1, 2.0) * 18.0);
            float twinkle = 0.55 + 0.45 * sin(uTime * 1.7 + aSeed * 40.0);
            vAlpha = 0.38 * twinkle + band * 0.6;
            gl_PointSize = (1.7 + band * 1.8) * uPixelRatio * (80.0 / max(1.0, -mv.z));
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor;
          uniform float uBoost;
          varying float vAlpha;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float a = smoothstep(0.5, 0.1, d) * vAlpha * (1.0 + uBoost);
            if (a < 0.01) discard;
            gl_FragColor = vec4(uColor * (1.1 + uBoost), a);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [gl],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    const u = material.uniforms
    u.uTime.value = now()
    u.uRadius.value = geometry.boundingSphere?.radius || 1
    u.uBoost.value = THREE.MathUtils.damp(u.uBoost.value, thinking ? 0.8 : 0, 3, delta)
  })

  return <points geometry={geometry} material={material} raycast={() => null} />
}

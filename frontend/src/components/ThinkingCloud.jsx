import { useEffect, useMemo } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { clamp01, now } from '../utils/animations'

const COUNT = 220

/**
 * Glowing blue/cyan "smoke" wrapped around the active cluster.
 * Large, very soft additive sprites scattered around each active neuron that
 * swirl slowly; fades in with SEARCH, peaks at SYNTHESIZE, fades once answered.
 */
export default function ThinkingCloud({ points, phase, phaseAt }) {
  const { gl } = useThree()

  const { geometry, center } = useMemo(() => {
    const c = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(Math.max(points.length, 1))
    const spread = Math.max(2.5, ...points.map((p) => p.distanceTo(c)) ) * 0.35
    const pos = new Float32Array(COUNT * 3)
    const seed = new Float32Array(COUNT)
    const color = new Float32Array(COUNT * 3)
    const cyan = new THREE.Color('#00f5ff')
    const blue = new THREE.Color('#2f6bff')
    for (let i = 0; i < COUNT; i++) {
      const anchor = i % 4 === 0 || !points.length ? c : points[i % points.length]
      const g = () => (Math.random() + Math.random() + Math.random() - 1.5) * spread
      pos.set([anchor.x - c.x + g(), anchor.y - c.y + g(), anchor.z - c.z + g() * 0.6], i * 3)
      seed[i] = Math.random()
      const mix = cyan.clone().lerp(blue, Math.random())
      color.set([mix.r, mix.g, mix.b], i * 3)
    }
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1))
    geo.setAttribute('aColor', new THREE.BufferAttribute(color, 3))
    return { geometry: geo, center: c }
  }, [points])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uAlpha: { value: 0 },
          uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
        },
        vertexShader: /* glsl */ `
          attribute float aSeed;
          attribute vec3 aColor;
          uniform float uTime;
          uniform float uPixelRatio;
          varying vec3 vColor;
          varying float vSeed;
          void main() {
            // slow swirl around the cluster centre
            float a = uTime * (0.15 + aSeed * 0.2);
            mat2 rot = mat2(cos(a), -sin(a), sin(a), cos(a));
            vec3 p = vec3(rot * position.xy, position.z + sin(uTime + aSeed * 6.28) * 0.4);
            vec4 mv = modelViewMatrix * vec4(p, 1.0);
            gl_PointSize = (90.0 + aSeed * 140.0) * uPixelRatio / max(1.0, -mv.z) * 6.0;
            gl_Position = projectionMatrix * mv;
            vColor = aColor;
            vSeed = aSeed;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uAlpha;
          uniform float uTime;
          varying vec3 vColor;
          varying float vSeed;
          void main() {
            float d = length(gl_PointCoord - 0.5);
            float soft = smoothstep(0.5, 0.0, d);
            float breathe = 0.75 + 0.25 * sin(uTime * 1.3 + vSeed * 20.0);
            float a = soft * soft * uAlpha * breathe * 0.085;
            if (a < 0.002) discard;
            gl_FragColor = vec4(vColor, a);
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

  useFrame(() => {
    const t = now()
    const u = material.uniforms
    u.uTime.value = t
    const s = phaseAt.search ? clamp01((t - phaseAt.search) / 0.6) : 0
    const peak = phaseAt.synthesize ? clamp01((t - phaseAt.synthesize) / 0.4) : 0
    const fade = phase === 'answered' && phaseAt.answered ? Math.exp(-(t - phaseAt.answered) * 1.2) : 1
    u.uAlpha.value = (0.6 * s + 0.6 * peak) * fade
  })

  return <points position={center} geometry={geometry} material={material} frustumCulled={false} raycast={() => null} />
}

import { useEffect, useMemo, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { clamp01, easeInOutCubic, now } from '../utils/animations'
import { particleBus } from '../utils/particleBus'

// Soft round additive sprites with per-particle size, colour and alpha.
const pointsVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uTime;
  uniform float uDrift;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec3 p = position;
    // optional slow drift (ambient dust); 0 for the thinking particles
    p += uDrift * vec3(
      sin(uTime * 0.21 + position.y * 0.15),
      cos(uTime * 0.17 + position.x * 0.13),
      sin(uTime * 0.19 + position.z * 0.11)
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_PointSize = aSize * uPixelRatio * (260.0 / max(0.1, -mv.z));
    gl_Position = projectionMatrix * mv;
    vAlpha = aAlpha;
    vColor = aColor;
  }
`
const pointsFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    float core = smoothstep(0.5, 0.0, d);
    float alpha = core * core * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * (1.2 + core), alpha);
  }
`

function usePointsMaterial(drift = 0) {
  const { gl } = useThree()
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader: pointsVertex,
        fragmentShader: pointsFragment,
        uniforms: {
          uPixelRatio: { value: Math.min(gl.getPixelRatio(), 2) },
          uTime: { value: 0 },
          uDrift: { value: drift },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [gl, drift],
  )
  useEffect(() => () => material.dispose(), [material])
  return material
}

/** Neural dust floating around the brain (idle ambience). */
export function AmbientParticles({ count = 1400, radius = 40 }) {
  const material = usePointsMaterial(1.6)
  const geometry = useMemo(() => {
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const alpha = new Float32Array(count)
    const palette = ['#00f5ff', '#4169e1', '#ff00ff', '#8aa4ff'].map((c) => new THREE.Color(c))
    for (let i = 0; i < count; i++) {
      const r = radius * Math.cbrt(Math.random()) * 1.8
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      pos.set([r * Math.sin(phi) * Math.cos(theta), r * Math.cos(phi) * 0.7, r * Math.sin(phi) * Math.sin(theta)], i * 3)
      const c = palette[(Math.random() * palette.length) | 0]
      col.set([c.r, c.g, c.b], i * 3)
      size[i] = 0.15 + Math.random() * 0.35
      alpha[i] = 0.15 + Math.random() * 0.35
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    g.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1))
    return g
  }, [count, radius])
  useEffect(() => () => geometry.dispose(), [geometry])

  useFrame(() => {
    material.uniforms.uTime.value = now()
  })
  return <points geometry={geometry} material={material} frustumCulled={false} />
}

const KIND_BURST = 1
const KIND_TRAVEL = 2

/**
 * GPU-friendly particle pool fed by `particleBus`:
 * - burst:  radial explosion (query birth, answer emergence)
 * - travel: a stream of particles following a curve (search rays, electric trails, convergence)
 */
export function ThinkingParticles({ capacity = 4000 }) {
  const material = usePointsMaterial(0)
  const cursor = useRef(0)

  const sim = useMemo(
    () => ({
      kind: new Uint8Array(capacity),
      start: new Float32Array(capacity),
      life: new Float32Array(capacity),
      origin: new Float32Array(capacity * 3),
      vel: new Float32Array(capacity * 3),
      jitter: new Float32Array(capacity * 3),
      baseSize: new Float32Array(capacity),
      curves: new Array(capacity).fill(null),
    }),
    [capacity],
  )

  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(capacity * 3), 3).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aSize', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage))
    g.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage))
    return g
  }, [capacity])
  useEffect(() => () => geometry.dispose(), [geometry])

  const tmp = useMemo(() => new THREE.Vector3(), [])
  const color = useMemo(() => new THREE.Color(), [])

  const spawn = (cmd) => {
    const colors = geometry.attributes.aColor.array
    color.set(cmd.color || '#ffffff')
    const count = cmd.count ?? 60
    for (let n = 0; n < count; n++) {
      const i = cursor.current
      cursor.current = (cursor.current + 1) % capacity
      colors.set([color.r, color.g, color.b], i * 3)
      sim.curves[i] = null
      if (cmd.kind === 'burst') {
        sim.kind[i] = KIND_BURST
        sim.start[i] = cmd.at + Math.random() * 0.05
        sim.life[i] = (cmd.life ?? 1) * (0.6 + Math.random() * 0.4)
        sim.origin.set(cmd.origin, i * 3)
        // random direction on a sphere, random speed
        const u = Math.random() * 2 - 1
        const th = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        const speed = (cmd.speed ?? 6) * (0.35 + Math.random() * 0.65)
        sim.vel.set([s * Math.cos(th) * speed, u * speed, s * Math.sin(th) * speed], i * 3)
        sim.baseSize[i] = (cmd.size ?? 1.1) * (0.5 + Math.random())
      } else {
        sim.kind[i] = KIND_TRAVEL
        const duration = cmd.duration ?? 0.4
        // stagger along the stream so it reads as a trail, not a blob
        sim.start[i] = cmd.at + (n / count) * duration * 0.8
        sim.life[i] = duration * (0.85 + Math.random() * 0.3)
        sim.curves[i] = cmd.curve
        const spread = cmd.spread ?? 0.2
        sim.jitter.set([(Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread], i * 3)
        sim.baseSize[i] = (cmd.size ?? 1) * (0.6 + Math.random() * 0.8)
      }
    }
  }

  useFrame(() => {
    const t = now()
    for (const cmd of particleBus.drain()) spawn(cmd)

    const pos = geometry.attributes.position.array
    const size = geometry.attributes.aSize.array
    const alpha = geometry.attributes.aAlpha.array

    for (let i = 0; i < capacity; i++) {
      const kind = sim.kind[i]
      if (!kind) continue
      const age = t - sim.start[i]
      if (age < 0) {
        alpha[i] = 0
        continue
      }
      const life = sim.life[i]
      if (age > life) {
        sim.kind[i] = 0
        sim.curves[i] = null
        alpha[i] = 0
        size[i] = 0
        continue
      }
      const x = age / life
      const j = i * 3
      if (kind === KIND_BURST) {
        const travel = age * (1 - 0.5 * x) // decelerate
        pos[j] = sim.origin[j] + sim.vel[j] * travel
        pos[j + 1] = sim.origin[j + 1] + sim.vel[j + 1] * travel
        pos[j + 2] = sim.origin[j + 2] + sim.vel[j + 2] * travel
        alpha[i] = Math.pow(1 - x, 1.5)
        size[i] = sim.baseSize[i] * (1 - 0.6 * x)
      } else {
        const curve = sim.curves[i]
        curve.getPoint(easeInOutCubic(clamp01(x)), tmp)
        const wobble = Math.sin(x * Math.PI)
        pos[j] = tmp.x + sim.jitter[j] * wobble
        pos[j + 1] = tmp.y + sim.jitter[j + 1] * wobble
        pos[j + 2] = tmp.z + sim.jitter[j + 2] * wobble
        alpha[i] = Math.sqrt(wobble) * 0.95
        size[i] = sim.baseSize[i] * (0.7 + 0.5 * wobble)
      }
    }
    geometry.attributes.position.needsUpdate = true
    geometry.attributes.aSize.needsUpdate = true
    geometry.attributes.aAlpha.needsUpdate = true
    geometry.attributes.aColor.needsUpdate = true
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}

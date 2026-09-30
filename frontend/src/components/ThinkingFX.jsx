import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createGlowMaterial } from './Neuron'
import { clamp01, easeOutCubic, now, popScale } from '../utils/animations'
import { COLORS } from '../utils/colors'

const SPHERE = new THREE.SphereGeometry(1, 32, 32)

/** Magenta query neuron: bursts in with an elastic 0 → 1.5 → 1.0 pop and a decaying glare. */
export function QueryNeuron({ query, phase }) {
  const group = useRef()
  const core = useRef()
  const glow = useMemo(() => createGlowMaterial(COLORS.query, { power: 1.6, intensity: 2 }), [])
  useEffect(() => () => glow.dispose(), [glow])

  useFrame(() => {
    const t = now()
    const age = t - query.at
    const quiet = phase === 'answered' ? 0.55 : 1
    group.current.scale.setScalar(popScale(age, 0.3) * (1 + 0.06 * Math.sin(t * 5)) * 0.9)
    const glare = 1 + 5 * Math.exp(-age * 3.5)
    core.current.material.emissiveIntensity = 2.2 * glare * quiet
    glow.uniforms.uIntensity.value = (0.8 + 1.4 * Math.exp(-age * 2.5)) * quiet
    glow.uniforms.uTime.value = t
  })

  return (
    <group ref={group} position={query.pos}>
      <mesh ref={core} geometry={SPHERE}>
        <meshStandardMaterial color={COLORS.query} emissive={COLORS.query} toneMapped={false} />
      </mesh>
      <mesh geometry={SPHERE} material={glow} scale={2.1} raycast={() => null} />
    </group>
  )
}

/** Concentric shock waves + a horizontal scan plane sweeping the brain during the search phase. */
export function ScanWaves({ origin, startAt, radius }) {
  const shells = useRef([])
  const ring = useRef()
  const mats = useMemo(
    () => [0, 1, 2].map(() => createGlowMaterial(COLORS.query, { power: 3.2, intensity: 0, rim: true })),
    [],
  )
  const ringMat = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color: COLORS.concept,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [],
  )
  const ringGeo = useMemo(() => new THREE.RingGeometry(0.96, 1, 128), [])
  useEffect(
    () => () => {
      mats.forEach((m) => m.dispose())
      ringMat.dispose()
      ringGeo.dispose()
    },
    [mats, ringMat, ringGeo],
  )

  useFrame(() => {
    const t = now()
    mats.forEach((m, i) => {
      const age = t - startAt - i * 0.16
      const x = clamp01(age / 1.1)
      const mesh = shells.current[i]
      if (!mesh) return
      mesh.visible = age > 0 && x < 1
      mesh.scale.setScalar(0.5 + easeOutCubic(x) * radius * 1.35)
      m.uniforms.uIntensity.value = (1 - x) * 0.9
      m.uniforms.uTime.value = t
    })
    // scan plane: from the query's height down through the whole graph
    const x = clamp01((t - startAt) / 0.9)
    const r = ring.current
    r.visible = x > 0 && x < 1
    r.position.y = THREE.MathUtils.lerp(origin.y, -radius, easeOutCubic(x))
    const span = Math.sqrt(Math.max(0, radius * radius - r.position.y * r.position.y)) + 2
    r.scale.setScalar(span)
    ringMat.opacity = Math.sin(x * Math.PI) * 0.8
  })

  return (
    <group>
      {mats.map((m, i) => (
        <mesh
          key={i}
          ref={(el) => (shells.current[i] = el)}
          position={origin}
          geometry={SPHERE}
          material={m}
          visible={false}
          raycast={() => null}
        />
      ))}
      <mesh ref={ring} rotation-x={-Math.PI / 2} geometry={ringGeo} material={ringMat} visible={false} raycast={() => null} />
    </group>
  )
}

/** Growing beam between two points (query → hits, sources → answer). */
export function GrowLine({ from, to, color, startAt, duration = 0.35, opacity = 0.7, fadeAfter = null }) {
  const geometry = useMemo(() => {
    const g = new THREE.BufferGeometry().setFromPoints([from, to])
    return g
  }, [from, to])
  const material = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [color],
  )
  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame(() => {
    const t = now()
    const x = clamp01((t - startAt) / duration)
    const pos = geometry.attributes.position
    const p = new THREE.Vector3().lerpVectors(from, to, easeOutCubic(x))
    pos.setXYZ(1, p.x, p.y, p.z)
    pos.needsUpdate = true
    const fade = fadeAfter != null && t > fadeAfter ? Math.exp(-(t - fadeAfter) * 1.2) : 1
    material.opacity = x > 0 ? opacity * fade * (0.8 + 0.2 * Math.sin(t * 12)) : 0
  })

  return <primitive object={line} />
}

/** Yellow answer neuron emerging at the centre of the active sub-graph. */
export function AnswerNeuron({ answer }) {
  const group = useRef()
  const core = useRef()
  const halo = useRef()
  const glow = useMemo(() => createGlowMaterial(COLORS.answer, { power: 1.8, intensity: 1.5 }), [])
  useEffect(() => () => glow.dispose(), [glow])

  useFrame(() => {
    const t = now()
    const age = t - answer.at
    group.current.visible = age > 0
    if (age <= 0) return
    group.current.scale.setScalar(popScale(age, 0.45) * 1.25)
    core.current.material.emissiveIntensity = 2.5 + 4 * Math.exp(-age * 2.5) + 0.4 * Math.sin(t * 4)
    glow.uniforms.uIntensity.value = 1 + 1.5 * Math.exp(-age * 2)
    glow.uniforms.uTime.value = t
    halo.current.rotation.x = t * 0.9
    halo.current.rotation.y = t * 0.6
  })

  return (
    <group ref={group} position={answer.pos} visible={false}>
      <mesh ref={core} geometry={SPHERE}>
        <meshStandardMaterial color="#fff9c4" emissive={COLORS.answer} toneMapped={false} />
      </mesh>
      <mesh geometry={SPHERE} material={glow} scale={2.3} raycast={() => null} />
      <mesh ref={halo} raycast={() => null}>
        <torusGeometry args={[2.1, 0.035, 8, 96]} />
        <meshBasicMaterial color={COLORS.concept} toneMapped={false} transparent opacity={0.8} />
      </mesh>
    </group>
  )
}

/** Everything that exists only while (or right after) the brain is thinking. */
export default function ThinkingFX({ scene, nodeMap, radius }) {
  const { query, answer, phase, phaseAt, activeNodes } = scene
  const hits = useMemo(
    () => Object.entries(activeNodes).filter(([id, a]) => a.role === 'hit' && nodeMap.has(id)),
    [activeNodes, nodeMap],
  )
  const involved = useMemo(
    () => (answer?.sources || []).map((id) => nodeMap.get(id)?.vec).filter(Boolean),
    [answer, nodeMap],
  )
  if (!query) return null

  return (
    <group>
      <QueryNeuron query={query} phase={phase} />
      {phaseAt.search && <ScanWaves origin={query.pos} startAt={phaseAt.search} radius={radius} />}
      {hits.map(([id, a]) => (
        <GrowLine
          key={`q-${id}`}
          from={query.pos}
          to={nodeMap.get(id).vec}
          color={COLORS.query}
          startAt={a.at - 0.3}
          duration={0.3}
          opacity={0.55}
          fadeAfter={phaseAt.synthesize ?? null}
        />
      ))}
      {answer &&
        involved.map((vec, i) => (
          <GrowLine
            key={`a-${i}`}
            from={vec}
            to={answer.pos}
            color={COLORS.concept}
            startAt={phaseAt.synthesize + i * 0.025}
            duration={0.4}
            opacity={0.65}
          />
        ))}
      {answer && <AnswerNeuron answer={answer} />}
    </group>
  )
}

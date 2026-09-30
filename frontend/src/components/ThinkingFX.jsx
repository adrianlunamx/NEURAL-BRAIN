import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { createGlowMaterial } from './Neuron'
import { tubeAlong } from './Connection'
import ThinkingCloud from './ThinkingCloud'
import { clamp01, easeOutCubic, edgeCurve, now, popScale } from '../utils/animations'
import { COLORS } from '../utils/colors'

const SPHERE = new THREE.SphereGeometry(1, 32, 32)
const QUERY_SIZE = 0.8

/** Magenta query neuron (r = 0.8): pops in 0 → 1.5 → 1.0 with a decaying glare. */
export function QueryNeuron({ query, phase }) {
  const group = useRef()
  const core = useRef()
  const glow = useMemo(() => createGlowMaterial(COLORS.query, { power: 1.6, intensity: 2 }), [])
  useEffect(() => () => glow.dispose(), [glow])

  useFrame(() => {
    const t = now()
    const age = t - query.at
    const quiet = phase === 'answered' ? 0.55 : 1
    group.current.scale.setScalar(popScale(age, 0.3) * (1 + 0.04 * Math.sin(t * 5)) * QUERY_SIZE)
    core.current.material.emissiveIntensity = 1.6 * (1 + 4 * Math.exp(-age * 3.5)) * quiet
    glow.uniforms.uIntensity.value = (0.8 + 1.4 * Math.exp(-age * 2.5)) * quiet
    glow.uniforms.uTime.value = t
  })

  return (
    <group ref={group} position={query.pos}>
      <mesh ref={core} geometry={SPHERE}>
        <meshStandardMaterial color={COLORS.query} emissive={COLORS.query} toneMapped={false} />
      </mesh>
      <mesh geometry={SPHERE} material={glow} scale={1.8} raycast={() => null} />
    </group>
  )
}

/** Thick beam that grows from `from` to `to` (tube revealed segment by segment). */
export function GrowTube({ from, to, color, radius = 0.05, startAt, duration = 0.35, opacity = 0.9, fadeAfter = null }) {
  const geometry = useMemo(() => tubeAlong(edgeCurve(from, to, 0), radius, 24), [from, to, radius])
  const material = useMemo(
    () =>
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [color],
  )
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])
  const total = geometry.index.count

  useFrame(() => {
    const t = now()
    const x = easeOutCubic(clamp01((t - startAt) / duration))
    // TubeGeometry indices are ordered along the tube: reveal them progressively
    geometry.setDrawRange(0, Math.floor((x * total) / 6) * 6)
    const fade = fadeAfter != null && t > fadeAfter ? Math.exp(-(t - fadeAfter) * 1.5) : 1
    material.opacity = x > 0 ? opacity * fade * (0.85 + 0.15 * Math.sin(t * 14)) : 0
  })

  return <mesh geometry={geometry} material={material} raycast={() => null} />
}

/** Fallback when the search found nothing: a yellow neuron emerges at the centre. */
export function AnswerNeuron({ answer }) {
  const group = useRef()
  const glow = useMemo(() => createGlowMaterial(COLORS.answer, { power: 1.8, intensity: 1.5 }), [])
  useEffect(() => () => glow.dispose(), [glow])
  useFrame(() => {
    const age = now() - answer.at
    group.current.visible = age > 0
    if (age > 0) group.current.scale.setScalar(popScale(age, 0.45) * 0.8)
  })
  return (
    <group ref={group} position={answer.pos} visible={false}>
      <mesh geometry={SPHERE}>
        <meshStandardMaterial color={COLORS.answer} emissive={COLORS.answer} emissiveIntensity={2.5} toneMapped={false} />
      </mesh>
      <mesh geometry={SPHERE} material={glow} scale={1.8} raycast={() => null} />
    </group>
  )
}

/** Everything that exists only while (or right after) the brain is thinking. */
export default function ThinkingFX({ scene, nodeMap }) {
  const { query, answer, phase, phaseAt, activeNodes } = scene
  const hits = useMemo(
    () => Object.entries(activeNodes).filter(([id, a]) => a.role === 'hit' && nodeMap.has(id)),
    [activeNodes, nodeMap],
  )
  const clusterPoints = useMemo(
    () => Object.keys(activeNodes).map((id) => nodeMap.get(id)?.vec).filter(Boolean),
    [activeNodes, nodeMap],
  )
  const converging = useMemo(
    () => (answer?.sources || []).map((id) => nodeMap.get(id)?.vec).filter(Boolean),
    [answer, nodeMap],
  )
  if (!query) return null

  return (
    <group>
      <QueryNeuron query={query} phase={phase} />
      {/* SEARCH: thick white beams from the query to each hit, fading once the answer forms */}
      {hits.map(([id, a]) => (
        <GrowTube
          key={`q-${id}`}
          from={query.pos}
          to={nodeMap.get(id).vec}
          color={COLORS.edgeActive}
          radius={0.05}
          startAt={a.at - 0.3}
          duration={0.3}
          opacity={0.75}
          fadeAfter={phaseAt.synthesize ?? null}
        />
      ))}
      {clusterPoints.length > 0 && <ThinkingCloud points={clusterPoints} phase={phase} phaseAt={phaseAt} />}
      {/* SYNTHESIZE: every active neuron converges on the yellow synthesis neuron */}
      {answer &&
        converging.map((vec, i) => (
          <GrowTube
            key={`a-${i}`}
            from={vec}
            to={answer.pos}
            color={COLORS.answer}
            radius={0.035}
            startAt={phaseAt.synthesize + i * 0.03}
            duration={0.4}
            opacity={0.6}
          />
        ))}
      {answer && !answer.id && <AnswerNeuron answer={answer} />}
    </group>
  )
}

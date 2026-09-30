import { memo, useEffect, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import pulseSource from '../shaders/connectionPulse.glsl?raw'
import { splitShader } from '../utils/shader'
import { easeOutCubic, edgeCurve, hash01, now } from '../utils/animations'
import { COLORS } from '../utils/colors'

const PULSE = splitShader(pulseSource)
const SEGMENTS = 28
const ACTIVE_RADIUS = 0.08

function pulseMaterial(id, color) {
  return new THREE.ShaderMaterial({
    ...PULSE,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uActiveColor: { value: new THREE.Color(COLORS.edgeActive) },
      uOpacity: { value: 0.15 },
      uActive: { value: 0 },
      uTime: { value: 0 },
      uSeed: { value: hash01(id) },
      uSpeed: { value: 1.4 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

/** Tube along a curve with an `aT` attribute (0 → 1 along its length) for the pulse shader. */
export function tubeAlong(curve, radius, segments = SEGMENTS) {
  const g = new THREE.TubeGeometry(curve, segments, radius, 8, false)
  const uv = g.attributes.uv
  const t = new Float32Array(uv.count)
  for (let i = 0; i < uv.count; i++) t[i] = uv.getX(i)
  g.setAttribute('aT', new THREE.BufferAttribute(t, 1))
  return g
}

/**
 * Synapse between two neurons.
 * - idle: very thin #4169e1 line at 0.15 opacity with a faint shimmer; synapses
 *   longer than the "near" threshold stay hidden until they carry a thought
 * - thinking: inactive synapses fade to 0.05
 * - active: a thick white tube (r = 0.08) with an electric current running through it
 */
function Connection({ id, from, to, weight = 0.5, range = 'local', bow = 0, near = true, activation, thinking }) {
  const curve = useMemo(() => edgeCurve(from, to, bow), [from, to, bow])

  const lineGeo = useMemo(() => {
    const pts = curve.getPoints(bow ? SEGMENTS : 1)
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    g.setAttribute('aT', new THREE.Float32BufferAttribute(pts.map((_, i) => i / (pts.length - 1)), 1))
    return g
  }, [curve, bow])
  const lineMat = useMemo(() => pulseMaterial(id, range === 'long' ? COLORS.edgeLong : COLORS.edge), [id, range])
  const line = useMemo(() => new THREE.Line(lineGeo, lineMat), [lineGeo, lineMat])

  const tubeGeo = useMemo(() => (activation ? tubeAlong(curve, ACTIVE_RADIUS) : null), [activation, curve])
  const tubeMat = useMemo(() => (activation ? pulseMaterial(`${id}-tube`, COLORS.edgeActive) : null), [activation, id])

  useEffect(() => () => lineGeo.dispose(), [lineGeo])
  useEffect(() => () => lineMat.dispose(), [lineMat])
  useEffect(() => () => tubeGeo?.dispose(), [tubeGeo])
  useEffect(() => () => tubeMat?.dispose(), [tubeMat])

  useFrame(() => {
    const t = now()
    const a = activation && t >= activation.at ? easeOutCubic((t - activation.at) / 0.3) : 0
    const u = lineMat.uniforms
    u.uTime.value = t
    const idle = near ? 0.12 + 0.06 * weight : 0
    u.uOpacity.value = thinking ? (activation ? 0 : 0.05) : idle
    u.uActive.value = 0
    if (tubeMat) {
      const v = tubeMat.uniforms
      v.uTime.value = t
      v.uActive.value = a
      v.uOpacity.value = a * 0.55
    }
  })

  return (
    <group>
      <primitive object={line} />
      {tubeGeo && <mesh geometry={tubeGeo} material={tubeMat} raycast={() => null} />}
    </group>
  )
}

export default memo(Connection)

import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { QuadraticBezierLine } from '@react-three/drei'
import * as THREE from 'three'
import pulseSource from '../shaders/connectionPulse.glsl?raw'
import { splitShader } from '../utils/shader'
import { EDGE_BOW, easeOutCubic, edgeCurve, hash01, now } from '../utils/animations'
import { COLORS } from '../utils/colors'

const PULSE = splitShader(pulseSource)
const SEGMENTS = 28

/**
 * Synapse between two neurons.
 * - idle: dim blue curve (#4169e1, ~0.3 opacity) with a shimmer running along it;
 *   long-range fibres (between lobes / hemispheres) arc higher and turn violet
 * - active: turns white, an electric current travels through it, plus a dashed
 *   "fat" overlay whose dashes flow from source to target.
 */
function Connection({ id, from, to, weight = 0.5, range = 'local', activation, dimmed }) {
  const overlay = useRef()
  const curve = useMemo(() => edgeCurve(from, to, EDGE_BOW[range] ?? EDGE_BOW.local), [from, to, range])

  const geometry = useMemo(() => {
    const pts = curve.getPoints(SEGMENTS)
    const g = new THREE.BufferGeometry().setFromPoints(pts)
    g.setAttribute('aT', new THREE.Float32BufferAttribute(pts.map((_, i) => i / SEGMENTS), 1))
    return g
  }, [curve])

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        ...PULSE,
        uniforms: {
          uColor: { value: new THREE.Color(range === 'long' ? COLORS.edgeLong : COLORS.edge) },
          uActiveColor: { value: new THREE.Color(COLORS.edgeActive) },
          uOpacity: { value: 0.3 },
          uActive: { value: 0 },
          uTime: { value: 0 },
          uSeed: { value: hash01(id) },
          uSpeed: { value: 1.4 },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      }),
    [id, range],
  )

  const line = useMemo(() => new THREE.Line(geometry, material), [geometry, material])
  useEffect(() => () => geometry.dispose(), [geometry])
  useEffect(() => () => material.dispose(), [material])

  useFrame((_, delta) => {
    const t = now()
    const a = activation && t >= activation.at ? easeOutCubic((t - activation.at) / 0.3) : 0
    const u = material.uniforms
    u.uTime.value = t
    u.uActive.value = a
    u.uOpacity.value = (0.22 + 0.16 * weight) * (dimmed && !activation ? 0.35 : 1)

    if (overlay.current) {
      const mat = overlay.current.material
      mat.opacity = a * 0.9
      mat.dashOffset -= delta * 2.4
    }
  })

  return (
    <group>
      <primitive object={line} />
      {activation && (
        <QuadraticBezierLine
          ref={overlay}
          start={curve.v0}
          mid={curve.v1}
          end={curve.v2}
          color={COLORS.edgeActive}
          lineWidth={2.2}
          dashed
          dashScale={2}
          dashSize={0.6}
          gapSize={0.35}
          transparent
          opacity={0}
          toneMapped={false}
          depthWrite={false}
        />
      )}
    </group>
  )
}

export default memo(Connection)

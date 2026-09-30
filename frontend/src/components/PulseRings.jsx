import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard } from '@react-three/drei'
import * as THREE from 'three'
import { now } from '../utils/animations'

const RING = new THREE.RingGeometry(0.92, 1, 64)
const PERIOD = 1.6
const RINGS = 3

/**
 * Concentric ripples expanding from an active neuron (sonar-like).
 * Always faces the camera; rings are staggered so one is always travelling.
 */
function PulseRings({ position, size = 0.5, color = '#00f5ff', startAt = 0, calm = false }) {
  const refs = useRef([])
  const materials = useMemo(
    () =>
      Array.from({ length: RINGS }, () =>
        new THREE.MeshBasicMaterial({
          color,
          transparent: true,
          opacity: 0,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      ),
    [color],
  )
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials])

  useFrame(() => {
    const t = now() - startAt
    materials.forEach((m, i) => {
      const mesh = refs.current[i]
      if (!mesh) return
      if (t < 0) {
        m.opacity = 0
        return
      }
      // ring i lags i/RINGS of a period behind the previous one
      const x = (((t / PERIOD - i / RINGS) % 1) + 1) % 1
      mesh.scale.setScalar(size * (1.6 + x * 3.4))
      m.opacity = (1 - x) ** 1.6 * (calm ? 0.22 : 0.6)
    })
  })

  return (
    <Billboard position={position}>
      {materials.map((m, i) => (
        <mesh key={i} ref={(el) => (refs.current[i] = el)} geometry={RING} material={m} raycast={() => null} />
      ))}
    </Billboard>
  )
}

export default memo(PulseRings)

import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import { QuadraticBezierLine } from '@react-three/drei'
import * as THREE from 'three'
import { createGlowMaterial } from './Neuron'
import { COLORS } from '../utils/colors'

/**
 * Mounts one invisible-in-practice instance of every material the thinking
 * animation uses and compiles them up front. Without this the GPU compiles
 * those programs on first use, which shows up as a hitch right when the
 * CONNECT phase starts.
 */
export default function ShaderWarmup() {
  const { gl, scene, camera } = useThree()
  const [done, setDone] = useState(false)
  const rim = useMemo(() => createGlowMaterial(COLORS.query, { rim: true, intensity: 0 }), [])

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      gl.compile(scene, camera)
      frame = requestAnimationFrame(() => setDone(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [gl, scene, camera])
  useEffect(() => () => rim.dispose(), [rim])

  if (done) return null
  return (
    <group position={[0, -9999, 0]}>
      <QuadraticBezierLine start={[0, 0, 0]} end={[1, 0, 0]} dashed lineWidth={2} transparent opacity={0} toneMapped={false} />
      <mesh material={rim}>
        <sphereGeometry args={[0.01, 8, 8]} />
      </mesh>
      <mesh>
        <ringGeometry args={[0.9, 1, 8]} />
        <meshBasicMaterial transparent opacity={0} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
      <line>
        <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints([new THREE.Vector3(), new THREE.Vector3(1, 0, 0)])} />
        <lineBasicMaterial transparent opacity={0} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </line>
    </group>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { useThree } from '@react-three/fiber'
import * as THREE from 'three'
import { createGlowMaterial } from './Neuron'
import { tubeAlong } from './Connection'
import ThinkingCloud from './ThinkingCloud'
import pulseSource from '../shaders/connectionPulse.glsl?raw'
import { splitShader } from '../utils/shader'
import { edgeCurve } from '../utils/animations'
import { COLORS } from '../utils/colors'

const PULSE = splitShader(pulseSource)
const WARM_PHASE_AT = {}

/**
 * Mounts one practically-invisible instance of every material the thinking
 * animation uses and compiles them up front. Without this the GPU compiles
 * those programs on first use, which shows up as a hitch when SEARCH / CONNECT start.
 */
export default function ShaderWarmup() {
  const { gl, scene, camera } = useThree()
  const [done, setDone] = useState(false)
  const assets = useMemo(() => {
    const tube = tubeAlong(edgeCurve([0, 0, 0], [1, 0, 0], 0), 0.05, 2)
    const pulse = new THREE.ShaderMaterial({
      ...PULSE,
      uniforms: {
        uColor: { value: new THREE.Color(COLORS.edge) },
        uActiveColor: { value: new THREE.Color('#ffffff') },
        uOpacity: { value: 0 },
        uActive: { value: 0 },
        uTime: { value: 0 },
        uSeed: { value: 0 },
        uSpeed: { value: 1 },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    })
    const basic = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const glow = createGlowMaterial(COLORS.query, { intensity: 0 })
    return { tube, pulse, basic, glow, cloud: [new THREE.Vector3(0, -9999, 0)] }
  }, [])

  useEffect(() => {
    let frame = requestAnimationFrame(() => {
      gl.compile(scene, camera)
      frame = requestAnimationFrame(() => setDone(true))
    })
    return () => cancelAnimationFrame(frame)
  }, [gl, scene, camera])
  useEffect(
    () => () => {
      assets.tube.dispose()
      assets.pulse.dispose()
      assets.basic.dispose()
      assets.glow.dispose()
    },
    [assets],
  )

  if (done) return null
  return (
    <group position={[0, -9999, 0]}>
      <mesh geometry={assets.tube} material={assets.pulse} />
      <mesh geometry={assets.tube} material={assets.basic} />
      <mesh material={assets.glow}>
        <sphereGeometry args={[0.01, 8, 8]} />
      </mesh>
      <ThinkingCloud points={assets.cloud} phase="idle" phaseAt={WARM_PHASE_AT} />
    </group>
  )
}

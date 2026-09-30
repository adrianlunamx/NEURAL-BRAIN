import { memo, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import glowSource from '../shaders/neuronGlow.glsl?raw'
import { splitShader } from '../utils/shader'
import { bump, easeOutCubic, hash01, idlePulse, now, popScale } from '../utils/animations'
import { colorForType } from '../utils/colors'

const GLOW = splitShader(glowSource)
const WHITE = new THREE.Color('#ffffff')
const SPHERE = new THREE.SphereGeometry(1, 32, 32)

export function createGlowMaterial(color, { power = 2.4, intensity = 0.4, rim = false } = {}) {
  return new THREE.ShaderMaterial({
    ...GLOW,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: intensity },
      uPower: { value: power },
      uTime: { value: 0 },
      uRim: { value: rim ? 1 : 0 },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  })
}

/**
 * A single neuron: emissive core + fresnel halo.
 * All animation is computed per frame from timestamps in `activation`, so
 * React only re-renders when the thinking phase changes.
 */
function Neuron({ data, activation, phase, phaseAt, hovered, selected, dimmed, onHover, onSelect }) {
  const group = useRef()
  const core = useRef()
  const scaleRef = useRef(1)
  const seed = useMemo(() => hash01(data.id) * Math.PI * 2, [data.id])
  const baseColor = useMemo(() => new THREE.Color(colorForType(data.type)), [data.type])
  const glowMat = useMemo(() => createGlowMaterial(baseColor), [baseColor])
  const bornAt = useRef(now())
  const tmpColor = useMemo(() => new THREE.Color(), [])

  useFrame((_, delta) => {
    const t = now()
    // activation: 0 → 1 when the search wave / cascade reaches this neuron
    let a = 0
    let flash = 0
    let cascade = 0
    let sync = 0
    if (activation && t >= activation.at) {
      a = easeOutCubic((t - activation.at) / 0.35)
      flash = bump(t, activation.at + 0.08, 0.1)
      for (const c of activation.cascade || []) cascade += bump(t, c, 0.09)
      const synthAt = phaseAt?.synthesize
      if (synthAt && t >= synthAt && (phase === 'synthesize' || phase === 'answered')) {
        // all active neurons beat in unison, fading into a calm glow once answered
        const fade = phase === 'answered' ? Math.exp(-(t - (phaseAt.answered ?? t)) * 1.5) : 1
        sync = (0.5 + 0.5 * Math.sin((t - synthAt) * Math.PI * 6)) * fade
      }
    }
    if (activation?.role === 'bridge') a *= 0.75

    const dim = dimmed && !activation ? 0.3 : 1
    const birth = popScale(t - bornAt.current, 0.45)
    const target =
      idlePulse(t, seed) *
      (1 + 0.35 * a + 0.35 * flash + 0.3 * cascade + 0.18 * sync) *
      (hovered || selected ? 1.2 : 1) *
      birth
    scaleRef.current = THREE.MathUtils.damp(scaleRef.current, target, 14, delta)
    group.current.scale.setScalar(scaleRef.current * data.size)

    const hover = hovered || selected ? 1 : 0
    const m = core.current.material
    tmpColor.copy(baseColor).lerp(WHITE, Math.min(0.45, 0.15 * a + 0.4 * flash + 0.25 * cascade))
    m.color.copy(tmpColor)
    m.emissive.copy(tmpColor)
    m.emissiveIntensity = (0.8 + 1.1 * a + 2.2 * flash + 1.4 * cascade + 0.9 * sync + 0.6 * hover) * dim
    m.opacity = 0.35 + 0.65 * dim

    const u = glowMat.uniforms
    u.uTime.value = t
    u.uColor.value.copy(tmpColor)
    u.uIntensity.value = (0.5 + 0.7 * a + 1.2 * flash + 0.7 * cascade + 0.5 * sync + 0.5 * hover) * dim
  })

  return (
    <group ref={group} position={data.vec}>
      <mesh
        ref={core}
        geometry={SPHERE}
        onPointerOver={(e) => {
          e.stopPropagation()
          onHover?.(data.id)
        }}
        onPointerOut={(e) => {
          e.stopPropagation()
          onHover?.(null)
        }}
        onClick={(e) => {
          e.stopPropagation()
          onSelect?.(data.id)
        }}
      >
        <meshStandardMaterial
          color={baseColor}
          emissive={baseColor}
          emissiveIntensity={0.9}
          metalness={0.35}
          roughness={0.25}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={SPHERE} material={glowMat} scale={1.9} raycast={() => null} />
    </group>
  )
}

export default memo(Neuron)

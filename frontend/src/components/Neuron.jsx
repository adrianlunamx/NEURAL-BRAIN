import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import glowSource from '../shaders/neuronGlow.glsl?raw'
import { splitShader } from '../utils/shader'
import { activeScale, bump, easeOutCubic, hash01, idlePulse, now, popScale } from '../utils/animations'
import { COLORS, colorForType, TYPE_LABELS } from '../utils/colors'

const GLOW = splitShader(glowSource)
const WHITE = new THREE.Color('#ffffff')
const YELLOW = new THREE.Color(COLORS.answer)
const SPHERE = new THREE.SphereGeometry(1, 32, 32)
const MAX_SPARKS = 12

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

/** 12 short radial "sparks" (neuron-local units, soma radius = 1). Idle shows 5-8 of them. */
function buildSparks(id) {
  let seed = Math.floor(hash01(id) * 1e6) + 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const pts = []
  for (let i = 0; i < MAX_SPARKS; i++) {
    // golden-angle spiral with jitter: evenly spread, different per neuron
    const y = 1 - (2 * (i + 0.5)) / MAX_SPARKS
    const r = Math.sqrt(1 - y * y)
    const theta = i * 2.39996 + rand() * 0.8
    const d = new THREE.Vector3(Math.cos(theta) * r, y, Math.sin(theta) * r).normalize()
    const len = 0.6 + rand() * 0.9
    pts.push(d.x * 1.05, d.y * 1.05, d.z * 1.05, d.x * (1.05 + len), d.y * (1.05 + len), d.z * (1.05 + len))
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return { geometry: g, idleCount: 5 + Math.floor(rand() * 4) }
}

/**
 * A neuron: emissive soma + soft glow + sparks.
 * Idle: breathes 1.0 ↔ 1.03 in its type colour. Search hit: turns white and grows ×1.2-1.5
 * with a label and relevance %. Synthesis neuron: yellow, ×2. Inactive while thinking: 30 %.
 * All animation runs in useFrame from timestamps, so React only re-renders on phase changes.
 */
function Neuron({ data, activation, phase, phaseAt, isSynthesis, hovered, selected, dimmed, onHover, onSelect }) {
  const group = useRef()
  const core = useRef()
  const sparksRef = useRef()
  const scaleRef = useRef(1)
  const seed = useMemo(() => hash01(data.id) * Math.PI * 2, [data.id])
  const baseColor = useMemo(() => new THREE.Color(data.color || colorForType(data.type)), [data.color, data.type])
  const glowMat = useMemo(() => createGlowMaterial(baseColor), [baseColor])
  const sparks = useMemo(() => buildSparks(data.id), [data.id])
  const sparkMat = useMemo(
    () =>
      new THREE.LineBasicMaterial({
        color: baseColor,
        transparent: true,
        opacity: 0.3,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    [baseColor],
  )
  const bornAt = useRef(now())
  const tmpColor = useMemo(() => new THREE.Color(), [])
  const dimRef = useRef(1)

  useEffect(() => () => glowMat.dispose(), [glowMat])
  useEffect(() => () => sparkMat.dispose(), [sparkMat])
  useEffect(() => () => sparks.geometry.dispose(), [sparks])

  useFrame((_, delta) => {
    const t = now()
    let a = 0
    let flash = 0
    let cascade = 0
    let synth = 0
    if (activation && t >= activation.at) {
      a = easeOutCubic((t - activation.at) / 0.35)
      flash = bump(t, activation.at + 0.08, 0.1)
      for (const c of activation.cascade || []) cascade += bump(t, c, 0.09)
    }
    const synthAt = phaseAt?.synthesize
    if (isSynthesis && synthAt && t >= synthAt) synth = easeOutCubic((t - synthAt) / 0.45)

    dimRef.current = THREE.MathUtils.damp(dimRef.current, dimmed && !activation ? 0.3 : 1, 6, delta)
    const dim = dimRef.current
    const grow = THREE.MathUtils.lerp(1, activeScale(activation), a)
    const target =
      idlePulse(t, seed) *
      THREE.MathUtils.lerp(grow, 2.0, synth) *
      (1 + 0.25 * flash + 0.2 * cascade) *
      (hovered || selected ? 1.2 : 1) *
      popScale(t - bornAt.current, 0.45)
    scaleRef.current = THREE.MathUtils.damp(scaleRef.current, target, 14, delta)
    group.current.scale.setScalar(scaleRef.current * data.size)

    // colour: type colour → bright white when active → yellow for the synthesis neuron
    tmpColor.copy(baseColor).lerp(WHITE, Math.min(1, 0.85 * a + 0.5 * flash)).lerp(YELLOW, synth)
    const hover = hovered || selected ? 1 : 0
    const m = core.current.material
    m.color.copy(tmpColor)
    m.emissive.copy(tmpColor)
    m.emissiveIntensity = 0.4 + 1.1 * a + 1.5 * flash + cascade + 1.2 * synth + 0.5 * hover
    m.opacity = dim

    const u = glowMat.uniforms
    u.uTime.value = t
    u.uColor.value.copy(tmpColor)
    u.uIntensity.value = (0.45 + 0.6 * a + flash + 0.6 * cascade + 0.9 * synth + 0.4 * hover) * dim

    // sparks: 5-8 faint ones at idle; all 12, longer and flickering when active
    const sp = sparksRef.current
    const lit = Math.max(a, synth)
    sp.geometry.setDrawRange(0, (lit > 0.05 ? MAX_SPARKS : sparks.idleCount) * 2)
    const flicker = lit > 0 ? 1 + 0.18 * Math.sin(t * 31 + seed * 7) + 0.3 * cascade : 1
    sp.scale.setScalar((1 + 0.8 * lit) * flicker)
    sparkMat.color.copy(tmpColor)
    sparkMat.opacity = (0.3 + 0.5 * lit + 0.4 * cascade) * dim
  })

  const showLabel = hovered || activation?.role === 'hit'
  const color = colorForType(data.type)

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
          emissiveIntensity={0.4}
          metalness={0.3}
          roughness={0.4}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={SPHERE} material={glowMat} scale={1.4} raycast={() => null} />
      <lineSegments ref={sparksRef} geometry={sparks.geometry} material={sparkMat} raycast={() => null} />
      {showLabel && (
        <Html
          position={[0, !hovered && activation?.rank % 2 === 1 ? -2.2 : 2, 0]}
          center
          zIndexRange={[40, 0]}
          style={{ pointerEvents: 'none', userSelect: 'none' }}
        >
          <div className="neuron-label animate-fade-up">
            <div className="label-text">{data.label}</div>
            {activation?.percentage != null ? (
              <div className="label-percentage">{activation.percentage}%</div>
            ) : (
              <div className="label-meta">
                <span style={{ color }}>{TYPE_LABELS[data.type]}</span>
                <span className="label-hint">{data.degree} sinapsis · click</span>
              </div>
            )}
          </div>
        </Html>
      )}
    </group>
  )
}

export default memo(Neuron)

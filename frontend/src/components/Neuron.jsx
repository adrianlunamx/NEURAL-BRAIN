import { memo, useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import * as THREE from 'three'
import glowSource from '../shaders/neuronGlow.glsl?raw'
import { splitShader } from '../utils/shader'
import { bump, easeOutCubic, hash01, idlePulse, now, popScale } from '../utils/animations'
import { colorForType, TYPE_LABELS } from '../utils/colors'

const GLOW = splitShader(glowSource)
const WHITE = new THREE.Color('#ffffff')
const SPHERE = new THREE.SphereGeometry(1, 32, 32)

/**
 * Dendrites + axon as line segments in neuron-local units (soma radius = 1).
 * Deterministic per id so a neuron always keeps the same silhouette.
 */
function buildDendrites(id) {
  let seed = Math.floor(hash01(id) * 1e6) + 1
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646
  const dir = () => new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize()
  const pts = []
  const segment = (a, b) => pts.push(a.x, a.y, a.z, b.x, b.y, b.z)

  const branch = (origin, d, length, depth) => {
    const end = origin.clone().add(d.clone().multiplyScalar(length))
    segment(origin, end)
    if (depth === 0) return
    for (let i = 0; i < 2; i++) {
      const nd = d.clone().add(dir().multiplyScalar(0.7)).normalize()
      branch(end, nd, length * (0.55 + rand() * 0.2), depth - 1)
    }
  }
  const count = 4 + Math.floor(rand() * 3)
  for (let i = 0; i < count; i++) {
    const d = dir()
    branch(d.clone().multiplyScalar(0.95), d, 0.9 + rand() * 0.6, 2)
  }
  // one long axon with a terminal fork
  const axon = dir()
  const tip = axon.clone().multiplyScalar(4 + rand() * 1.5)
  const bend = axon.clone().multiplyScalar(2).add(dir().multiplyScalar(0.5))
  segment(axon.clone().multiplyScalar(0.95), bend)
  segment(bend, tip)
  branch(tip, axon.clone().add(dir().multiplyScalar(0.8)).normalize(), 0.6, 1)
  branch(tip, axon.clone().add(dir().multiplyScalar(0.8)).normalize(), 0.6, 1)

  const g = new THREE.BufferGeometry()
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
  return g
}

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
  useEffect(() => () => glowMat.dispose(), [glowMat])
  const bornAt = useRef(now())
  const tmpColor = useMemo(() => new THREE.Color(), [])
  const dendriteGeo = useMemo(() => buildDendrites(data.id), [data.id])
  const dendriteMat = useMemo(
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
  useEffect(
    () => () => {
      dendriteGeo.dispose()
      dendriteMat.dispose()
    },
    [dendriteGeo, dendriteMat],
  )

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

    dendriteMat.color.copy(tmpColor)
    dendriteMat.opacity = Math.min(1, (0.28 + 0.5 * a + 0.6 * cascade + 0.3 * sync + 0.3 * hover) * dim)
  })

  // Smart label: only while hovered or when this neuron is a search hit.
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
          emissiveIntensity={0.9}
          metalness={0.35}
          roughness={0.25}
          transparent
          toneMapped={false}
        />
      </mesh>
      <mesh geometry={SPHERE} material={glowMat} scale={1.9} raycast={() => null} />
      <lineSegments geometry={dendriteGeo} material={dendriteMat} raycast={() => null} />
      {showLabel && (
        <Html position={[0, !hovered && activation?.rank % 2 === 1 ? -2.6 : 2.4, 0]} center zIndexRange={[40, 0]} style={{ pointerEvents: 'none', userSelect: 'none' }}>
          <div className="label-neuron animate-fade-up" style={{ '--c': color }}>
            <div className="label-text">
              {data.label.length > 34 ? data.label.slice(0, 33) + '…' : data.label}
            </div>
            <div className="label-meta">
              {activation?.percentage != null ? (
                <span className="label-percentage">{activation.percentage}%</span>
              ) : (
                <span style={{ color }}>{TYPE_LABELS[data.type]}</span>
              )}
              {hovered && <span className="label-hint">{data.degree} sinapsis · click</span>}
            </div>
          </div>
        </Html>
      )}
    </group>
  )
}

export default memo(Neuron)

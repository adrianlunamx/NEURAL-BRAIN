import * as THREE from 'three'

// ── timing ────────────────────────────────────────────────────
/** Seconds on a single clock shared by React state and useFrame. */
export const now = () => performance.now() / 1000

/** Phase boundaries (seconds after the query is submitted). */
export const PHASES = {
  input: 0,
  search: 0.3,
  connect: 0.8,
  synthesize: 1.5,
  settle: 2.0,
}

// OrbitControls autoRotateSpeed (three-stdlib: 1 ≈ one turn per minute at 60fps)
export const IDLE_ROTATE_SPEED = 0.5

// ── easing ────────────────────────────────────────────────────
export const clamp01 = (x) => Math.min(1, Math.max(0, x))
export const lerp = (a, b, t) => a + (b - a) * t
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3)
export const easeInOutCubic = (t) => {
  t = clamp01(t)
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}
export const easeOutElastic = (t) => {
  t = clamp01(t)
  if (t === 0 || t === 1) return t
  const c4 = (2 * Math.PI) / 3
  return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1
}
/** Gaussian bump centred on `center` - handy for one-shot pulses. */
export const bump = (t, center, width = 0.12) => Math.exp(-Math.pow((t - center) / width, 2))

/** 0 → 1.5 → 1.0 pop used when neurons are born. */
export const popScale = (t, duration = 0.3) => {
  const x = clamp01(t / duration)
  if (x < 0.55) return 1.5 * easeOutCubic(x / 0.55)
  return 1.5 - 0.5 * easeOutElastic((x - 0.55) / 0.45)
}

/** Idle breathing: scale 1.0 ↔ 1.05 on a 2s loop. */
export const idlePulse = (t, phase = 0) => 1.025 + 0.025 * Math.sin(t * Math.PI + phase)

// ── geometry ──────────────────────────────────────────────────
const _up = new THREE.Vector3(0, 1, 0)

/** Bow for each fibre type: long-range fibres arc like the corpus callosum. */
export const EDGE_BOW = { local: 0.12, long: 0.38 }

/** Curved edge between two points, bowed away from the brain's centre. */
export function edgeCurve(a, b, bow = EDGE_BOW.local) {
  const start = a instanceof THREE.Vector3 ? a : new THREE.Vector3(...a)
  const end = b instanceof THREE.Vector3 ? b : new THREE.Vector3(...b)
  const mid = start.clone().add(end).multiplyScalar(0.5)
  const len = start.distanceTo(end)
  const outward = mid.lengthSq() > 1e-4 ? mid.clone().normalize() : _up.clone()
  const control = mid.add(outward.multiplyScalar(len * bow))
  return new THREE.QuadraticBezierCurve3(start, control, end)
}

export const edgeKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export const toVec3 = (p) => new THREE.Vector3(p.x, p.y, p.z)

/** Deterministic pseudo-random in [0,1) from a string (stable per node). */
export function hash01(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 10000) / 10000
}

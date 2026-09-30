import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { IDLE_ROTATE_SPEED, easeInOutCubic, now } from '../utils/animations'

const FLY_TIME = 1.1
export const MIN_DISTANCE = 10
export const MAX_DISTANCE = 100

const clampDistance = (d) => THREE.MathUtils.clamp(d, MIN_DISTANCE + 1, MAX_DISTANCE - 2)

/**
 * OrbitControls (rotate · zoom 10-100 · pan) + smooth camera flights.
 * - focusOn(vec, distance): fly towards one neuron
 * - frame(points): fit a cluster of neurons in view (auto-zoom)
 * - home(): back to the overview
 */
const CameraRig = forwardRef(function CameraRig({ autoRotate, homeDistance }, ref) {
  const controls = useRef()
  const { camera } = useThree()
  const flight = useRef(null)

  const flyTo = (target, position) => {
    flight.current = {
      start: now(),
      fromTarget: controls.current.target.clone(),
      toTarget: target.clone(),
      fromPos: camera.position.clone(),
      toPos: position.clone(),
    }
  }
  const viewDir = () => camera.position.clone().sub(controls.current.target).normalize()

  useImperativeHandle(ref, () => ({
    focusOn(vec, distance = 12) {
      flyTo(vec, vec.clone().add(viewDir().multiplyScalar(clampDistance(distance))))
    },
    frame(points, padding = 1.35) {
      if (!points.length) return
      const center = points.reduce((acc, p) => acc.add(p), new THREE.Vector3()).divideScalar(points.length)
      const radius = Math.max(4, ...points.map((p) => p.distanceTo(center)))
      const fov = THREE.MathUtils.degToRad(camera.fov)
      const distance = clampDistance((radius * padding) / Math.sin(fov / 2))
      flyTo(center, center.clone().add(viewDir().multiplyScalar(distance)))
    },
    home() {
      const d = clampDistance(homeDistance)
      flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(d * 0.25, d * 0.18, d))
    },
    get target() {
      return controls.current?.target
    },
  }))

  // cancel a flight as soon as the user grabs the camera
  useEffect(() => {
    const c = controls.current
    const stop = () => (flight.current = null)
    c?.addEventListener('start', stop)
    return () => c?.removeEventListener('start', stop)
  }, [])

  useFrame(() => {
    const f = flight.current
    if (!f || !controls.current) return
    const x = easeInOutCubic((now() - f.start) / FLY_TIME)
    controls.current.target.lerpVectors(f.fromTarget, f.toTarget, x)
    camera.position.lerpVectors(f.fromPos, f.toPos, x)
    if (x >= 1) flight.current = null
  })

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.05}
      minDistance={MIN_DISTANCE}
      maxDistance={MAX_DISTANCE}
      enablePan
      panSpeed={0.5}
      screenSpacePanning
      rotateSpeed={0.5}
      zoomSpeed={1.2}
      autoRotate={autoRotate}
      autoRotateSpeed={IDLE_ROTATE_SPEED}
    />
  )
})

export default CameraRig

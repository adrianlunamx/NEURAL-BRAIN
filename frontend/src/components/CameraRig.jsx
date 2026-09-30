import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import { IDLE_ROTATION_RPM, easeInOutCubic, now } from '../utils/animations'

const FLY_TIME = 1.1

/**
 * OrbitControls + smooth camera flights.
 * `focusOn(vec, distance)` flies towards a neuron; `home()` returns to the overview.
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

  useImperativeHandle(ref, () => ({
    focusOn(vec, distance = 12) {
      const dir = camera.position.clone().sub(controls.current.target).normalize()
      flyTo(vec, vec.clone().add(dir.multiplyScalar(distance)))
    },
    home() {
      flyTo(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, homeDistance * 0.18, homeDistance))
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
      rotateSpeed={0.6}
      zoomSpeed={0.8}
      minDistance={3}
      maxDistance={220}
      autoRotate={autoRotate}
      // three-stdlib OrbitControls: autoRotateSpeed 1 ≈ 1 rpm at 60fps
      autoRotateSpeed={IDLE_ROTATION_RPM}
    />
  )
})

export default CameraRig

import { useEffect, useRef } from 'react'

/**
 * Auto-zoom: when the search phase lights up neurons, fly the camera so the
 * active cluster fills the view. Clearing the answer flies back home.
 *
 * @param {React.RefObject} rigRef  CameraRig handle (focusOn / frame / home)
 * @param {object} scene           useThinking scene
 * @param {Map} nodeMap            id -> node with `vec`
 * @param {boolean} enabled
 */
export function useAutoZoom(rigRef, scene, nodeMap, enabled = true) {
  const framedAt = useRef(null)
  const searchAt = scene.phaseAt?.search

  useEffect(() => {
    if (!enabled || !searchAt || framedAt.current === searchAt) return
    framedAt.current = searchAt
    const points = Object.keys(scene.activeNodes)
      .map((id) => nodeMap.get(id)?.vec)
      .filter(Boolean)
    if (scene.query?.pos) points.push(scene.query.pos)
    rigRef.current?.frame(points)
  }, [enabled, searchAt, scene.activeNodes, scene.query, nodeMap, rigRef])

  // back to the overview once the thought is dismissed
  const wasActive = useRef(false)
  useEffect(() => {
    const active = scene.phase !== 'idle'
    if (enabled && wasActive.current && !active) rigRef.current?.home()
    wasActive.current = active
  }, [enabled, scene.phase, rigRef])
}

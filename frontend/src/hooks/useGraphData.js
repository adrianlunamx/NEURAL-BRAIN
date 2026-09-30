import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../utils/api'
import { toVec3 } from '../utils/animations'

const EMPTY = { nodes: [], edges: [], stats: { nodes: 0, edges: 0, concepts: 0, facts: 0 } }

/** Fetches GET /api/graph and derives lookup tables used by the scene. */
export function useGraphData() {
  const [graph, setGraph] = useState(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const retryRef = useRef(null)

  const refresh = useCallback(async () => {
    clearTimeout(retryRef.current)
    try {
      const data = await api.graph()
      setGraph(data)
      setError(null)
      return data
    } catch (err) {
      setError(err.message)
      // The backend may still be loading its embedding model: keep retrying quietly.
      retryRef.current = setTimeout(refresh, 3000)
      return null
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    refresh()
    return () => clearTimeout(retryRef.current)
  }, [refresh])

  const derived = useMemo(() => {
    const nodeMap = new Map()
    let radius = 0
    for (const node of graph.nodes) {
      const vec = toVec3(node.position)
      radius = Math.max(radius, vec.length())
      nodeMap.set(node.id, { ...node, vec })
    }
    const neighbors = new Map()
    for (const e of graph.edges) {
      if (!neighbors.has(e.from)) neighbors.set(e.from, [])
      if (!neighbors.has(e.to)) neighbors.set(e.to, [])
      neighbors.get(e.from).push(e.to)
      neighbors.get(e.to).push(e.from)
    }
    return { nodeMap, neighbors, radius: Math.max(radius, 12) }
  }, [graph])

  // stable identity so streaming tokens elsewhere in the app don't re-render the 3D scene
  return useMemo(() => ({ ...graph, ...derived, loading, error, refresh }), [graph, derived, loading, error, refresh])
}

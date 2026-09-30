import { useCallback, useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { streamQuery } from '../utils/api'
import { EDGE_BOW, PHASES, edgeCurve, edgeKey, now } from '../utils/animations'
import { COLORS } from '../utils/colors'
import { particleBus } from '../utils/particleBus'

const IDLE_SCENE = {
  phase: 'idle', // idle | input | search | connect | synthesize | answered
  startedAt: 0,
  phaseAt: {},
  query: null, // { pos: Vector3, at }
  answer: null, // { pos: Vector3, at }
  activeNodes: {}, // id -> { at, role: 'hit'|'bridge', rank, score, cascade: number[] }
  activeEdges: {}, // key -> { at, from, to, order }
}

const EMPTY_RESPONSE = null

/**
 * Orchestrates the four thinking phases. Backend SSE events are mapped onto a
 * timeline (input 0-300ms, search 300-800ms, connect 800-1500ms, synthesize
 * 1500-2000ms). Each phase starts at the later of "its slot" and "when the
 * data arrived", so the animation never runs ahead of the real reasoning.
 */
export function useThinking({ nodeMap, edgeMap, radius, onGraphStale }) {
  const [scene, setScene] = useState(IDLE_SCENE)
  const [response, setResponse] = useState(EMPTY_RESPONSE)
  const timers = useRef([])
  const abortRef = useRef(null)
  const run = useRef(0)
  const graphRef = useRef({ nodeMap, edgeMap, radius })
  graphRef.current = { nodeMap, edgeMap, radius }

  const clearTimers = () => {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }

  const cancel = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    clearTimers()
    particleBus.clear()
    run.current++
  }, [])

  const clear = useCallback(() => {
    cancel()
    setScene(IDLE_SCENE)
    setResponse(EMPTY_RESPONSE)
  }, [cancel])

  /** User-initiated abort: stop the stream but keep what was found on screen. */
  const abort = useCallback(() => {
    cancel()
    setScene((s) => (s.phase === 'idle' ? s : { ...s, phase: 'answered' }))
    setResponse((r) => r && !r.done ? { ...r, done: true, error: r.text ? null : 'Pensamiento cancelado' } : r)
  }, [cancel])

  useEffect(() => cancel, [cancel])

  const ask = useCallback(
    async (question, { animate = true } = {}) => {
      cancel()
      const myRun = run.current
      const alive = () => run.current === myRun
      const k = animate ? 1 : 0 // collapses every delay when animations are off
      const { nodeMap: nodes, edgeMap: edgeInfo, radius: R } = graphRef.current
      const t0 = now()

      const trace = import.meta.env.DEV ? (window.__nbTimeline = []) : null
      const at = (time, fn) => {
        const id = setTimeout(() => {
          if (!alive()) return
          // dev aid: compare scheduled vs actual phase start (window.__nbTimeline)
          trace?.push({ scheduled: Math.round((time - t0) * 1000), actual: Math.round((now() - t0) * 1000) })
          fn()
        }, Math.max(0, (time - now()) * 1000))
        timers.current.push(id)
      }

      const queryPos = new THREE.Vector3(0, R * 0.95 + 3, 0)
      const tl = { input: t0, search: null, connect: null, synthesize: null }
      let hits = []
      let involved = [] // hits + bridges, for the synthesis convergence
      let tokenBuffer = ''
      let synthStarted = false

      setResponse({ question, text: '', sources: [], done: false, error: null, meta: null })
      setScene({
        ...IDLE_SCENE,
        phase: 'input',
        startedAt: t0,
        phaseAt: { input: t0 },
        query: { pos: queryPos, at: t0 },
      })
      if (animate) {
        particleBus.emit({ kind: 'burst', at: t0, origin: queryPos.toArray(), color: COLORS.query, count: 160, speed: 9, life: 0.9 })
      }

      // ── SEARCH ───────────────────────────────────────────────
      const onSearch = (data) => {
        tl.search = Math.max(now(), t0 + PHASES.search * k)
        hits = (data.nodes || []).filter((n) => nodes.has(n.id))
        if (hits.length < (data.nodes || []).length) onGraphStale?.()

        const dists = hits.map((h) => nodes.get(h.id).vec.distanceTo(queryPos))
        const dMin = dists.length ? Math.min(...dists) : 0
        const dMax = dists.length ? Math.max(...dists) : 1
        const activeNodes = {}
        hits.forEach((h, i) => {
          // the scan wave reaches nearer neurons first
          const reach = ((dists[i] - dMin) / (dMax - dMin + 1e-6)) * 0.4 * k
          const nodeAt = tl.search + 0.06 * k + reach
          const percentage = data.percentages?.[h.id] ?? h.percentage ?? Math.round(h.score * 100)
          activeNodes[h.id] = { at: nodeAt, role: 'hit', rank: h.rank, score: h.score, percentage, cascade: [] }
          if (animate) {
            particleBus.emit({
              kind: 'travel',
              at: Math.max(tl.search, nodeAt - 0.32),
              curve: edgeCurve(queryPos, nodes.get(h.id).vec),
              color: COLORS.query,
              count: 26,
              duration: 0.34,
              spread: 0.35,
            })
          }
        })
        at(tl.search, () =>
          setScene((s) => ({ ...s, phase: 'search', phaseAt: { ...s.phaseAt, search: tl.search }, activeNodes })),
        )
      }

      // ── CONNECT ──────────────────────────────────────────────
      const onConnect = (data) => {
        const searchAt = tl.search ?? now()
        tl.connect = Math.max(now(), searchAt + (PHASES.connect - PHASES.search) * k)
        const edges = (data.edges || []).filter((e) => nodes.has(e.from) && nodes.has(e.to))
        const span = 0.62 * k
        const step = edges.length > 1 ? span / edges.length : 0
        const activeEdges = {}
        const cascade = {}
        edges.forEach((e, i) => {
          const edgeAt = tl.connect + i * step
          activeEdges[edgeKey(e.from, e.to)] = { at: edgeAt, from: e.from, to: e.to, order: i }
          ;(cascade[e.from] ||= []).push(edgeAt)
          ;(cascade[e.to] ||= []).push(edgeAt + 0.22 * k)
          if (animate) {
            particleBus.emit({
              kind: 'travel',
              at: edgeAt,
              curve: edgeCurve(nodes.get(e.from).vec, nodes.get(e.to).vec, EDGE_BOW[edgeInfo?.get(edgeKey(e.from, e.to))?.range] ?? EDGE_BOW.local),
              color: COLORS.edgeActive,
              count: 22,
              duration: 0.42,
              spread: 0.18,
              size: 0.9,
            })
          }
        })
        const bridges = (data.bridges || []).filter((id) => nodes.has(id))
        involved = [...hits.map((h) => h.id), ...bridges]

        at(tl.connect, () =>
          setScene((s) => {
            const activeNodes = { ...s.activeNodes }
            for (const [id, times] of Object.entries(cascade)) {
              const prev = activeNodes[id]
              activeNodes[id] = prev
                ? { ...prev, cascade: times }
                : { at: Math.min(...times) + 0.12 * k, role: 'bridge', rank: 99, score: 0, cascade: times }
            }
            return { ...s, phase: 'connect', phaseAt: { ...s.phaseAt, connect: tl.connect }, activeNodes, activeEdges }
          }),
        )
      }

      // ── SYNTHESIZE ───────────────────────────────────────────
      const startSynthesis = () => {
        if (synthStarted) return
        synthStarted = true
        const connectAt = tl.connect ?? now()
        tl.synthesize = Math.max(now(), connectAt + (PHASES.synthesize - PHASES.connect) * k)

        const centroid = new THREE.Vector3()
        const pts = involved.map((id) => nodes.get(id)?.vec).filter(Boolean)
        pts.forEach((p) => centroid.add(p))
        if (pts.length) centroid.divideScalar(pts.length).multiplyScalar(0.35)
        const answerAt = tl.synthesize + 0.18 * k

        if (animate) {
          pts.forEach((p) =>
            particleBus.emit({
              kind: 'travel',
              at: tl.synthesize,
              curve: edgeCurve(p, centroid),
              color: COLORS.concept,
              count: 18,
              duration: 0.4,
              spread: 0.25,
            }),
          )
          particleBus.emit({ kind: 'burst', at: answerAt + 0.3, origin: centroid.toArray(), color: COLORS.answer, count: 220, speed: 7, life: 1.2 })
          particleBus.emit({ kind: 'burst', at: answerAt + 0.32, origin: centroid.toArray(), color: '#ffffff', count: 80, speed: 4, life: 0.8 })
        }

        at(tl.synthesize, () => {
          setScene((s) => ({
            ...s,
            phase: 'synthesize',
            phaseAt: { ...s.phaseAt, synthesize: tl.synthesize },
            answer: { pos: centroid, at: answerAt, sources: involved },
          }))
          setResponse((r) => r && { ...r, text: r.text + tokenBuffer })
          tokenBuffer = ''
        })
      }

      const finish = (data) => {
        startSynthesis()
        const settleAt = Math.max(now(), tl.synthesize + (PHASES.settle - PHASES.synthesize) * k)
        at(settleAt, () => {
          setScene((s) => ({ ...s, phase: 'answered', phaseAt: { ...s.phaseAt, answered: settleAt } }))
          setResponse((r) =>
            r && {
              ...r,
              text: data.answer || r.text + tokenBuffer,
              sources: data.sources || [],
              meta: { model: data.model, offline: data.offline, stopReason: data.stop_reason },
              done: true,
            },
          )
        })
      }

      const onEvent = (evt) => {
        if (!alive()) return
        switch (evt.type) {
          case 'search':
            return onSearch(evt.data)
          case 'connect':
            return onConnect(evt.data)
          case 'token':
            startSynthesis()
            if (tl.synthesize && now() >= tl.synthesize) {
              setResponse((r) => r && { ...r, text: r.text + evt.data.text })
            } else {
              tokenBuffer += evt.data.text
            }
            return
          case 'synthesize':
            return finish(evt.data)
          case 'error':
            setResponse((r) => r && { ...r, error: evt.data.message, done: true })
            setScene((s) => ({ ...s, phase: 'answered' }))
            return
          default:
            return
        }
      }

      const controller = new AbortController()
      abortRef.current = controller
      try {
        await streamQuery(question, { animate, signal: controller.signal, onEvent })
      } catch (err) {
        if (err.name === 'AbortError' || !alive()) return
        setResponse((r) => r && { ...r, error: err.message, done: true })
        setScene((s) => ({ ...s, phase: 'answered' }))
      }
    },
    [cancel, onGraphStale],
  )

  const thinking = !['idle', 'answered'].includes(scene.phase)
  return { scene, response, thinking, ask, clear, cancel: abort }
}

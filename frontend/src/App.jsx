import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import BrainCanvas from './components/BrainCanvas'
import Controls from './components/Controls'
import Header from './components/Header'
import IngestPanel from './components/IngestPanel'
import QueryInput from './components/QueryInput'
import ResponsePanel from './components/ResponsePanel'
import { NeuronInfoPanel } from './components/NeuronInfo'
import { EmptyState, Legend, Toasts } from './components/Hud'
import { useBrain } from './hooks/useBrain'
import { useGraphData } from './hooks/useGraphData'
import { useThinking } from './hooks/useThinking'
import { useAutoZoom } from './hooks/useAutoZoom'

const DEFAULT_OPTIONS = { animate: true, autoZoom: true, labels: false, shell: true, dof: false }

const loadOptions = () => {
  try {
    return { ...DEFAULT_OPTIONS, ...JSON.parse(localStorage.getItem('nb:options') || '{}') }
  } catch {
    return DEFAULT_OPTIONS
  }
}

export default function App() {
  const graph = useGraphData()
  const rig = useRef()
  const inputRef = useRef()
  const [hoveredId, setHoveredId] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [ingestOpen, setIngestOpen] = useState(false)
  const [options, setOptions] = useState(loadOptions)
  const [toasts, setToasts] = useState([])

  const notify = useCallback(({ type, message }) => {
    const id = Math.random().toString(36).slice(2)
    setToasts((t) => [...t.slice(-3), { id, type, message }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }, [])

  const { health, busy, ingest, seed, reset } = useBrain({ onChange: graph.refresh, notify })
  const { scene, response, thinking, ask, clear, cancel } = useThinking({
    nodeMap: graph.nodeMap,
    edgeMap: graph.edgeMap,
    radius: graph.radius,
    onGraphStale: graph.refresh,
  })

  useAutoZoom(rig, scene, graph.nodeMap, options.autoZoom)

  const setOption = useCallback((key, value) => {
    setOptions((o) => {
      const next = { ...o, [key]: value }
      try {
        localStorage.setItem('nb:options', JSON.stringify(next))
      } catch {
        /* private mode */
      }
      return next
    })
  }, [])

  const select = useCallback(
    (id) => {
      const node = graph.nodeMap.get(id)
      if (!node) return
      setSelectedId(id)
      rig.current?.focusOn(node.vec, 18 + node.size * 8)
    },
    [graph.nodeMap],
  )

  const home = useCallback(() => {
    setSelectedId(null)
    rig.current?.home()
  }, [])

  const handleAsk = useCallback(
    (q) => {
      setSelectedId(null)
      ask(q, { animate: options.animate })
    },
    [ask, options.animate],
  )

  const handleReset = useCallback(async () => {
    clear()
    setSelectedId(null)
    await reset().catch(() => {})
  }, [clear, reset])

  // Drop a stale selection after the graph changes.
  useEffect(() => {
    if (selectedId && !graph.nodeMap.has(selectedId)) setSelectedId(null)
  }, [graph.nodeMap, selectedId])

  const selectedNode = selectedId ? graph.nodeMap.get(selectedId) : null
  const neighbors = useMemo(() => (selectedId ? graph.neighbors.get(selectedId) || [] : []), [graph.neighbors, selectedId])
  const empty = !graph.loading && !graph.error && graph.nodes.length === 0
  const autoRotate = !thinking && !selectedId && !hoveredId

  return (
    <div className="scanlines relative h-full w-full">
      <BrainCanvas
        graph={graph}
        scene={scene}
        hoveredId={hoveredId}
        selectedId={selectedId}
        showLabels={options.labels}
        showShell={options.shell}
        dof={options.dof}
        onHover={setHoveredId}
        onSelect={select}
        onBackground={home}
        rigRef={rig}
        autoRotate={autoRotate}
      />

      <div className="pointer-events-none absolute inset-0">
        <Header
          stats={graph.stats}
          health={health}
          error={graph.error}
          phase={scene.phase}
          busy={busy}
          thinking={thinking}
          onFocusInput={() => inputRef.current?.focus()}
          onIngest={() => setIngestOpen(true)}
          onSeed={() => seed().catch(() => {})}
          onReset={handleReset}
        />
        <Controls options={options} setOption={setOption} onHome={home} />
        {empty && <EmptyState onSeed={() => seed().catch(() => {})} onIngest={() => setIngestOpen(true)} busy={busy} />}
        {graph.error && (
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 panel p-5 text-center font-mono text-sm text-slate-400">
            <div className="font-display tracking-widest text-neon-magenta">SIN SEÑAL DEL BACKEND</div>
            <p className="mt-2">Arranca la API en <code className="text-neon-cyan">http://localhost:8000</code> — reintentando…</p>
          </div>
        )}
        <NeuronInfoPanel
          node={selectedNode}
          neighbors={neighbors}
          nodeMap={graph.nodeMap}
          onSelect={select}
          onClose={home}
        />
        <ResponsePanel response={response} phase={scene.phase} onCite={select} onClose={clear} />
        <Legend />
        <QueryInput inputRef={inputRef} onAsk={handleAsk} onCancel={cancel} thinking={thinking} disabled={!!graph.error} empty={empty} compact={!!response} />
        <IngestPanel open={ingestOpen} onClose={() => setIngestOpen(false)} onSubmit={ingest} busy={busy} />
        <Toasts toasts={toasts} />
      </div>
    </div>
  )
}

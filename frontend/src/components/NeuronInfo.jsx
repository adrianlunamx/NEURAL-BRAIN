import { Html } from '@react-three/drei'
import { colorForType, TYPE_LABELS } from '../utils/colors'

/** Small label pinned to an active neuron (search results) or a concept. */
export function NeuronLabel({ node, score, subtle = false }) {
  const color = colorForType(node.type)
  return (
    <Html position={node.vec} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
      <div
        className={`mt-7 whitespace-nowrap rounded px-1.5 py-0.5 font-mono text-[10px] ${subtle ? 'opacity-60' : 'animate-fade-up'}`}
        style={{
          color,
          background: subtle ? 'transparent' : 'rgba(5,7,26,.7)',
          textShadow: `0 0 6px ${color}`,
        }}
      >
        {node.label.length > 28 ? node.label.slice(0, 27) + '…' : node.label}
        {score != null && <span className="ml-1 text-slate-400">{Math.round(score * 100)}%</span>}
      </div>
    </Html>
  )
}

/** Side panel with the full details of the selected neuron. */
export function NeuronInfoPanel({ node, neighbors, nodeMap, onSelect, onClose }) {
  if (!node) return null
  const color = colorForType(node.type)
  return (
    <aside className="panel pointer-events-auto absolute left-4 top-24 z-20 w-80 max-h-[calc(100vh-12rem)] overflow-y-auto animate-fade-up p-4">
      <div className="mb-3 flex items-start gap-2">
        <span
          className="mt-1 h-3 w-3 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 10px ${color}` }}
        />
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.3em]" style={{ color }}>
            {TYPE_LABELS[node.type]} · {node.id}
          </div>
          <h2 className="font-display text-lg leading-tight text-white">{node.label}</h2>
        </div>
        <button onClick={onClose} className="btn-ghost -mr-1 -mt-1 px-2" aria-label="Cerrar">
          ✕
        </button>
      </div>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-300">{node.content}</p>
      {node.tags?.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {node.tags.map((t) => (
            <span key={t} className="rounded border border-neon-cyan/40 px-1.5 py-0.5 text-[10px] text-neon-cyan">
              #{t}
            </span>
          ))}
        </div>
      )}
      <div className="mt-4 text-[10px] uppercase tracking-[0.3em] text-slate-500">
        Sinapsis ({neighbors.length})
      </div>
      <ul className="mt-2 space-y-1">
        {neighbors.map((id) => {
          const nb = nodeMap.get(id)
          if (!nb) return null
          const c = colorForType(nb.type)
          return (
            <li key={id}>
              <button
                onClick={() => onSelect(id)}
                className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-xs text-slate-300 transition hover:bg-white/5"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: c, boxShadow: `0 0 6px ${c}` }} />
                <span className="truncate">{nb.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

import { COLORS } from '../utils/colors'

export function Legend() {
  const items = [
    ['Concepto', COLORS.concept],
    ['Hecho', COLORS.fact],
    ['Consulta', COLORS.query],
    ['Respuesta', COLORS.answer],
  ]
  return (
    <div className="pointer-events-none absolute bottom-6 left-4 z-10 hidden space-y-1 font-mono text-[10px] text-slate-500 lg:block">
      {items.map(([label, color]) => (
        <div key={label} className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full" style={{ background: color, boxShadow: `0 0 8px ${color}` }} />
          {label}
        </div>
      ))}
      <div className="pt-2 text-slate-600">
        arrastra · rota &nbsp;|&nbsp; scroll · zoom
        <br />
        click · enfoca &nbsp;|&nbsp; doble click vacío · home
      </div>
    </div>
  )
}

export function EmptyState({ onSeed, onIngest, busy }) {
  return (
    <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center">
      <div className="pointer-events-auto panel max-w-md animate-fade-up p-6 text-center">
        <div className="font-display text-lg tracking-widest text-neon-cyan">CEREBRO VACÍO</div>
        <p className="mt-2 text-sm text-slate-400">
          Implanta un set de recuerdos de ejemplo o ingesta tu propio conocimiento para ver cómo se forman las sinapsis.
        </p>
        <div className="mt-4 flex justify-center gap-2">
          <button className="btn btn-green" onClick={onSeed} disabled={!!busy}>
            {busy === 'seed' ? 'IMPLANTANDO…' : '⚡ SEED'}
          </button>
          <button className="btn btn-cyan" onClick={onIngest}>
            ＋ INGEST
          </button>
        </div>
      </div>
    </div>
  )
}

export function Toasts({ toasts }) {
  return (
    <div className="pointer-events-none fixed bottom-28 right-4 z-50 space-y-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`panel animate-fade-up px-3 py-2 font-mono text-xs ${t.type === 'error' ? 'border-red-500/60 text-red-300' : 'text-neon-green'}`}
        >
          {t.type === 'error' ? '⚠ ' : '✓ '}
          {t.message}
        </div>
      ))}
    </div>
  )
}

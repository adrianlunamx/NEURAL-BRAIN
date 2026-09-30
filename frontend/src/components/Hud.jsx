import { COLORS } from '../utils/colors'

const PHASES = [
  ['input', 'INPUT'],
  ['search', 'SEARCH'],
  ['connect', 'CONNECT'],
  ['synthesize', 'SYNTHESIZE'],
]

export function Header({ stats, health, error }) {
  const online = !!health
  return (
    <div className="pointer-events-none absolute left-4 top-4 z-30 select-none">
      <h1 className="font-display text-2xl font-black tracking-[0.2em] text-white">
        NEURAL<span className="animate-flicker text-neon-magenta">//</span>
        <span className="text-neon-cyan">BRAIN</span>
      </h1>
      <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] text-slate-400">
        <span>
          <b className="text-neon-cyan">{stats?.nodes ?? 0}</b> neuronas
        </span>
        <span>
          <b className="text-neon-blue">{stats?.edges ?? 0}</b> sinapsis
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`h-1.5 w-1.5 rounded-full ${online ? (health.llm ? 'bg-neon-green' : 'bg-neon-yellow') : 'bg-red-500'}`} />
          {online ? (health.llm ? health.model : 'offline (sin API key)') : error ? 'backend desconectado' : 'conectando…'}
        </span>
      </div>
    </div>
  )
}

export function PhaseIndicator({ phase }) {
  if (phase === 'idle') return null
  const current = PHASES.findIndex(([p]) => p === phase)
  const done = phase === 'answered'
  return (
    <div className="pointer-events-none absolute left-1/2 top-[4.25rem] z-20 hidden -translate-x-1/2 items-center gap-1 md:flex">
      {PHASES.map(([p, label], i) => {
        const state = done || i < current ? 'done' : i === current ? 'active' : 'todo'
        return (
          <div key={p} className="flex items-center gap-1">
            <div
              className={`rounded border px-2 py-0.5 font-display text-[10px] tracking-[0.25em] transition-all duration-300 ${
                state === 'active'
                  ? 'border-neon-magenta bg-neon-magenta/15 text-neon-magenta shadow-neon-magenta'
                  : state === 'done'
                    ? 'border-neon-cyan/50 text-neon-cyan'
                    : 'border-white/10 text-slate-600'
              }`}
            >
              {label}
            </div>
            {i < PHASES.length - 1 && <div className={`h-px w-4 ${i < current || done ? 'bg-neon-cyan' : 'bg-white/10'}`} />}
          </div>
        )
      })}
    </div>
  )
}

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

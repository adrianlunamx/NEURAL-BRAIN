import { useState } from 'react'

const PHASES = [
  ['input', 'INPUT'],
  ['search', 'SEARCH'],
  ['connect', 'CONNECT'],
  ['synthesize', 'SYNTHESIZE'],
]

/**
 * Fixed top bar: logo · live stats · thinking phases · data actions.
 * The phase tabs light up as the brain thinks; INPUT focuses the query box.
 */
export default function Header({ stats, health, error, phase, busy, thinking, onFocusInput, onIngest, onSeed, onReset }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const online = !!health
  const current = PHASES.findIndex(([p]) => p === phase)
  const answered = phase === 'answered'

  const status = online
    ? health.llm
      ? { cls: 'online', text: `online · ${health.model}` }
      : { cls: 'offline', text: 'offline · sin API key' }
    : { cls: 'offline', text: error ? 'backend desconectado' : 'conectando…' }

  return (
    <header className="header pointer-events-auto">
      <div className="flex min-w-0 items-center gap-6">
        <div className="logo font-display">
          NEURAL<span className="accent animate-flicker">//</span>BRAIN
        </div>
        <div className="stats hidden md:flex">
          <span>
            <b className="text-neon-cyan">{stats?.nodes ?? 0}</b> neuronas
          </span>
          <span>
            <b className="text-neon-blue">{stats?.edges ?? 0}</b> sinapsis
          </span>
          <span className={status.cls}>● {status.text}</span>
        </div>
      </div>

      <nav className="tabs">
        {PHASES.map(([p, label], i) => {
          const state = answered || i < current ? 'done' : i === current ? 'active' : ''
          const isInput = p === 'input'
          return (
            <button
              key={p}
              className={`phase hidden lg:inline-block ${state}`}
              onClick={isInput ? onFocusInput : undefined}
              disabled={!isInput}
              title={isInput ? 'Escribir una pregunta ( / )' : `Fase ${label}`}
            >
              {label}
            </button>
          )
        })}
        <span className="mx-2 hidden h-5 w-px bg-white/10 lg:inline-block" />
        <button onClick={onIngest} disabled={thinking}>
          ＋ INGEST
        </button>
        <button className="seed" onClick={onSeed} disabled={!!busy || thinking}>
          {busy === 'seed' ? 'SEEDING…' : 'SEED'}
        </button>
        {confirmReset ? (
          <>
            <button
              className="danger confirm"
              onClick={() => {
                setConfirmReset(false)
                onReset()
              }}
            >
              ¿BORRAR TODO?
            </button>
            <button onClick={() => setConfirmReset(false)}>NO</button>
          </>
        ) : (
          <button className="danger" onClick={() => setConfirmReset(true)} disabled={!!busy || thinking}>
            {busy === 'reset' ? 'BORRANDO…' : 'RESET'}
          </button>
        )}
      </nav>
    </header>
  )
}

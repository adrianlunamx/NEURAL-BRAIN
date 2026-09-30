import { useState } from 'react'

function Toggle({ on, onClick, children, title }) {
  return (
    <button onClick={onClick} title={title} className={`btn ${on ? 'btn-on' : ''}`}>
      <span className={`mr-1.5 inline-block h-1.5 w-1.5 rounded-full ${on ? 'bg-neon-green shadow-[0_0_6px_#39ff14]' : 'bg-slate-600'}`} />
      {children}
    </button>
  )
}

/** Top-right command deck: data actions + visual toggles. */
export default function Controls({ busy, options, setOption, onIngest, onSeed, onReset, onHome, thinking }) {
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="pointer-events-auto absolute right-4 top-4 z-30 flex flex-wrap items-center justify-end gap-2">
      <button className="btn btn-cyan" onClick={onIngest} disabled={thinking}>
        ＋ INGEST
      </button>
      <button className="btn btn-green" onClick={onSeed} disabled={!!busy || thinking}>
        {busy === 'seed' ? 'IMPLANTANDO…' : '⚡ SEED'}
      </button>
      {confirmReset ? (
        <span className="flex items-center gap-1">
          <button
            className="btn btn-danger"
            onClick={() => {
              setConfirmReset(false)
              onReset()
            }}
          >
            ¿BORRAR TODO?
          </button>
          <button className="btn" onClick={() => setConfirmReset(false)}>
            NO
          </button>
        </span>
      ) : (
        <button className="btn btn-magenta" onClick={() => setConfirmReset(true)} disabled={!!busy || thinking}>
          {busy === 'reset' ? 'BORRANDO…' : '⟲ RESET'}
        </button>
      )}
      <span className="mx-1 hidden h-5 w-px bg-white/10 sm:block" />
      <Toggle on={options.animate} onClick={() => setOption('animate', !options.animate)} title="Animar el proceso de pensamiento">
        ANIM
      </Toggle>
      <Toggle on={options.labels} onClick={() => setOption('labels', !options.labels)} title="Etiquetas de conceptos">
        LABELS
      </Toggle>
      <Toggle on={options.dof} onClick={() => setOption('dof', !options.dof)} title="Profundidad de campo (más GPU)">
        DOF
      </Toggle>
      <button className="btn" onClick={onHome} title="Volver a la vista general (o doble click en el vacío)">
        ◎ HOME
      </button>
    </div>
  )
}

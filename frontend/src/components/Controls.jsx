function Toggle({ on, onClick, children, title }) {
  return (
    <button onClick={onClick} title={title} className={`btn w-full justify-start ${on ? 'btn-on' : ''}`}>
      <span className={`mr-2 inline-block h-1.5 w-1.5 rounded-full ${on ? 'bg-neon-green shadow-[0_0_6px_#39ff14]' : 'bg-slate-600'}`} />
      {children}
    </button>
  )
}

/** Bottom-right view panel: visual toggles + camera home. */
export default function Controls({ options, setOption, onHome, hasShell }) {
  return (
    <div className="pointer-events-auto absolute bottom-6 right-4 z-20 hidden w-36 flex-col gap-1.5 md:flex">
      <Toggle on={options.animate} onClick={() => setOption('animate', !options.animate)} title="Animar el proceso de pensamiento">
        ANIM
      </Toggle>
      <Toggle on={options.autoZoom} onClick={() => setOption('autoZoom', !options.autoZoom)} title="Acercar la cámara al cluster activo">
        AUTO-ZOOM
      </Toggle>
      <Toggle on={options.labels} onClick={() => setOption('labels', !options.labels)} title="Etiquetas de todos los conceptos">
        LABELS
      </Toggle>
      {hasShell && (
        <Toggle on={options.shell} onClick={() => setOption('shell', !options.shell)} title="Silueta holográfica del cerebro">
          SILUETA
        </Toggle>
      )}
      <Toggle on={options.dof} onClick={() => setOption('dof', !options.dof)} title="Profundidad de campo (más GPU)">
        DOF
      </Toggle>
      <button className="btn w-full justify-start" onClick={onHome} title="Vista general (o doble click en el vacío)">
        ◎ HOME
      </button>
    </div>
  )
}

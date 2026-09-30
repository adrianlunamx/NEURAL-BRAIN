import { useEffect, useRef, useState } from 'react'

const SUGGESTIONS = [
  '¿Cómo se relaciona la plasticidad sináptica con las redes neuronales?',
  '¿Qué es RAG y por qué reduce alucinaciones?',
  '¿Cómo organizo un segundo cerebro?',
  '¿Qué tiene que ver Neuromante con el ciberespacio?',
]

/** Terminal-style prompt. Enter to ask, ↑ to recall the last question, Esc to cancel. */
export default function QueryInput({ inputRef, onAsk, onCancel, thinking, disabled, empty, compact }) {
  const [value, setValue] = useState('')
  const [last, setLast] = useState('')
  const ownRef = useRef()
  const input = inputRef || ownRef

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === '/' && document.activeElement !== input.current && !e.target.closest?.('textarea,input')) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [input])

  const submit = (text = value) => {
    const q = text.trim()
    if (!q || thinking || disabled) return
    onAsk(q)
    setLast(q)
    setValue('')
  }

  return (
    <div className="pointer-events-auto absolute inset-x-0 bottom-6 z-20 mx-auto w-[min(760px,calc(100%-2rem))]">
      {!thinking && !value && !empty && !compact && (
        <div className="mb-3 flex flex-wrap justify-center gap-2">
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => submit(s)}
              className="rounded-full border border-neon-blue/40 bg-void-900/60 px-3 py-1 font-mono text-[11px] text-slate-400 backdrop-blur transition hover:border-neon-magenta hover:text-neon-magenta"
            >
              {s}
            </button>
          ))}
        </div>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className={`group relative flex items-center gap-3 overflow-hidden rounded-lg border bg-void-900/80 px-4 py-3 backdrop-blur-md transition ${
          thinking ? 'border-neon-magenta shadow-neon-magenta' : 'border-neon-cyan/50 shadow-neon-cyan focus-within:border-neon-cyan'
        }`}
      >
        {thinking && <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-transparent via-neon-magenta/15 to-transparent animate-scan-x" />}
        <span className={`font-mono text-sm ${thinking ? 'text-neon-magenta' : 'text-neon-cyan'}`}>
          {thinking ? '◉' : '>_'}
        </span>
        <input
          ref={input}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' && !value) setValue(last)
            if (e.key === 'Escape') thinking ? onCancel() : setValue('')
          }}
          disabled={disabled}
          maxLength={2000}
          placeholder={
            thinking
              ? 'pensando…  (Esc para cancelar)'
              : empty
                ? 'El cerebro está vacío: pulsa SEED o INGEST para empezar'
                : 'Pregunta algo a tu segundo cerebro…   ( / para enfocar )'
          }
          className="flex-1 bg-transparent font-mono text-sm text-white placeholder:text-slate-500 focus:outline-none disabled:cursor-not-allowed"
          autoFocus
        />
        <button
          type={thinking ? 'button' : 'submit'}
          onClick={thinking ? onCancel : undefined}
          disabled={!thinking && (!value.trim() || disabled)}
          className={`rounded-md border px-3 py-1 font-display text-xs tracking-widest transition disabled:opacity-30 ${
            thinking
              ? 'border-neon-magenta text-neon-magenta hover:bg-neon-magenta/10'
              : 'border-neon-cyan text-neon-cyan hover:bg-neon-cyan/10'
          }`}
        >
          {thinking ? 'ABORT' : 'THINK'}
        </button>
      </form>
    </div>
  )
}

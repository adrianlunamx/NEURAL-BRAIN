import { Fragment, useMemo } from 'react'
import { colorForType, TYPE_LABELS } from '../utils/colors'

/** Minimal, safe markdown: paragraphs, bullets, **bold**, *italic*, `code` and [n] citations. */
function renderInline(text, sources, onCite, keyPrefix) {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[\d+(?:,\s*\d+)*\]|_[^_]+_|\*[^*]+\*)/g)
  return parts.map((part, i) => {
    const key = `${keyPrefix}-${i}`
    if (/^\*\*[^*]+\*\*$/.test(part)) return <strong key={key} className="text-white">{part.slice(2, -2)}</strong>
    if (/^`[^`]+`$/.test(part)) return <code key={key} className="rounded bg-white/10 px-1 text-neon-cyan">{part.slice(1, -1)}</code>
    if (/^(_[^_]+_|\*[^*]+\*)$/.test(part)) return <em key={key} className="text-slate-400">{part.slice(1, -1)}</em>
    const cite = part.match(/^\[(\d+(?:,\s*\d+)*)\]$/)
    if (cite) {
      return cite[1].split(/,\s*/).map((n) => {
        const src = sources[Number(n) - 1]
        const color = src ? colorForType(src.type) : '#94a3b8'
        return (
          <button
            key={`${key}-${n}`}
            onClick={() => src && onCite(src.id)}
            title={src?.label}
            className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded-sm border px-1 align-middle font-mono text-[10px] transition hover:bg-white/10"
            style={{ color, borderColor: color }}
          >
            {n}
          </button>
        )
      })
    }
    return <Fragment key={key}>{part}</Fragment>
  })
}

function Markdown({ text, sources, onCite }) {
  const blocks = useMemo(() => text.split(/\n{2,}/), [text])
  return blocks.map((block, b) => {
    const lines = block.split('\n')
    if (lines.every((l) => /^\s*([-*•]|\d+\.)\s+/.test(l) || !l.trim())) {
      return (
        <ul key={b} className="my-2 space-y-1">
          {lines.filter((l) => l.trim()).map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="text-neon-cyan">▸</span>
              <span>{renderInline(l.replace(/^\s*([-*•]|\d+\.)\s+/, ''), sources, onCite, `${b}-${i}`)}</span>
            </li>
          ))}
        </ul>
      )
    }
    const heading = block.match(/^#{1,4}\s+(.*)/)
    if (heading) return <h3 key={b} className="mt-3 font-display text-sm tracking-wider text-neon-cyan">{heading[1]}</h3>
    return (
      <p key={b} className="my-2">
        {lines.map((l, i) => (
          <Fragment key={i}>
            {i > 0 && <br />}
            {renderInline(l, sources, onCite, `${b}-${i}`)}
          </Fragment>
        ))}
      </p>
    )
  })
}

export default function ResponsePanel({ response, phase, onCite, onClose }) {
  if (!response) return null
  const { question, text, sources, done, error, meta } = response
  const waiting = !text && !error
  return (
    <aside className="panel pointer-events-auto absolute right-4 top-24 z-20 flex max-h-[calc(100vh-22rem)] w-[min(420px,calc(100%-2rem))] animate-fade-up flex-col">
      <header className="flex items-start gap-3 border-b border-white/5 p-4">
        <div className="min-w-0 flex-1">
          <div className="text-[10px] uppercase tracking-[0.3em] text-neon-magenta">query</div>
          <p className="mt-1 text-sm text-white">{question}</p>
        </div>
        <button onClick={onClose} className="btn-ghost -mr-1 -mt-1 px-2" aria-label="Cerrar">
          ✕
        </button>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-3 text-sm leading-relaxed text-slate-300">
        {waiting && (
          <div className="flex items-center gap-2 font-mono text-xs text-slate-500">
            <span className="h-2 w-2 animate-ping rounded-full bg-neon-magenta" />
            {phase === 'search' ? 'escaneando memoria…' : phase === 'connect' ? 'conectando ideas…' : 'sintetizando…'}
          </div>
        )}
        {text && <Markdown text={text} sources={sources} onCite={onCite} />}
        {text && !done && <span className="ml-0.5 inline-block h-4 w-2 animate-blink bg-neon-yellow align-middle" />}
        {error && <p className="mt-2 rounded border border-red-500/40 bg-red-500/10 p-2 font-mono text-xs text-red-300">⚠ {error}</p>}
      </div>

      {done && sources.length > 0 && (
        <footer className="border-t border-white/5 p-4">
          <div className="mb-2 flex items-center text-[10px] uppercase tracking-[0.3em] text-slate-500">
            fuentes
            {meta?.model && <span className="ml-auto normal-case tracking-normal text-slate-600">{meta.model}</span>}
          </div>
          <ol className="space-y-1">
            {sources.map((s, i) => {
              const color = colorForType(s.type)
              return (
                <li key={s.id}>
                  <button
                    onClick={() => onCite(s.id)}
                    className="group flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-xs transition hover:bg-white/5"
                  >
                    <span className="w-4 font-mono text-slate-500">{i + 1}</span>
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: color, boxShadow: `0 0 6px ${color}` }} />
                    <span className="flex-1 truncate text-slate-300 group-hover:text-white" title={s.content}>
                      {s.label}
                    </span>
                    <span className="text-[10px] text-slate-600">{TYPE_LABELS[s.type]}</span>
                    <span className="w-12 text-right">
                      <span className="inline-block h-1 rounded bg-current align-middle" style={{ width: `${Math.max(8, s.score * 100) * 0.4}px`, color }} />
                    </span>
                  </button>
                </li>
              )
            })}
          </ol>
        </footer>
      )}
    </aside>
  )
}

import { useState } from 'react'

/** Modal to feed new knowledge into the brain (POST /api/ingest). */
export default function IngestPanel({ open, onClose, onSubmit, busy }) {
  const [content, setContent] = useState('')
  const [title, setTitle] = useState('')
  const [type, setType] = useState('fact')
  const [tags, setTags] = useState('')
  if (!open) return null

  const submit = async (e) => {
    e.preventDefault()
    if (!content.trim()) return
    try {
      await onSubmit(content.trim(), {
        type,
        title: title.trim() || undefined,
        tags: tags.split(',').map((t) => t.trim()).filter(Boolean),
      })
      setContent('')
      setTitle('')
      setTags('')
      onClose()
    } catch {
      /* toast already shown */
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-40 flex items-center justify-center bg-void-900/70 p-4 backdrop-blur-sm" onClick={onClose}>
      <form onSubmit={submit} onClick={(e) => e.stopPropagation()} className="panel w-[min(560px,100%)] animate-fade-up space-y-3 p-5">
        <div className="flex items-center">
          <h2 className="font-display text-lg tracking-widest text-neon-cyan">INGESTAR CONOCIMIENTO</h2>
          <button type="button" onClick={onClose} className="btn-ghost ml-auto px-2">
            ✕
          </button>
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          rows={6}
          maxLength={20000}
          autoFocus
          placeholder="Pega una nota, un hecho, una idea…"
          className="field resize-y"
          onKeyDown={(e) => (e.metaKey || e.ctrlKey) && e.key === 'Enter' && submit(e)}
        />
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder="Título (opcional)" className="field" />
        <div className="flex gap-2">
          {[
            ['fact', 'Hecho', 'btn-green'],
            ['concept', 'Concepto', 'btn-cyan'],
          ].map(([value, label, cls]) => (
            <button key={value} type="button" onClick={() => setType(value)} className={`btn flex-1 ${type === value ? `${cls} btn-on` : ''}`}>
              {label}
            </button>
          ))}
        </div>
        <input
          value={tags}
          onChange={(e) => setTags(e.target.value)}
          placeholder="Tags separados por coma → se convierten en neuronas-concepto"
          className="field"
        />
        <div className="flex items-center gap-3 pt-1">
          <span className="font-mono text-[10px] text-slate-500">Ctrl/⌘ + Enter</span>
          <button type="submit" disabled={!content.trim() || busy === 'ingest'} className="btn btn-cyan ml-auto">
            {busy === 'ingest' ? 'SINAPSANDO…' : 'IMPLANTAR →'}
          </button>
        </div>
      </form>
    </div>
  )
}

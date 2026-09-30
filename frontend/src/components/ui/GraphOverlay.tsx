import { useBrainStore } from "../../store/brainStore";
import { useNotesStore, visibleNotes } from "../../store/notesStore";
import { LINK_LABELS, TYPE_LABELS, TypeIcon } from "./common";
import { NowPanel, Waveform } from "./NowPanel";

/** Grafo | Lista and Grupos | Uso segmented controls. */
export function ViewTabs() {
  const mode = useNotesStore((s) => s.mode);
  const setMode = useNotesStore((s) => s.setMode);
  const colorBy = useNotesStore((s) => s.colorBy);
  const setColorBy = useNotesStore((s) => s.setColorBy);
  return (
    <div className="view-tabs">
      <div className="seg">
        <button className={mode === "grafo" ? "on" : ""} onClick={() => setMode("grafo")}>Grafo</button>
        <button className={mode === "lista" ? "on" : ""} onClick={() => setMode("lista")}>Lista</button>
      </div>
      <div className="seg" title="Colorear las notas por grupo o por uso (cuánto las tocan los agentes)">
        <button className={colorBy === "grupos" ? "on" : ""} onClick={() => setColorBy("grupos")}>Grupos</button>
        <button className={colorBy === "uso" ? "on" : ""} onClick={() => setColorBy("uso")}>Uso</button>
      </div>
    </div>
  );
}

function GraphControls() {
  const cameraCommand = useNotesStore((s) => s.cameraCommand);
  const relayout = useNotesStore((s) => s.relayout);
  const follow = useNotesStore((s) => s.follow);
  const setFollow = useNotesStore((s) => s.setFollow);
  return (
    <div className="graph-controls">
      <button onClick={() => cameraCommand("in")} title="Acercar">+</button>
      <button onClick={() => cameraCommand("out")} title="Alejar">−</button>
      <button onClick={() => cameraCommand("fit")}>Encuadrar</button>
      <button onClick={relayout}>Reacomodar</button>
      <button className={follow ? "on" : ""} onClick={() => setFollow(!follow)} title="La cámara sigue al agente activo">
        Seguir
      </button>
    </div>
  );
}

function Counter() {
  const view = useNotesStore((s) => s.view);
  const hiddenGroups = useNotesStore((s) => s.hiddenGroups);
  const hiddenTypes = useNotesStore((s) => s.hiddenTypes);
  const hiddenLinks = useNotesStore((s) => s.hiddenLinks);
  const notes = visibleNotes({ view, hiddenGroups, hiddenTypes });
  const ids = new Set(notes.map((n) => n.id));
  const links = view?.links.filter((l) => !hiddenLinks.has(l.type) && ids.has(l.source) && ids.has(l.target)).length ?? 0;
  return (
    <div className="counter">
      {notes.length} de {view?.notes.length ?? 0} notas · {links} conexiones
    </div>
  );
}

/** Details of the selected note and its connections. */
function NoteCard() {
  const view = useNotesStore((s) => s.view);
  const selected = useNotesStore((s) => s.selected);
  const select = useNotesStore((s) => s.select);
  const usage = useNotesStore((s) => s.activity?.note_usage);
  const note = view?.notes.find((n) => n.id === selected);
  if (!view || !note) return null;
  const group = view.groups.find((g) => g.name === note.group);
  const byId = new Map(view.notes.map((n) => [n.id, n]));
  const links = view.links.filter((l) => l.source === note.id || l.target === note.id);
  const problems = view.problems.filter((p) => p.note_id === note.id);
  return (
    <div className="note-card">
      <button className="close" onClick={() => select(null)}>×</button>
      <div className="nc-title"><TypeIcon type={note.type} color={group?.color} size={14} /> {note.title}</div>
      <div className="nc-meta">
        <span className="chip" style={{ borderColor: group?.color, color: group?.color }}>{note.group}</span>
        <span className="chip">{TYPE_LABELS[note.type]}</span>
        {note.path && <span className="muted mono">{note.path}</span>}
      </div>
      <p className="nc-text">{note.text}</p>
      {!!note.tags.length && <div className="nc-tags">{note.tags.map((t) => <span key={t}>#{t}</span>)}</div>}
      <div className="muted small">Usada {usage?.[note.id] ?? 0} veces por los agentes · {links.length} conexiones</div>
      {problems.map((p, i) => <div key={i} className="nc-problem">⚠ {p.detail}</div>)}
      <div className="nc-links">
        {links.slice(0, 14).map((l, i) => {
          const other = byId.get(l.source === note.id ? l.target : l.source);
          return other && (
            <button key={i} onClick={() => select(other.id)}>
              <span className="lt">{LINK_LABELS[l.type]}</span> {other.title}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Answer of the last question asked from the search box. */
function AnswerCard() {
  const answer = useBrainStore((s) => s.lastAnswer);
  const phase = useBrainStore((s) => s.phase);
  const setLastAnswer = useBrainStore((s) => s.setLastAnswer);
  if (!answer) return null;
  return (
    <div className="answer-card">
      <button className="close" onClick={() => setLastAnswer(null)}>×</button>
      <div className="aq">{answer.query}</div>
      <div className="aa">{answer.text || (phase === "IDLE" ? "…" : `pensando… (${phase})`)}</div>
      {answer.text && (
        <div className="muted small">{answer.source === "claude" ? "respuesta de Claude" : "resumen extractivo (sin API key)"}</div>
      )}
    </div>
  );
}

/** Everything drawn over the 3D graph. */
export function GraphOverlay() {
  const mode = useNotesStore((s) => s.mode);
  if (mode === "lista") return <ViewTabs />;
  return (
    <>
      <ViewTabs />
      <AnswerCard />
      <NoteCard />
      <NowPanel />
      <GraphControls />
      <Waveform />
      <Counter />
    </>
  );
}

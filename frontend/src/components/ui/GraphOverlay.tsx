import { useBrainStore } from "../../store/brainStore";
import { useNotesStore, visibleNotes } from "../../store/notesStore";
import { LINK_LABELS, pad, TYPE_LABELS, TypeIcon } from "./common";
import { setCameraReadoutEl } from "../CameraReadout";
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
      <button className="sq" onClick={() => cameraCommand("in")} title="Acercar">+</button>
      <button className="sq" onClick={() => cameraCommand("out")} title="Alejar">−</button>
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
      VIS <b>{pad(notes.length, 3)}</b>/{pad(view?.notes.length ?? 0, 3)} NOTAS · <b>{pad(links, 3)}</b> CONEX
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
      <div className="panel-cap">
        <span className="cap">Nota · {TYPE_LABELS[note.type]}</span>
        <button className="close" onClick={() => select(null)} title="Cerrar (Esc)">[×]</button>
      </div>
      <div className="nc-body">
        <div className="nc-title"><TypeIcon type={note.type} color={group?.color} size={12} /> {note.title}</div>
        <div className="nc-meta">
          <span className="cap">Grupo</span>
          <span className="v" style={{ color: group?.color }}>{note.group}</span>
          {note.path && <><span className="cap">Ruta</span><span className="v">{note.path}</span></>}
          <span className="cap">Uso</span>
          <span className="v">{pad(usage?.[note.id] ?? 0)} lecturas de agentes</span>
          <span className="cap">Grado</span>
          <span className="v">{pad(links.length)} conexiones</span>
        </div>
        <p className="nc-text">{note.text}</p>
        {!!note.tags.length && <div className="nc-tags">{note.tags.map((t) => <span key={t}>#{t}</span>)}</div>}
        {problems.map((p, i) => <div key={i} className="nc-problem">! {p.detail}</div>)}
        {!!links.length && (
          <div className="nc-links">
            <span className="cap">Conexiones</span>
            {links.slice(0, 14).map((l, i) => {
              const other = byId.get(l.source === note.id ? l.target : l.source);
              return other && (
                <button key={i} onClick={() => select(other.id)}>
                  <span className="lt">{LINK_LABELS[l.type]}</span> <span>{other.title}</span>
                </button>
              );
            })}
          </div>
        )}
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
      <div className="panel-cap">
        <span className="cap">Respuesta · {phase === "IDLE" ? "lista" : phase.toLowerCase()}</span>
        <button className="close" onClick={() => setLastAnswer(null)} title="Cerrar">[×]</button>
      </div>
      <div className="aq">&gt; {answer.query}</div>
      <div className="aa">{answer.text || (phase === "IDLE" ? "…" : "pensando…")}</div>
      {answer.text && (
        <div className="src cap">{answer.source === "claude" ? "fuente: Claude" : "fuente: resumen extractivo (sin API key)"}</div>
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
      <div className="frame" aria-hidden>
        <div className="ruler-x" /><div className="ruler-y" />
        <div className="mark tr" /><div className="mark br" />
        <div className="reticle" />
      </div>
      <div className="cam-readout" ref={setCameraReadoutEl} />
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

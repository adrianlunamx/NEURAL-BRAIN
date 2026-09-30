import { useBrainStore } from "../../store/brainStore";
import { useNotesStore } from "../../store/notesStore";
import { PROBLEM_LABELS } from "./common";

function formatGenerated(iso?: string): string {
  if (!iso) return "cargando…";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `Generado el ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function TopBar() {
  const view = useNotesStore((s) => s.view);
  const theme = useNotesStore((s) => s.theme);
  const toggleTheme = useNotesStore((s) => s.toggleTheme);
  const showProblems = useNotesStore((s) => s.showProblems);
  const setShowProblems = useNotesStore((s) => s.setShowProblems);
  const select = useNotesStore((s) => s.select);
  const anim = useBrainStore((s) => s.settings.anim);
  const alwaysLit = useBrainStore((s) => s.settings.alwaysLit);
  const style = useBrainStore((s) => s.settings.style);
  const updateSettings = useBrainStore((s) => s.updateSettings);
  const problems = view?.problems ?? [];
  const titleOf = new Map(view?.notes.map((n) => [n.id, n.title]) ?? []);

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" width="30" height="30" alt="Neural Brain" />
        <div>
          <div className="brand-title">Cerebro de tu agente</div>
          <div className="brand-sub">Neural Brain · {formatGenerated(view?.generated_at)}</div>
        </div>
      </div>
      <div className="top-stats">
        <span><b>{view?.notes.length ?? 0}</b> notas</span>
        <span><b>{view?.links.length ?? 0}</b> conexiones</span>
        <button className={`problems${problems.length ? " has" : ""}`} onClick={() => setShowProblems(!showProblems)}>
          {problems.length} {problems.length === 1 ? "problema" : "problemas"}
        </button>
        <div className="seg style-seg" title="Estilo del cerebro">
          <button className={style === "organico" ? "on" : ""} onClick={() => updateSettings({ style: "organico" })}>Orgánico</button>
          <button className={style === "neon" ? "on" : ""} onClick={() => updateSettings({ style: "neon" })}>Neón</button>
        </div>
        <label className="switch" title="Si está apagado, el cerebro reposa a oscuras y se ilumina al pensar">
          <input type="checkbox" checked={alwaysLit} onChange={() => updateSettings({ alwaysLit: !alwaysLit })} />
          <span className="knob" /> Siempre encendido
        </label>
        <label className="switch" title="Animaciones (A)">
          <input type="checkbox" checked={anim} onChange={() => updateSettings({ anim: !anim })} />
          <span className="knob" /> Animaciones
        </label>
        <button className="icon-btn" title={theme === "dark" ? "Tema claro" : "Tema oscuro"} onClick={toggleTheme}>
          {theme === "dark" ? "☀" : "☾"}
        </button>
      </div>
      {showProblems && (
        <div className="problems-pop">
          {problems.length === 0 && <div className="muted">Sin problemas 🎉</div>}
          {problems.map((p, i) => (
            <button key={i} className="problem-row" onClick={() => { select(p.note_id); setShowProblems(false); }}>
              <span className={`pk pk-${p.kind}`}>{PROBLEM_LABELS[p.kind] ?? p.kind}</span>
              <span className="pt">{titleOf.get(p.note_id) ?? p.note_id}</span>
              <span className="pd">{p.detail}</span>
            </button>
          ))}
        </div>
      )}
    </header>
  );
}

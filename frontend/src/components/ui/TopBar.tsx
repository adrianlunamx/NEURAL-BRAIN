import { useEffect, useState } from "react";
import { useBrainStore } from "../../store/brainStore";
import { useNotesStore } from "../../store/notesStore";
import { PROBLEM_LABELS, pad } from "./common";

function formatGenerated(iso?: string): string {
  if (!iso) return "cargando…";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `gen. ${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="readout clock opt">
      <span className="cap">Hora local</span>
      <span className="v">{pad(now.getHours())}:{pad(now.getMinutes())}:{pad(now.getSeconds())}</span>
    </div>
  );
}

function Toggle({ on, label, title, onClick }: { on: boolean; label: string; title: string; onClick: () => void }) {
  return (
    <button className={`toggle${on ? " on" : ""}`} title={title} onClick={onClick} aria-pressed={on}>
      <span className="lamp" /> <span className="lbl">{label}</span>
    </button>
  );
}

export function TopBar() {
  const view = useNotesStore((s) => s.view);
  const activity = useNotesStore((s) => s.activity);
  const connected = useNotesStore((s) => s.connected);
  const theme = useNotesStore((s) => s.theme);
  const toggleTheme = useNotesStore((s) => s.toggleTheme);
  const showProblems = useNotesStore((s) => s.showProblems);
  const setShowProblems = useNotesStore((s) => s.setShowProblems);
  const select = useNotesStore((s) => s.select);
  const totalNeurons = useBrainStore((s) => s.totalNeurons);
  const anim = useBrainStore((s) => s.settings.anim);
  const alwaysLit = useBrainStore((s) => s.settings.alwaysLit);
  const updateSettings = useBrainStore((s) => s.updateSettings);
  const problems = view?.problems ?? [];
  const titleOf = new Map(view?.notes.map((n) => [n.id, n.title]) ?? []);
  const rate = activity?.rate ?? [];
  const evs = rate.length ? rate[rate.length - 1] : 0;
  const working = activity?.sessions.some((s) => s.status !== "en reposo") ?? false;

  return (
    <header className="topbar">
      <div className="brand">
        <img src="/favicon.svg" width="22" height="22" alt="Neural Brain" />
        <div>
          <div className="brand-title">Cerebro de tu agente</div>
          <div className="brand-sub" title={formatGenerated(view?.generated_at)}>Neural Brain</div>
        </div>
      </div>
      <div className="readouts">
        <div className="readout opt">
          <span className="cap">Neuronas</span>
          <span className="v">{totalNeurons.toLocaleString("es")}</span>
        </div>
        <div className="readout">
          <span className="cap">Notas</span>
          <span className="v">{pad(view?.notes.length ?? 0, 3)}</span>
        </div>
        <div className="readout">
          <span className="cap">Conexiones</span>
          <span className="v">{pad(view?.links.length ?? 0, 3)}</span>
        </div>
        <button className={`readout${problems.length ? " alert" : ""}`} onClick={() => setShowProblems(!showProblems)}
          title="Enlaces rotos, notas sin conexiones y posibles duplicados">
          <span className="cap">Problemas {showProblems ? "▴" : "▾"}</span>
          <span className="v">{pad(problems.length)}</span>
        </button>
        <div className="readout opt">
          <span className="cap">Actividad</span>
          <span className="v">{evs.toFixed(1)}<span className="unit">ev/s</span></span>
        </div>
        <div className="readout live">
          <span className="cap">Señal</span>
          <span className="v">
            <span className={`live-dot${connected ? " on" : ""}`} />
            {!connected ? "SIN CONEXIÓN" : working ? "EN VIVO" : "EN ESPERA"}
          </span>
        </div>
        <Clock />
      </div>
      <div className="top-controls">
        <Toggle on={alwaysLit} label="Encendido" onClick={() => updateSettings({ alwaysLit: !alwaysLit })}
          title="Siempre encendido. Si está apagado, el cerebro reposa a oscuras y se ilumina al pensar" />
        <Toggle on={anim} label="Animación" onClick={() => updateSettings({ anim: !anim })} title="Animaciones (A)" />
        <button className="toggle" title={theme === "dark" ? "Tema claro" : "Tema oscuro"} onClick={toggleTheme}>
          {theme === "dark" ? "Claro" : "Oscuro"}
        </button>
      </div>
      {showProblems && (
        <div className="problems-pop">
          <span className="cap">Problemas · {problems.length}</span>
          {problems.length === 0 && <div className="empty muted">Sin problemas.</div>}
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

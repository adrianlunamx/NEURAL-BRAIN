import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../config";
import { actionColor, useNotesStore } from "../../store/notesStore";
import { basename, ClientBadge, clockTime, pad } from "./common";

/** Compact elapsed time for the log: "ahora", "7m", "2h". */
function since(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  return s < 60 ? "ahora" : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h`;
}

/** "Ahora": live agent sessions (Claude Code, Cursor, Codex...), their subagents, recent actions and edited files. */
export function NowPanel() {
  const activity = useNotesStore((s) => s.activity);
  const connected = useNotesStore((s) => s.connected);
  const view = useNotesStore((s) => s.view);
  const [busy, setBusy] = useState(false);
  const groupColor = new Map(view?.groups.map((g) => [g.name, g.color]) ?? []);
  const noteGroup = new Map(view?.notes.map((n) => [n.id, n.group]) ?? []);
  const now = activity?.now ?? Date.now() / 1000;

  const demo = async () => {
    setBusy(true);
    try {
      await fetch(`${API_URL}/activity/demo`, { method: "POST" });
    } finally {
      setTimeout(() => setBusy(false), 1500);
    }
  };

  const sessions = (activity?.sessions ?? []).slice(0, 3);
  return (
    <div className="now-panel">
      <div className="panel-cap">
        <span className={`live-dot${connected ? " on" : ""}`} />
        <span className="cap"><b>Ahora</b> · {connected ? "conectado" : "sin conexión"}</span>
        <button className="probar" onClick={() => void demo()} disabled={busy} title="Simula dos agentes trabajando (Claude Code y Cursor)">
          Probar
        </button>
      </div>

      <div className="now-body">
        {sessions.length === 0 && <div className="muted small">Sin sesiones. Conecta los hooks o pulsa Probar.</div>}
        {sessions.map((s) => {
          const agents = s.agents.filter((a) => !a.done).slice(0, 6);
          return (
            <div key={s.id} className="session">
              <div className="session-head">
                <span className="proj">{s.project}</span>
                <ClientBadge client={s.client} />
                <span className={`status st-${s.status.replace(" ", "-")}`}>{s.status}</span>
              </div>
              {(s.detail || s.active_agents > 0) && (
                <div className="session-meta">
                  {s.detail}{s.detail && s.active_agents > 0 ? " · " : ""}
                  {s.active_agents > 0 && `${s.active_agents} agente${s.active_agents > 1 ? "s" : ""}`}
                </div>
              )}
              {agents.map((a) => (
                <div key={a.key} className="agent-row">
                  <span className="tree">└</span>
                  <b>{a.label}</b> <span className="muted">{a.last_action || "…"}</span>{" "}
                  <span className="act-n">×{pad(a.actions)}</span>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {!!activity?.events.length && (
        <>
          <div className="log-cap"><span className="cap">Registro</span><span className="cap">{pad(activity.events.length)} ev.</span></div>
          <div className="events">
            {activity.events.slice(0, 7).map((e) => {
              const g = e.note_id ? noteGroup.get(e.note_id) : undefined;
              return (
                <div key={e.id} className="event-row">
                  <span className="when">{clockTime(e.ts)}</span>
                  <span className="act" style={{ color: actionColor(e.action) }}>{e.action}</span>
                  <span className="what" title={`${e.agent_label}: ${e.target}`}>
                    <i style={{ background: g ? groupColor.get(g) : "var(--faint)" }} />
                    {e.agent_label}{e.target ? `: ${basename(e.target)}` : ""}
                  </span>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!!activity?.files.length && (
        <>
          <div className="log-cap"><span className="cap">Archivos editados</span><span className="cap">últimos 30 min</span></div>
          <div className="files">
            {activity.files.slice(0, 5).map((f) => (
              <div key={f.path} className="file-row">
                <span className="fname" title={f.path}>{basename(f.path)}</span>
                <span className="add">+{f.added}</span>
                <span className="del">−{f.removed}</span>
                <span className="when">{since(f.last_at, now)}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

const W = 200, H = 44;

/** Activity trace (events per second, last 2 minutes) drawn like an oscilloscope. */
export function Waveform() {
  const activity = useNotesStore((s) => s.activity);
  const theme = useNotesStore((s) => s.theme);
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = activity?.sessions[0]?.status ?? "en reposo";
  const rate = activity?.rate ?? [];
  const peak = Math.max(0, ...rate);

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const css = getComputedStyle(c);
    const grid = css.getPropertyValue("--rule").trim() || "#1d2326";
    const trace = css.getPropertyValue("--accent").trim() || "#ffb547";
    const dpr = window.devicePixelRatio || 1;
    c.width = W * dpr; c.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    // graticule: 10 x 4 divisions
    ctx.strokeStyle = grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < 10; i++) { const x = Math.round((i * W) / 10) + 0.5; ctx.moveTo(x, 0); ctx.lineTo(x, H); }
    for (let i = 1; i < 4; i++) { const y = Math.round((i * H) / 4) + 0.5; ctx.moveTo(0, y); ctx.lineTo(W, y); }
    ctx.stroke();
    // trace
    const max = Math.max(3, peak);
    ctx.strokeStyle = trace;
    ctx.lineWidth = 1.25;
    ctx.lineJoin = "round";
    ctx.beginPath();
    rate.forEach((v, i) => {
      const x = (i / Math.max(1, rate.length - 1)) * W;
      const y = H - 3 - (v / max) * (H - 8);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    if (!rate.length) { ctx.moveTo(0, H - 3); ctx.lineTo(W, H - 3); }
    ctx.stroke();
  }, [rate, peak, theme]);

  return (
    <div className="waveform">
      <canvas ref={canvas} style={{ width: W, height: H }} />
      <div className="wave-cap">
        <span className={`status st-${status.replace(" ", "-")}`}>{status}</span>
        <span className="cap">máx {peak.toFixed(1)} ev/s · 2 min</span>
      </div>
    </div>
  );
}

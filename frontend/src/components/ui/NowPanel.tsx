import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../config";
import { actionColor, useNotesStore } from "../../store/notesStore";
import { ago, basename, ClientBadge } from "./common";

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
      <div className="now-head">
        <span className={`live-dot${connected ? " on" : ""}`} />
        <b>Ahora</b>
        <span className="muted">{connected ? "conectado" : "sin conexión"}</span>
        <button className="probar" onClick={() => void demo()} disabled={busy} title="Simula dos agentes trabajando (Claude Code y Cursor)">
          Probar
        </button>
      </div>

      {sessions.length === 0 && <div className="muted small">Sin sesiones. Conecta los hooks o pulsa Probar.</div>}
      {sessions.map((s) => {
        const agents = s.agents.filter((a) => !a.done).slice(0, 6);
        return (
          <div key={s.id} className="session">
            <div>
              <b>{s.project}</b> <ClientBadge client={s.client} /> <span className={`status st-${s.status.replace(" ", "-")}`}>{s.status}</span>
              {s.detail && <span className="muted"> · {s.detail}</span>}
              {s.active_agents > 0 && <span className="muted"> · {s.active_agents} agente{s.active_agents > 1 ? "s" : ""}</span>}
            </div>
            {agents.map((a) => (
              <div key={a.key} className="agent-row">
                <span className="tree">↳</span>
                <b>{a.label}</b>
                <span className="muted"> {a.last_action || "…"} · {a.actions} acciones</span>
              </div>
            ))}
          </div>
        );
      })}

      {!!activity?.events.length && (
        <div className="events">
          {activity.events.slice(0, 7).map((e) => {
            const g = e.note_id ? noteGroup.get(e.note_id) : undefined;
            return (
              <div key={e.id} className="event-row">
                <span className="when">{ago(e.ts, now)}</span>
                <span className="act" style={{ color: actionColor(e.action) }}>{e.action}</span>
                <span className="dot" style={{ background: g ? groupColor.get(g) : "#5b6480" }} />
                <span className="what" title={`${e.agent_label}: ${e.target}`}>
                  {e.agent_label}{e.target ? `: ${basename(e.target)}` : ""}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {!!activity?.files.length && (
        <div className="files">
          <div className="files-head">Programando <span className="muted">(última media hora)</span></div>
          {activity.files.slice(0, 5).map((f) => (
            <div key={f.path} className="file-row">
              <span className="dot" style={{ background: "#29d3e6" }} />
              <span className="fname" title={f.path}>{basename(f.path)}</span>
              <span className="add">+{f.added}</span>
              <span className="del">−{f.removed}</span>
              <span className="when">{ago(f.last_at, now)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Activity waveform (events per second, last 2 minutes) + current state. */
export function Waveform() {
  const activity = useNotesStore((s) => s.activity);
  const canvas = useRef<HTMLCanvasElement>(null);
  const status = activity?.sessions[0]?.status ?? "en reposo";

  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    const rate = activity?.rate ?? [];
    const w = c.width, h = c.height, mid = h / 2;
    ctx.clearRect(0, 0, w, h);
    const max = Math.max(3, ...rate);
    ctx.strokeStyle = "rgba(160, 190, 255, 0.85)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    rate.forEach((v, i) => {
      const x = (i / Math.max(1, rate.length - 1)) * w;
      // mirrored wave with a little texture so silence still "breathes"
      const amp = (v / max) * (mid - 2) + 1 + Math.abs(Math.sin(i * 1.7)) * 1.2;
      ctx.moveTo(x, mid - amp);
      ctx.lineTo(x, mid + amp);
    });
    ctx.stroke();
  }, [activity]);

  return (
    <div className="waveform">
      <canvas ref={canvas} width={170} height={34} />
      <div className="wave-status">{status}</div>
    </div>
  );
}

import { Phase } from "../types";
import { useBrainStore } from "../store/brainStore";

const PHASE_COLORS: Record<Phase, string> = {
  IDLE: "#8b93a7",
  INPUT: "#ff4dff",
  SEARCH: "#ff4dff",
  CONNECT: "#ffffff",
  SYNTHESIZE: "#ffe14d",
};

export function Hud() {
  const phase = useBrainStore((s) => s.phase);
  const stats = useBrainStore((s) => s.stats);
  const answer = useBrainStore((s) => s.lastAnswer);
  return (
    <div className="qb-hud">
      <div className="qb-phase" style={{ borderColor: PHASE_COLORS[phase], color: PHASE_COLORS[phase] }}>
        {phase}
      </div>
      <div className="qb-stats">
        <div>{stats.total_neurons.toLocaleString()} neuronas</div>
        <div>{stats.total_edges.toLocaleString()} sinapsis</div>
        <div>{stats.total_events.toLocaleString()} eventos</div>
      </div>
      {answer && (
        <div className="qb-answer">
          <div className="qb-answer-q">{answer.query}</div>
          <div className="qb-answer-a">
            {answer.text || (phase === "IDLE" ? "…" : "pensando…")}
          </div>
          {answer.text && (
            <div className="qb-answer-src">
              {answer.source === "claude" ? "respuesta de Claude" : "resumen extractivo (sin API key)"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

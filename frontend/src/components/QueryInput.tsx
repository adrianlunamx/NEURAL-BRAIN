import { useState } from "react";
import { API_URL } from "../config";
import { useBrainStore } from "../store/brainStore";

export function QueryInput() {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const phase = useBrainStore((s) => s.phase);

  const send = async () => {
    const q = text.trim();
    if (!q || busy || phase !== "IDLE") return;
    setBusy(true);
    try {
      await fetch(`${API_URL}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q, top_k: 8 }),
      });
      setText("");
    } catch (err) {
      console.error("[brain] query failed", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="qb-input">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") void send(); }}
        placeholder={phase === "IDLE" ? "Pregunta a tu segundo cerebro..." : `fase ${phase}...`}
        disabled={phase !== "IDLE" || busy}
        maxLength={500}
      />
      <button onClick={() => void send()} disabled={phase !== "IDLE" || busy || !text.trim()}>
        {busy ? "..." : "Consultar"}
      </button>
    </div>
  );
}

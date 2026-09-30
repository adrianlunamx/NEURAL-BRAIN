import { useEffect } from "react";
import { useBrainStore } from "../store/brainStore";

function Toggle({ label, k, hint }: { label: string; k: "anim" | "autoZoom" | "labels" | "dof" | "bloom"; hint: string }) {
  const value = useBrainStore((s) => s.settings[k]);
  const updateSettings = useBrainStore((s) => s.updateSettings);
  return (
    <button
      className={`qb-toggle ${value ? "on" : ""}`}
      title={hint}
      onClick={() => updateSettings({ [k]: !value })}
    >
      <span className="qb-key">{hint}</span> {label}
    </button>
  );
}

export function ControlPanel() {
  const bumpResetToken = useBrainStore((s) => s.bumpResetToken);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const s = useBrainStore.getState();
      switch (e.key.toLowerCase()) {
        case "a": s.updateSettings({ anim: !s.settings.anim }); break;
        case "z": s.updateSettings({ autoZoom: !s.settings.autoZoom }); break;
        case "l": s.updateSettings({ labels: !s.settings.labels }); break;
        case "d": s.updateSettings({ dof: !s.settings.dof }); break;
        case "b": s.updateSettings({ bloom: !s.settings.bloom }); break;
        case "h": s.bumpResetToken(); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="qb-panel">
      <div className="qb-panel-title">CONTROLES</div>
      <Toggle label="ANIM" k="anim" hint="A" />
      <Toggle label="AUTO-ZOOM" k="autoZoom" hint="Z" />
      <Toggle label="LABELS" k="labels" hint="L" />
      <Toggle label="DOF" k="dof" hint="D" />
      <Toggle label="BLOOM" k="bloom" hint="B" />
      <button className="qb-toggle" title="Reset camera (H)" onClick={bumpResetToken}>
        <span className="qb-key">H</span> HOME
      </button>
    </div>
  );
}

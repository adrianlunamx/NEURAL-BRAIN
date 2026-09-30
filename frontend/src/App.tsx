import { useEffect } from "react";
import { BrainCanvas } from "./components/BrainCanvas";
import { TopBar } from "./components/ui/TopBar";
import { Sidebar } from "./components/ui/Sidebar";
import { GraphOverlay } from "./components/ui/GraphOverlay";
import { ListView } from "./components/ui/ListView";
import { useBrainStore } from "./store/brainStore";
import { useNotesStore } from "./store/notesStore";
import "./index.css";

export default function App() {
  const mode = useNotesStore((s) => s.mode);
  const theme = useNotesStore((s) => s.theme);

  // A: animaciones · F: encuadrar · H: vista inicial · Esc: soltar la nota
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === "INPUT") return;
      const b = useBrainStore.getState();
      const n = useNotesStore.getState();
      switch (e.key.toLowerCase()) {
        case "a": b.updateSettings({ anim: !b.settings.anim }); break;
        case "f": n.cameraCommand("fit"); break;
        case "h": b.bumpResetToken(); break;
        case "escape": n.select(null); break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className={`app theme-${theme}`}>
      <TopBar />
      <div className="body">
        <Sidebar />
        <main className="stage">
          <BrainCanvas />
          <GraphOverlay />
          {mode === "lista" && <ListView />}
        </main>
      </div>
    </div>
  );
}

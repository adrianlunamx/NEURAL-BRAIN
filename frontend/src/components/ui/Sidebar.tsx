import { useEffect, useRef, useState } from "react";
import { API_URL } from "../../config";
import { useBrainStore } from "../../store/brainStore";
import { useNotesStore } from "../../store/notesStore";
import { LinkType, NoteType } from "../../types";
import { LINK_LABELS, LinkSample, pad, TYPE_LABELS, TypeIcon } from "./common";

function SectionHead({ idx, title, kind }: { idx: string; title: string; kind: "group" | "type" | "link" }) {
  const setAll = useNotesStore((s) => s.setAll);
  return (
    <div className="sec-head">
      <span className="cap"><span className="idx">{idx}</span>{title}</span>
      <span className="sec-actions">
        <button onClick={() => setAll(kind, true)}>todos</button>
        <button onClick={() => setAll(kind, false)}>ninguno</button>
      </span>
    </div>
  );
}

export function Sidebar() {
  const view = useNotesStore((s) => s.view);
  const hiddenGroups = useNotesStore((s) => s.hiddenGroups);
  const hiddenTypes = useNotesStore((s) => s.hiddenTypes);
  const hiddenLinks = useNotesStore((s) => s.hiddenLinks);
  const toggle = useNotesStore((s) => s.toggle);
  const search = useNotesStore((s) => s.search);
  const setSearch = useNotesStore((s) => s.setSearch);
  const phase = useBrainStore((s) => s.phase);
  const inputRef = useRef<HTMLInputElement>(null);
  const [asking, setAsking] = useState(false);

  // "/" focuses the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Enter asks the brain (RAG over the notes, animated phases in the graph)
  const ask = async () => {
    const q = search.trim();
    if (!q || asking || phase !== "IDLE") return;
    setAsking(true);
    try {
      await fetch(`${API_URL}/query`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: q, top_k: 8 }),
      });
    } catch (err) {
      console.error("[brain] query failed", err);
    } finally {
      setAsking(false);
    }
  };

  const types = (view ? Object.keys(view.types) : []) as NoteType[];
  const links = (view ? Object.keys(view.link_types) : []) as LinkType[];

  return (
    <aside className="sidebar">
      <div className="search">
        <span className="search-ico">&gt;</span>
        <input
          ref={inputRef}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask();
            if (e.key === "Escape") { setSearch(""); inputRef.current?.blur(); }
          }}
          placeholder={phase === "IDLE" ? "buscar o preguntar…" : `pensando (${phase})…`}
          title="Escribe para filtrar; Enter pregunta al cerebro"
        />
        <kbd>/</kbd>
      </div>

      <SectionHead idx="01" title="Grupos" kind="group" />
      {view?.groups.map((g) => (
        <label key={g.name} className="row">
          <input type="checkbox" checked={!hiddenGroups.has(g.name)} onChange={() => toggle("group", g.name)} />
          <span className="dot" style={{ background: g.color }} />
          <span className="name" title={g.name}>{g.name}</span>
          <span className="count">{pad(g.count, 3)}</span>
        </label>
      ))}

      <SectionHead idx="02" title="Tipos de nota" kind="type" />
      {types.map((t) => (
        <label key={t} className="row">
          <input type="checkbox" checked={!hiddenTypes.has(t)} onChange={() => toggle("type", t)} />
          <span className="ico"><TypeIcon type={t} /></span>
          <span className="name">{TYPE_LABELS[t]}</span>
          <span className="count">{pad(view?.types[t] ?? 0, 3)}</span>
        </label>
      ))}

      <SectionHead idx="03" title="Conexiones" kind="link" />
      {links.map((l) => (
        <label key={l} className={`row${hiddenLinks.has(l) ? " off" : ""}`}>
          <input type="checkbox" checked={!hiddenLinks.has(l)} onChange={() => toggle("link", l)} />
          <span className="ico line"><LinkSample type={l} /></span>
          <span className="name">{LINK_LABELS[l]}</span>
          <span className="count">{pad(view?.link_types[l] ?? 0, 3)}</span>
        </label>
      ))}
    </aside>
  );
}

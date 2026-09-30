import { useMemo, useState } from "react";
import { searchMatches, useNotesStore, visibleNotes } from "../../store/notesStore";
import { Note } from "../../types";
import { TYPE_LABELS, TypeIcon } from "./common";

type SortKey = "title" | "group" | "type" | "degree" | "uso" | "created_at";

/** "Lista": every visible note in a sortable table; a click opens it in the graph. */
export function ListView() {
  const view = useNotesStore((s) => s.view);
  const hiddenGroups = useNotesStore((s) => s.hiddenGroups);
  const hiddenTypes = useNotesStore((s) => s.hiddenTypes);
  const search = useNotesStore((s) => s.search);
  const usage = useNotesStore((s) => s.activity?.note_usage);
  const select = useNotesStore((s) => s.select);
  const setMode = useNotesStore((s) => s.setMode);
  const [sort, setSort] = useState<SortKey>("degree");
  const [desc, setDesc] = useState(true);

  const rows = useMemo(() => {
    const matches = searchMatches(view, search);
    const notes = visibleNotes({ view, hiddenGroups, hiddenTypes }).filter((n) => !matches || matches.has(n.id));
    const val = (n: Note): string | number =>
      sort === "uso" ? usage?.[n.id] ?? 0 : sort === "degree" ? n.degree : n[sort];
    return [...notes].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return desc ? -c : c;
    });
  }, [view, hiddenGroups, hiddenTypes, search, usage, sort, desc]);

  const color = new Map(view?.groups.map((g) => [g.name, g.color]) ?? []);
  const head = (key: SortKey, label: string, num = false) => (
    <th className={`${sort === key ? "sorted" : ""}${num ? " num" : ""}`} onClick={() => { if (sort === key) setDesc(!desc); else { setSort(key); setDesc(key !== "title" && key !== "group"); } }}>
      {label}{sort === key ? (desc ? " ▾" : " ▴") : ""}
    </th>
  );

  return (
    <div className="list-view">
      <table>
        <thead>
          <tr>
            {head("title", "Nota")}{head("group", "Grupo")}{head("type", "Tipo")}
            {head("degree", "Conexiones", true)}{head("uso", "Uso", true)}{head("created_at", "Creada")}
          </tr>
        </thead>
        <tbody>
          {rows.map((n) => (
            <tr key={n.id} onClick={() => { select(n.id); setMode("grafo"); }}>
              <td className="t"><TypeIcon type={n.type} color={color.get(n.group)} /> {n.title}</td>
              <td><span className="dot" style={{ background: color.get(n.group) }} /> {n.group}</td>
              <td>{TYPE_LABELS[n.type]}</td>
              <td className="num">{n.degree}</td>
              <td className="num">{usage?.[n.id] ?? 0}</td>
              <td className="date">{n.created_at.slice(0, 16).replace("T", " ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length === 0 && <div className="muted empty">No hay notas con estos filtros.</div>}
    </div>
  );
}

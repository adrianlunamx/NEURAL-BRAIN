import { create } from "zustand";
import * as THREE from "three";
import { layoutNotes, V3 } from "../layout/noteLayout";
import { ActivityEvent, ActivitySnapshot, LinkType, Note, NoteType, NotesView } from "../types";

export type ViewMode = "grafo" | "lista";
export type ColorMode = "grupos" | "uso";
export type CameraCommand = "in" | "out" | "fit";

interface NotesState {
  view: NotesView | null;
  /** layout targets (D3); NotesAnimator moves livePositions toward them */
  targets: Map<string, V3>;
  layoutSeed: number;
  hiddenGroups: Set<string>;
  hiddenTypes: Set<NoteType>;
  hiddenLinks: Set<LinkType>;
  search: string;
  hovered: string | null;
  selected: string | null;
  mode: ViewMode;
  colorBy: ColorMode;
  theme: "dark" | "light";
  follow: boolean;
  showProblems: boolean;
  activity: ActivitySnapshot | null;
  connected: boolean;
  camera: { command: CameraCommand; token: number } | null;

  setView: (view: NotesView) => void;
  relayout: () => void;
  toggle: (kind: "group" | "type" | "link", key: string) => void;
  setAll: (kind: "group" | "type" | "link", visible: boolean) => void;
  setSearch: (s: string) => void;
  setHovered: (id: string | null) => void;
  select: (id: string | null) => void;
  setMode: (m: ViewMode) => void;
  setColorBy: (c: ColorMode) => void;
  toggleTheme: () => void;
  setFollow: (f: boolean) => void;
  setShowProblems: (v: boolean) => void;
  setActivity: (a: ActivitySnapshot) => void;
  pushActivity: (e: ActivityEvent) => void;
  setConnected: (c: boolean) => void;
  cameraCommand: (c: CameraCommand) => void;
}

const ALL_LINK_TYPES: LinkType[] = [
  "wiki", "indice", "enlace", "responde", "mencion", "carpeta", "cadena", "sugerida", "parecida", "comparte",
];

function toggled<T>(set: Set<T>, key: T): Set<T> {
  const next = new Set(set);
  if (next.has(key)) next.delete(key); else next.add(key);
  return next;
}

export const useNotesStore = create<NotesState>((set, get) => ({
  view: null,
  targets: new Map(),
  layoutSeed: 1,
  hiddenGroups: new Set(),
  hiddenTypes: new Set(),
  hiddenLinks: new Set<LinkType>(["comparte"]),  // the densest kind starts hidden
  search: "",
  hovered: null,
  selected: null,
  mode: "grafo",
  colorBy: "grupos",
  theme: "dark",
  follow: false,
  showProblems: false,
  activity: null,
  connected: false,
  camera: null,

  setView: (view) => {
    const targets = layoutNotes(view, get().targets, 1);
    set({ view, targets });
  },
  relayout: () => {
    const { view, layoutSeed } = get();
    if (!view) return;
    const seed = layoutSeed + 1;
    set({ layoutSeed: seed, targets: layoutNotes(view, get().targets, seed) });
  },
  toggle: (kind, key) => set((s) => (
    kind === "group" ? { hiddenGroups: toggled(s.hiddenGroups, key) }
      : kind === "type" ? { hiddenTypes: toggled(s.hiddenTypes, key as NoteType) }
        : { hiddenLinks: toggled(s.hiddenLinks, key as LinkType) })),
  setAll: (kind, visible) => set((s) => {
    if (kind === "group") return { hiddenGroups: visible ? new Set() : new Set(s.view?.groups.map((g) => g.name) ?? []) };
    if (kind === "type") return { hiddenTypes: visible ? new Set() : new Set(Object.keys(s.view?.types ?? {}) as NoteType[]) };
    return { hiddenLinks: visible ? new Set() : new Set(ALL_LINK_TYPES) };
  }),
  setSearch: (search) => set({ search }),
  setHovered: (hovered) => set({ hovered }),
  select: (selected) => set({ selected }),
  setMode: (mode) => set({ mode }),
  setColorBy: (colorBy) => set({ colorBy }),
  toggleTheme: () => set((s) => ({ theme: s.theme === "dark" ? "light" : "dark" })),
  setFollow: (follow) => set({ follow }),
  setShowProblems: (showProblems) => set({ showProblems }),
  setActivity: (activity) => set({ activity }),
  pushActivity: (e) => set((s) => {
    if (!s.activity) return {};
    const usage = { ...s.activity.note_usage };
    if (e.note_id) usage[e.note_id] = (usage[e.note_id] ?? 0) + 1;
    return { activity: { ...s.activity, events: [e, ...s.activity.events].slice(0, 60), note_usage: usage } };
  }),
  setConnected: (connected) => set({ connected }),
  cameraCommand: (command) => set((s) => ({ camera: { command, token: (s.camera?.token ?? 0) + 1 } })),
}));

// ---------------------------------------------------------------------------
// derived helpers
// ---------------------------------------------------------------------------
export function normalizeText(t: string): string {
  return t.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
}

/** Notes that pass the group/type filters. */
export function visibleNotes(s: Pick<NotesState, "view" | "hiddenGroups" | "hiddenTypes">): Note[] {
  if (!s.view) return [];
  return s.view.notes.filter((n) => !s.hiddenGroups.has(n.group) && !s.hiddenTypes.has(n.type));
}

/** Ids matching the search box (null = no search active). */
export function searchMatches(view: NotesView | null, search: string): Set<string> | null {
  const q = normalizeText(search.trim());
  if (!view || !q) return null;
  return new Set(view.notes
    .filter((n) => normalizeText(`${n.title} ${n.text} ${n.tags.join(" ")} ${n.path}`).includes(q))
    .map((n) => n.id));
}

// ---------------------------------------------------------------------------
// live positions: animated every frame by NotesAnimator (outside React)
// ---------------------------------------------------------------------------
export const livePositions = new Map<string, THREE.Vector3>();

// note pulse bus (an agent touched a note): FireflyNotes makes it flare
type PulseListener = (noteId: string, color: string) => void;
const pulseListeners = new Set<PulseListener>();

export function onNotePulse(fn: PulseListener): () => void {
  pulseListeners.add(fn);
  return () => { pulseListeners.delete(fn); };
}

export function emitNotePulse(noteId: string, color: string): void {
  noteAwake.set(noteId, 1);
  pulseListeners.forEach((fn) => fn(noteId, color));
}

/**
 * How awake each note is (1 = just used, fades to 0 in ~20 s; NotesAnimator
 * decays it). Asleep notes and their connections stay dim.
 */
export const noteAwake = new Map<string, number>();

/** UI colour of each action verb (panel, markers, pulses). */
export const ACTION_COLORS: Record<string, string> = {
  busca: "#ffd24d", lee: "#29d3e6", edita: "#ff9f43", crea: "#b6ff4d",
  git: "#ff7ab6", commit: "#ff4d8d", compila: "#ffa62b", prueba: "#2ee6a6",
  script: "#9aa4ff", agente: "#d66bff", espera: "#ffe14d", piensa: "#ff8fd1", fin: "#7a8599",
};

export function actionColor(action: string): string {
  return ACTION_COLORS[action] ?? "#9aa4ff";
}

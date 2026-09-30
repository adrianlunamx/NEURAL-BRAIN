// Mirror of backend/app/models.py — keep in sync.

export type Region =
  | "frontal"
  | "parietal"
  | "temporal"
  | "occipital"
  | "hippocampus"
  | "cerebellum";

export type Phase = "IDLE" | "INPUT" | "SEARCH" | "CONNECT" | "SYNTHESIZE";

export type EdgeType = "local" | "fiber" | "query_ray";

export interface NeuronData {
  id: string;
  label: string;
  region: Region;
  position: [number, number, number];
  color: string;
  size: number;
  activation: number;
}

export interface GraphNodeDTO {
  id: string;
  label: string;
  region: Region;
  x: number;
  y: number;
  z: number;
  size: number;
  color: string;
}

export interface GraphEdgeDTO {
  source: string;
  target: string;
  weight: number;
  type: EdgeType;
}

export interface QueryHit {
  id: string;
  label: string;
  region: Region;
  score: number;
  position: [number, number, number];
}

export interface ScanTarget {
  id: string;
  position: [number, number, number];
}

export interface PhasePayload {
  phase: Phase;
  query_id?: string;
  text?: string;
  position?: [number, number, number];        // INPUT: magenta neuron pos
  query_position?: [number, number, number];  // SEARCH/CONNECT: ray origin
  status?: string;                            // SEARCH: "escaneando memoria..."
  targets?: ScanTarget[];                     // SEARCH
  hits?: QueryHit[];                          // CONNECT / SYNTHESIZE
  summary?: string;                           // SYNTHESIZE
  summary_source?: "claude" | "extractive";   // SYNTHESIZE: who wrote the summary
  error?: string;                             // IDLE after a failed query
  center?: [number, number, number];           // SYNTHESIZE: yellow neuron pos
  converged_ids?: string[];                    // SYNTHESIZE
}

export interface Ray3D {
  id: string;
  from: [number, number, number];
  to: [number, number, number];
  color: string;
}

export interface Label3D {
  id: string;
  text: string;
  position: [number, number, number];
}

export interface BrainStats {
  total_neurons: number;
  total_edges: number;
  total_events: number;
  phase: Phase;
}

export const REGION_COLORS: Record<Region, string> = {
  frontal: "#4da3ff",
  parietal: "#8a63ff",
  temporal: "#3ddc97",
  occipital: "#ff9f43",
  hippocampus: "#ff4d6d",
  cerebellum: "#4dd2ff",
};

export const MAX_NEURONS = 19000;

// ---------------------------------------------------------------------------
// Notes (memories) and live activity — mirror of backend/app/notes.py + activity.py
// ---------------------------------------------------------------------------
export type NoteType =
  | "instrucciones" | "indice" | "usuario" | "feedback"
  | "proyecto" | "referencia" | "documento" | "handoff";

export type LinkType =
  | "wiki" | "indice" | "enlace" | "responde" | "mencion"
  | "carpeta" | "cadena" | "sugerida" | "parecida" | "comparte";

export interface Note {
  id: string;
  title: string;
  group: string;
  type: NoteType;
  text: string;
  tags: string[];
  path: string;
  source: "ingest" | "query";
  created_at: string;
  region: Region;
  neuron_ids: string[];
  position: [number, number, number];
  degree: number;
}

export interface NoteLink {
  source: string;
  target: string;
  type: LinkType;
  weight: number;
}

export interface NoteGroup {
  name: string;
  color: string;
  region: Region;
  anchor: [number, number, number];
  count: number;
}

export interface NoteProblem {
  kind: "enlace_roto" | "huerfana" | "duplicado";
  note_id: string;
  detail: string;
}

export interface NotesView {
  notes: Note[];
  links: NoteLink[];
  groups: NoteGroup[];
  types: Record<NoteType, number>;
  link_types: Record<LinkType, number>;
  problems: NoteProblem[];
  generated_at: string;
}

export interface ActivityEvent {
  id: string;
  ts: number;
  event: string;
  session_id: string;
  project: string;
  client: string;
  agent: string;
  agent_label: string;
  agent_num: number;
  action: string;
  target: string;
  summary: string;
  note_id: string | null;
  lines_added: number;
  lines_removed: number;
}

export interface AgentInfo {
  key: string;
  num: number;
  label: string;
  kind: string;
  description: string;
  actions: number;
  last_action: string;
  last_target: string;
  last_note: string | null;
  last_at: number;
  done: boolean;
}

export interface SessionInfo {
  id: string;
  project: string;
  client: string;
  status: "trabajando" | "pensando" | "esperando" | "en reposo";
  detail: string;
  last_at: number;
  main: AgentInfo;
  agents: AgentInfo[];
  active_agents: number;
}

export interface ActivitySnapshot {
  now: number;
  sessions: SessionInfo[];
  events: ActivityEvent[];
  files: { path: string; project: string; added: number; removed: number; last_at: number }[];
  rate: number[];
  totals: Record<string, number>;
  note_usage: Record<string, number>;
}

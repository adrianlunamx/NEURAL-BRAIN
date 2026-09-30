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

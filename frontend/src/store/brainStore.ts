import { create } from "zustand";
import {
  BrainStats, Label3D, MAX_NEURONS, NeuronData, Phase, PhasePayload, Ray3D,
} from "../types";

export interface Settings {
  anim: boolean;      // rotación automática
  alwaysLit: boolean; // cerebro siempre iluminado (si no, se enciende al pensar)
  autoZoom: boolean;  // cámara sigue las fases de query
  labels: boolean;    // labels flotantes con %
  dof: boolean;       // depth of field
  bloom: boolean;     // postprocessing bloom
}

interface BrainState {
  phase: Phase;
  phasePayload: PhasePayload | null;
  neurons: Map<string, NeuronData>;
  neuronOrder: string[];   // stratified render order from backend
  graphLoaded: boolean;
  graphVersion: number;  // bumps on every full (re)load, e.g. after a git restore
  totalNeurons: number;
  queryNeuron: { position: [number, number, number]; text: string } | null;
  rays: Ray3D[];
  labels3d: Label3D[];
  settings: Settings;
  stats: BrainStats;
  resetToken: number;  // increment -> BrainCanvas resets camera (HOME)
  lastAnswer: { query: string; text: string; source: string } | null;

  // actions
  loadGraph: (nodes: NeuronData[], order: string[], total: number) => void;
  setPhase: (phase: Phase, payload?: PhasePayload | null) => void;
  upsertNeuron: (n: NeuronData) => void;
  setQueryNeuron: (q: BrainState["queryNeuron"]) => void;
  setRays: (rays: Ray3D[]) => void;
  setLabels3d: (labels: Label3D[]) => void;
  updateSettings: (patch: Partial<Settings>) => void;
  setStats: (s: Partial<BrainStats>) => void;
  bumpResetToken: () => void;
  clearQueryFx: () => void;
  setLastAnswer: (a: BrainState["lastAnswer"]) => void;
}

const INITIAL_STATS: BrainStats = {
  total_neurons: 0, total_edges: 0, total_events: 0, phase: "IDLE",
};

export const useBrainStore = create<BrainState>((set) => ({
  phase: "IDLE",
  phasePayload: null,
  neurons: new Map(),
  neuronOrder: [],
  graphLoaded: false,
  graphVersion: 0,
  totalNeurons: 0,
  queryNeuron: null,
  rays: [],
  labels3d: [],
  settings: { anim: true, alwaysLit: false, autoZoom: true, labels: true, dof: false, bloom: true },
  stats: INITIAL_STATS,
  resetToken: 0,
  lastAnswer: null,

  loadGraph: (nodes, order, total) =>
    set((s) => {
      const map = new Map<string, NeuronData>();
      for (const n of nodes) map.set(n.id, n);
      return { neurons: map, neuronOrder: order, graphLoaded: true, totalNeurons: total, graphVersion: s.graphVersion + 1 };
    }),

  setPhase: (phase, payload = null) =>
    set({ phase, phasePayload: payload ?? { phase } }),

  upsertNeuron: (n) =>
    set((s) => {
      if (s.neurons.has(n.id)) {
        // structural identity unchanged (e.g. a recycled neuron): mutate in place
        const existing = s.neurons.get(n.id)!;
        existing.label = n.label;
        existing.region = n.region;
        existing.position = n.position;
        existing.color = n.color;
        existing.size = n.size;
        emitUpsert(existing);
        return {};
      }
      if (s.neurons.size >= MAX_NEURONS) return {};
      const next = new Map(s.neurons);
      next.set(n.id, n);
      emitUpsert(n);
      return { neurons: next, neuronOrder: [...s.neuronOrder, n.id] };
    }),

  setQueryNeuron: (queryNeuron) => set({ queryNeuron }),
  setRays: (rays) => set({ rays }),
  setLabels3d: (labels3d) => set({ labels3d }),
  updateSettings: (patch) => set((s) => ({ settings: { ...s.settings, ...patch } })),
  setStats: (patch) => set((s) => ({ stats: { ...s.stats, ...patch } })),
  bumpResetToken: () => set((s) => ({ resetToken: s.resetToken + 1 })),
  clearQueryFx: () => set({ queryNeuron: null, rays: [], labels3d: [] }),
  setLastAnswer: (lastAnswer) => set({ lastAnswer }),
}));

// ---------------------------------------------------------------------------
// Activation bus: 60fps path that bypasses React re-renders.
// NeuronDust subscribes; useBrainSocket emits on SSE neuron_activated.
// ---------------------------------------------------------------------------
type ActivationListener = (id: string, amount: number) => void;
const activationListeners = new Set<ActivationListener>();

export function onActivation(fn: ActivationListener): () => void {
  activationListeners.add(fn);
  return () => { activationListeners.delete(fn); };
}

export function emitActivation(id: string, amount: number): void {
  activationListeners.forEach((fn) => fn(id, amount));
}

// ---------------------------------------------------------------------------
// Upsert bus: a neuron was added or recycled (new label/region/position/color)
// after the initial load. NeuronDust rewrites that single point.
// ---------------------------------------------------------------------------
type UpsertListener = (n: NeuronData) => void;
const upsertListeners = new Set<UpsertListener>();

export function onNeuronUpsert(fn: UpsertListener): () => void {
  upsertListeners.add(fn);
  return () => { upsertListeners.delete(fn); };
}

function emitUpsert(n: NeuronData): void {
  upsertListeners.forEach((fn) => fn(n));
}

// ---------------------------------------------------------------------------
// Spark bus: "something is being thought about here" — NeuronDust lights the
// neurons around a point in a wave (a note an agent touched, a query hit...).
// ---------------------------------------------------------------------------
type SparkListener = (position: [number, number, number], amount: number, radius: number) => void;
const sparkListeners = new Set<SparkListener>();

export function onSpark(fn: SparkListener): () => void {
  sparkListeners.add(fn);
  return () => { sparkListeners.delete(fn); };
}

export function emitSpark(position: [number, number, number], amount = 1, radius = 1.2): void {
  sparkListeners.forEach((fn) => fn(position, amount, radius));
}

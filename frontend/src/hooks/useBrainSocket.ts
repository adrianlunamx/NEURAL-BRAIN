import { useEffect } from "react";
import { API_URL } from "../config";
import { GraphEdgeDTO, GraphNodeDTO, NeuronData, Phase, PhasePayload } from "../types";
import { emitActivation, useBrainStore } from "../store/brainStore";

/** Connects to SSE, translates events into store actions, loads the graph. */
export function useBrainSocket() {
  useEffect(() => {
    const es = new EventSource(`${API_URL}/events/stream`);
    const get = useBrainStore.getState;

    const onPhase = (e: MessageEvent) => {
      const payload = JSON.parse(e.data).payload as PhasePayload;
      const phase = (payload.phase ?? "IDLE") as Phase;
      if (phase === "SYNTHESIZE" && payload.summary) {
        const query = get().phasePayload?.text ?? get().lastAnswer?.query ?? "";
        get().setLastAnswer({ query, text: payload.summary, source: payload.summary_source ?? "extractive" });
      }
      if (phase === "INPUT" && payload.text) {
        get().setLastAnswer({ query: payload.text, text: "", source: "" });
      }
      if (phase === "IDLE") {
        get().clearQueryFx();
        get().setQueryNeuron(null);
      }
      get().setPhase(phase, payload);
      get().setStats({ phase });
    };

    const onNeuronActivated = (e: MessageEvent) => {
      const p = JSON.parse(e.data).payload as { id: string; amount: number };
      emitActivation(p.id, p.amount); // fast path, no react render
      const n = get().neurons.get(p.id);
      if (n) n.activation = p.amount;
    };

    const onNeuronAdded = (e: MessageEvent) => {
      const p = JSON.parse(e.data).payload as {
        id: string; label: string; region: NeuronData["region"];
        position: [number, number, number]; color: string; size: number;
      };
      get().upsertNeuron({
        id: p.id, label: p.label, region: p.region, position: p.position,
        color: p.color, size: p.size, activation: 1,
      });
      emitActivation(p.id, 1);
    };

    const onStats = (e: MessageEvent) => {
      const p = JSON.parse(e.data).payload;
      get().setStats({
        total_neurons: p.total_neurons,
        total_edges: p.total_edges,
        total_events: p.total_events,
      });
    };

    const onGraphReloaded = () => {
      // backend restored a git snapshot -> refetch the whole graph
      void loadGraph();
    };

    es.addEventListener("phase", onPhase as EventListener);
    es.addEventListener("neuron_activated", onNeuronActivated as EventListener);
    es.addEventListener("neuron_added", onNeuronAdded as EventListener);
    es.addEventListener("edge_added", (() => {}) as EventListener); // reserved
    es.addEventListener("stats", onStats as EventListener);
    es.addEventListener("graph_reloaded", onGraphReloaded as EventListener);
    // EventSource reconnects on its own; after a lost connection (backend
    // restarted) the graph may have changed, so resync it once reopened.
    let connectionLost = false;
    es.onerror = () => {
      connectionLost = true;
    };
    es.onopen = () => {
      if (!connectionLost) return;
      connectionLost = false;
      void loadGraph();
    };

    async function loadGraph() {
      try {
        const res = await fetch(`${API_URL}/graph?detail=ultra`);
        const data = await res.json() as {
          nodes: GraphNodeDTO[]; edges: GraphEdgeDTO[]; total_neurons: number;
        };
        const nodes: NeuronData[] = data.nodes.map((n) => ({
          id: n.id, label: n.label, region: n.region,
          position: [n.x, n.y, n.z], color: n.color, size: n.size, activation: 0,
        }));
        get().loadGraph(nodes, nodes.map((n) => n.id), data.total_neurons);
        const statsRes = await fetch(`${API_URL}/stats`);
        const stats = await statsRes.json();
        get().setStats({
          total_neurons: stats.total_neurons,
          total_edges: stats.total_edges,
          total_events: stats.total_events,
        });
      } catch (err) {
        console.error("[brain] failed to load graph", err);
      }
    }
    void loadGraph();

    return () => es.close();
  }, []);
}

import { useEffect } from "react";
import { API_URL } from "../config";
import {
  ActivityEvent, ActivitySnapshot, GraphEdgeDTO, GraphNodeDTO, NeuronData, NotesView, Phase, PhasePayload,
} from "../types";
import { emitActivation, emitSpark, useBrainStore } from "../store/brainStore";
import { excite } from "../store/arousal";
import { actionColor, emitNotePulse, livePositions, useNotesStore } from "../store/notesStore";

/**
 * Query hits are neurons; the graph draws their notes where the D3 layout put
 * them. Point the query rays and labels at the note, not at the raw neuron.
 */
function notePositions(payload: PhasePayload): PhasePayload {
  const view = useNotesStore.getState().view;
  if (!view) return payload;
  const noteOf = new Map<string, string>();
  for (const n of view.notes) for (const nid of n.neuron_ids) noteOf.set(nid, n.id);
  const at = (id: string, fallback: [number, number, number]): [number, number, number] => {
    const noteId = noteOf.get(id);
    const p = noteId ? livePositions.get(noteId) : undefined;
    return p ? [p.x, p.y, p.z] : fallback;
  };
  return {
    ...payload,
    hits: payload.hits?.map((h) => ({ ...h, position: at(h.id, h.position) })),
    targets: payload.targets?.map((t) => ({ ...t, position: at(t.id, t.position) })),
  };
}

/** Connects to SSE, translates events into store actions, loads the graph. */
export function useBrainSocket() {
  useEffect(() => {
    const es = new EventSource(`${API_URL}/events/stream`);
    const get = useBrainStore.getState;

    const onPhase = (e: MessageEvent) => {
      const payload = notePositions(JSON.parse(e.data).payload as PhasePayload);
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
      // thinking lights the brain up: the question wakes it, the search sweeps
      // its memories, the notes that answer fire and stay lit for a while
      if (phase === "INPUT") excite(1);
      if (phase === "SEARCH") {
        (payload.targets ?? []).slice(0, 24).forEach((t) => emitSpark(t.position, 0.5, 0.7));
      }
      if (phase === "CONNECT") {
        const view = useNotesStore.getState().view;
        for (const h of payload.hits ?? []) {
          emitSpark(h.position, 1, 1.4);
          const note = view?.notes.find((n) => n.neuron_ids.includes(h.id));
          if (note) emitNotePulse(note.id, "#ffffff");
        }
      }
      get().setPhase(phase, payload);
      get().setStats({ phase });
    };

    const onNeuronActivated = (e: MessageEvent) => {
      const p = JSON.parse(e.data).payload as { id: string; amount: number };
      emitActivation(p.id, p.amount); // fast path, no react render
      excite(0.02);
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

    // notes change in bursts (one ingest = several neurons): refetch once
    let notesTimer: ReturnType<typeof setTimeout> | undefined;
    const onNotesChanged = () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(() => void loadNotes(), 300);
    };

    let activityTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleActivity = () => {
      if (activityTimer) return;
      activityTimer = setTimeout(() => { activityTimer = undefined; void loadActivity(); }, 400);
    };
    const onActivity = (e: MessageEvent) => {
      const item = JSON.parse(e.data).payload as ActivityEvent;
      useNotesStore.getState().pushActivity(item);
      // every action of an agent wakes the brain a little and fires the neurons
      // around the note it touched
      excite(item.event === "Stop" ? 0 : 0.15);
      if (item.note_id) {
        emitNotePulse(item.note_id, actionColor(item.action));
        const p = livePositions.get(item.note_id);
        if (p) emitSpark([p.x, p.y, p.z], 1, 1.5);
      }
      scheduleActivity();
    };

    es.addEventListener("phase", onPhase as EventListener);
    es.addEventListener("neuron_activated", onNeuronActivated as EventListener);
    es.addEventListener("neuron_added", onNeuronAdded as EventListener);
    es.addEventListener("edge_added", (() => {}) as EventListener); // reserved
    es.addEventListener("stats", onStats as EventListener);
    es.addEventListener("graph_reloaded", onGraphReloaded as EventListener);
    es.addEventListener("notes_changed", onNotesChanged as EventListener);
    es.addEventListener("activity", onActivity as EventListener);
    // EventSource reconnects on its own; after a lost connection (backend
    // restarted) the graph may have changed, so resync it once reopened.
    let connectionLost = false;
    es.onerror = () => {
      connectionLost = true;
      useNotesStore.getState().setConnected(false);
    };
    es.onopen = () => {
      useNotesStore.getState().setConnected(true);
      if (!connectionLost) return;
      connectionLost = false;
      void loadGraph();
      void loadNotes();
      void loadActivity();
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
    async function loadNotes() {
      try {
        const res = await fetch(`${API_URL}/notes`);
        useNotesStore.getState().setView(await res.json() as NotesView);
      } catch (err) {
        console.error("[brain] failed to load notes", err);
      }
    }

    async function loadActivity() {
      try {
        const res = await fetch(`${API_URL}/activity`);
        useNotesStore.getState().setActivity(await res.json() as ActivitySnapshot);
      } catch {
        // backend down: the SSE error handler already shows "sin conexión"
      }
    }

    void loadGraph();
    void loadNotes();
    void loadActivity();
    // statuses age ("en reposo", "hace 3 min") even without new events
    const poll = setInterval(() => void loadActivity(), 5000);

    return () => {
      es.close();
      clearInterval(poll);
      clearTimeout(notesTimer);
      clearTimeout(activityTimer);
    };
  }, []);
}

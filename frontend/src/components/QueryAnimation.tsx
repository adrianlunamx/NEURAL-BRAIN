import { useEffect } from "react";
import { QueryHit } from "../types";
import { emitActivation, useBrainStore } from "../store/brainStore";
import { neuralSim } from "../sim/neuralSim";

type V3 = [number, number, number];

/**
 * How the brain answers a question, drawn as neural traffic instead of
 * graphics: the words reach sensory cortex (INPUT, see useBrainSocket), the
 * hippocampus sends volleys along its projections to the stored memories
 * (SEARCH: reinstatement), the memories that answer excite one another
 * (CONNECT: association) and converge on the frontal lobe, which composes the
 * answer (SYNTHESIZE). Every volley is a real spike of the network
 * (sim/neuralSim.ts), so it lands and spreads like any other.
 * The "%" of each hit is drawn by FloatingLabels.
 */

/** SEARCH: hippocampus -> the memories being checked. */
function Reinstate({ targets }: { targets: { id: string; position: V3 }[] }) {
  useEffect(() => {
    targets.slice(0, 24).forEach((t, i) => {
      const to = neuralSim.nearest(t.position);
      for (let k = 0; k < 2; k++) neuralSim.project(neuralSim.randomIn("hippocampus"), to, i * 0.05 + k * 0.25);
    });
  }, [targets]);
  return null;
}

/** CONNECT: the hits fire and excite each other (association). */
function Associate({ hits }: { hits: QueryHit[] }) {
  useEffect(() => {
    hits.forEach((h) => emitActivation(h.id, 1));
    const idx = hits.slice(0, 8).map((h) => neuralSim.nearest(h.position));
    idx.forEach((a, i) => idx.forEach((b, j) => {
      if (i !== j && Math.random() < 0.5) neuralSim.project(a, b, 0.1 + Math.random() * 0.4);
    }));
  }, [hits]);
  return null;
}

/** SYNTHESIZE: the hits converge on the frontal lobe. */
function Converge({ hits }: { hits: QueryHit[] }) {
  useEffect(() => {
    hits.forEach((h) => emitActivation(h.id, 1));
    hits.slice(0, 10).forEach((h, i) => {
      const from = neuralSim.nearest(h.position);
      for (let k = 0; k < 3; k++) neuralSim.project(from, neuralSim.randomIn("frontal"), i * 0.04 + k * 0.2);
    });
  }, [hits]);
  return null;
}

export function QueryAnimation() {
  const phase = useBrainStore((s) => s.phase);
  const payload = useBrainStore((s) => s.phasePayload);
  if (!payload) return null;
  if (phase === "SEARCH") return <Reinstate targets={payload.targets ?? []} />;
  if (phase === "CONNECT") return <Associate hits={payload.hits ?? []} />;
  if (phase === "SYNTHESIZE") return <Converge hits={payload.hits ?? []} />;
  return null;
}

import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Html } from "@react-three/drei";
import * as THREE from "three";
import { actionColor, livePositions, useNotesStore } from "../store/notesStore";
import { AgentInfo, SessionInfo } from "../types";
import { BRAIN_CENTER, sdfBrain } from "../config/brainConfig";
import { clientInfo } from "./ui/common";
import { pills } from "./pillLayout";

/** Agents that acted within this window get a marker. */
const ACTIVE_SECONDS = 90;
const ARC_POINTS = 32;

const HUB_CENTER = new THREE.Vector3(...BRAIN_CENTER);
const HUB_MARGIN = 0.35;

/**
 * Where each session "sits": along the base of the brain, front to back,
 * alternating sides — always inside the volume (pulled toward the centre
 * until the brain SDF says it is at least HUB_MARGIN deep).
 */
function hubPosition(index: number): THREE.Vector3 {
  const p = new THREE.Vector3(2.6 - (index % 4) * 1.7, -1.1 + Math.floor(index / 4) * 1.0, index % 2 ? -1.1 : 1.1);
  for (let k = 0; k < 40 && sdfBrain([p.x, p.y, p.z]) > -HUB_MARGIN; k++) p.lerp(HUB_CENTER, 0.12);
  return p;
}

function hashIndex(key: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) h = Math.imul(h ^ key.charCodeAt(i), 16777619);
  return Math.abs(h) % Math.max(1, n);
}

/** Shared registry so "Seguir" can aim the camera at the busiest marker. */
export const markerPositions = new Map<string, THREE.Vector3>();

function AgentMarker({ session, agent, hub, now }: {
  session: SessionInfo; agent: AgentInfo; hub: THREE.Vector3; now: number;
}) {
  const view = useNotesStore((s) => s.view);
  const color = actionColor(agent.last_action);
  const group = useRef<THREE.Group>(null!);
  const pos = useRef<THREE.Vector3 | null>(null);
  const key = `${session.id}/${agent.key}`;

  const arc = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ARC_POINTS * 3), 3));
    return g;
  }, []);
  const arcMat = useMemo(() => new THREE.LineBasicMaterial({
    color, transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false,
  }), [color]);
  const line = useMemo(() => new THREE.Line(arc, arcMat), [arc, arcMat]);

  // target: the note it touched last, or a stable note of the session for agents without one
  const fallback = useMemo(() => {
    const notes = view?.notes ?? [];
    return notes.length ? notes[hashIndex(key, notes.length)].id : null;
  }, [view, key]);

  const ctrl = useMemo(() => new THREE.Vector3(), []);
  const p = useMemo(() => new THREE.Vector3(), []);
  const chip = useRef<HTMLDivElement>(null);
  const fresh = now - agent.last_at < 4;

  // the chip lives in drei's own <Html> root: register it (for PillDecollider)
  // from the frame loop once it exists, and drop it on unmount
  useEffect(() => () => { pills.delete(`agent:${key}`); }, [key]);

  useFrame((_, delta) => {
    const noteId = agent.last_note ?? fallback;
    const target = (noteId && livePositions.get(noteId)) || hub;
    if (!pos.current) pos.current = hub.clone();
    pos.current.lerp(target, 1 - Math.exp(-delta * 2.5));
    group.current.position.copy(pos.current);
    markerPositions.set(key, pos.current);
    const pill = pills.get(`agent:${key}`);
    if (pill) {
      pill.world.copy(pos.current);
      pill.priority = fresh ? 2 : 1;
    } else if (chip.current) {
      pills.set(`agent:${key}`, { el: chip.current, world: pos.current.clone(), priority: fresh ? 2 : 1, lift: 14 });
    }
    // arc from the session hub to the marker, lifted in the middle
    ctrl.copy(hub).add(pos.current).multiplyScalar(0.5);
    ctrl.y += 0.6 + hub.distanceTo(pos.current) * 0.15;
    const attr = arc.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < ARC_POINTS; i++) {
      const t = i / (ARC_POINTS - 1);
      const u = 1 - t;
      p.set(
        u * u * hub.x + 2 * u * t * ctrl.x + t * t * pos.current.x,
        u * u * hub.y + 2 * u * t * ctrl.y + t * t * pos.current.y,
        u * u * hub.z + 2 * u * t * ctrl.z + t * t * pos.current.z,
      );
      attr.setXYZ(i, p.x, p.y, p.z);
    }
    attr.needsUpdate = true;
  });

  const label = agent.num === 0 ? "principal" : `#${agent.num}`;
  return (
    <>
      <primitive object={line} />
      <group ref={group}>
        <mesh>
          <sphereGeometry args={[fresh ? 0.1 : 0.07, 16, 16]} />
          <meshBasicMaterial color={color} toneMapped={false} />
        </mesh>
        <Html center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
          <div ref={chip} className={`agent-pill${fresh ? " fresh" : ""}`} style={{ borderColor: color }}>
            <b>{label}</b> · <span style={{ color }}>{agent.last_action || "…"}</span>
          </div>
        </Html>
      </group>
    </>
  );
}

function HubChip({ id, hub, text, sub, color }: {
  id: string; hub: THREE.Vector3; text: string; sub: string; color: string;
}) {
  const chip = useRef<HTMLDivElement>(null);
  useEffect(() => () => { pills.delete(`hub:${id}`); }, [id]);
  useFrame(() => {
    const pill = pills.get(`hub:${id}`);
    if (pill) pill.world.copy(hub);
    else if (chip.current) pills.set(`hub:${id}`, { el: chip.current, world: hub.clone(), priority: 3, lift: 16 });
  });
  return (
    <Html center zIndexRange={[20, 10]} style={{ pointerEvents: "none" }}>
      <div ref={chip} className="hub-pill">
        {text} <span style={{ color }}>· {sub}</span>
      </div>
    </Html>
  );
}

/** Live coding agents (any client) travelling over the notes they read, search and edit. */
export function AgentMarkers() {
  const activity = useNotesStore((s) => s.activity);
  const mode = useNotesStore((s) => s.mode);
  if (!activity || mode === "lista") return null;
  const now = activity.now;
  const sessions = activity.sessions.filter((s) => s.status !== "en reposo" || now - s.last_at < ACTIVE_SECONDS);
  return (
    <group>
      {sessions.map((s, i) => {
        const hub = hubPosition(i);
        const agents = [s.main, ...s.agents].filter(
          // finished agents ("fin") leave the brain: fewer, more meaningful chips
          (a) => a.last_action && a.last_action !== "fin" && !a.done && now - a.last_at < ACTIVE_SECONDS,
        );
        return (
          <group key={s.id}>
            <group position={hub}>
              <mesh>
                <sphereGeometry args={[0.09, 20, 20]} />
                <meshBasicMaterial color="#ffd27a" toneMapped={false} />
              </mesh>
              <HubChip id={s.id} hub={hub} text={s.project}
                sub={clientInfo(s.client).label} color={clientInfo(s.client).color} />
            </group>
            {agents.map((a) => (
              <AgentMarker key={a.key} session={s} agent={a} hub={hub} now={now} />
            ))}
          </group>
        );
      })}
    </group>
  );
}

// D3 force layout of the notes inside the brain.
//
// Every note is a "neuron" pulled by its connections, pushed apart from the
// others, attracted to its group's anchor (so groups read as brain areas) and
// kept inside the brain volume with the same SDF the backend samples from.
import {
  forceCollide, forceLink, forceManyBody, forceSimulation, Force, SimNode,
} from "d3-force-3d";
import { sdfBrain } from "../config/brainConfig";
import { LinkType, NotesView } from "../types";

export type V3 = [number, number, number];

interface LayoutNode extends SimNode {
  id: string;
  group: string;
}

interface LayoutLink {
  source: string | LayoutNode;
  target: string | LayoutNode;
  type: LinkType;
}

/** How strongly each connection kind pulls its two notes together. */
const LINK_STRENGTH: Record<LinkType, number> = {
  wiki: 0.5, enlace: 0.45, responde: 0.35, mencion: 0.3, indice: 0.12,
  carpeta: 0.2, cadena: 0.12, comparte: 0.04, sugerida: 0.15, parecida: 0.4,
};

const INSIDE_MARGIN = 0.35;

/** Keeps every node inside the brain: pushes it back along the SDF gradient. */
function forceInsideBrain(): Force<LayoutNode> {
  let nodes: LayoutNode[] = [];
  const force: Force<LayoutNode> = () => {
    const e = 0.05;
    for (const n of nodes) {
      const p: V3 = [n.x ?? 0, n.y ?? 0, n.z ?? 0];
      const d = sdfBrain(p);
      if (d <= -INSIDE_MARGIN) continue;
      const gx = sdfBrain([p[0] + e, p[1], p[2]]) - sdfBrain([p[0] - e, p[1], p[2]]);
      const gy = sdfBrain([p[0], p[1] + e, p[2]]) - sdfBrain([p[0], p[1] - e, p[2]]);
      const gz = sdfBrain([p[0], p[1], p[2] + e]) - sdfBrain([p[0], p[1], p[2] - e]);
      const len = Math.hypot(gx, gy, gz) || 1;
      const push = d + INSIDE_MARGIN;
      n.x = p[0] - (gx / len) * push;
      n.y = p[1] - (gy / len) * push;
      n.z = p[2] - (gz / len) * push;
      n.vx = (n.vx ?? 0) * 0.5;
      n.vy = (n.vy ?? 0) * 0.5;
      n.vz = (n.vz ?? 0) * 0.5;
    }
  };
  force.initialize = (ns: LayoutNode[]) => { nodes = ns; };
  return force;
}

/** Pulls each node toward its group anchor. */
function forceGroups(anchors: Map<string, V3>, strength: number): Force<LayoutNode> {
  let nodes: LayoutNode[] = [];
  const force: Force<LayoutNode> = (alpha: number) => {
    for (const n of nodes) {
      const a = anchors.get(n.group);
      if (!a) continue;
      n.vx = (n.vx ?? 0) + (a[0] - (n.x ?? 0)) * strength * alpha;
      n.vy = (n.vy ?? 0) + (a[1] - (n.y ?? 0)) * strength * alpha;
      n.vz = (n.vz ?? 0) + (a[2] - (n.z ?? 0)) * strength * alpha;
    }
  };
  force.initialize = (ns: LayoutNode[]) => { nodes = ns; };
  return force;
}

/** Small deterministic PRNG so a given seed always gives the same layout. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Positions for every note. `previous` keeps notes that already had a place
 * where they were (new notes start at their group anchor), so live updates
 * don't reshuffle the whole brain. `seed` changes the layout (Reacomodar).
 */
export function layoutNotes(
  view: NotesView,
  previous: Map<string, V3> = new Map(),
  seed = 1,
  ticks = 220,
): Map<string, V3> {
  const rand = mulberry32(seed);
  const anchors = new Map<string, V3>(view.groups.map((g) => [g.name, g.anchor]));
  const jitter = () => (rand() - 0.5) * 1.2;
  const nodes: LayoutNode[] = view.notes.map((n) => {
    const start = previous.get(n.id) ?? anchors.get(n.group) ?? n.position;
    const fresh = !previous.has(n.id) || seed !== 1;
    return {
      id: n.id,
      group: n.group,
      x: start[0] + (fresh ? jitter() : 0),
      y: start[1] + (fresh ? jitter() : 0),
      z: start[2] + (fresh ? jitter() : 0),
    };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links: LayoutLink[] = view.links
    .filter((l) => ids.has(l.source) && ids.has(l.target))
    .map((l) => ({ source: l.source, target: l.target, type: l.type }));

  const sim = forceSimulation<LayoutNode>(nodes, 3)
    .force("link", forceLink<LayoutNode, LayoutLink>(links)
      .id((n) => n.id)
      .distance(0.9)
      .strength((l) => LINK_STRENGTH[l.type] ?? 0.1))
    .force("charge", forceManyBody<LayoutNode>().strength(-0.25).distanceMax(3))
    .force("collide", forceCollide<LayoutNode>().radius(0.2).strength(0.7))
    .force("groups", forceGroups(anchors, 0.12))
    .force("inside", forceInsideBrain())
    .alpha(previous.size && seed === 1 ? 0.35 : 1)
    .alphaDecay(0.03)
    .velocityDecay(0.35)
    .stop();
  sim.tick(ticks);

  const out = new Map<string, V3>();
  for (const n of nodes) out.set(n.id, [n.x ?? 0, n.y ?? 0, n.z ?? 0]);
  return out;
}

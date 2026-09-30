import { useEffect, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { livePositions, noteAwake, useNotesStore, visibleNotes } from "../store/notesStore";
import { arousal } from "../store/arousal";
import { useBrainStore } from "../store/brainStore";
import { LinkType, NoteLink } from "../types";

const SEGMENTS = 12;
/** Links bend toward this point, so they bundle through the middle of the brain. */
const BUNDLE_CENTER = new THREE.Vector3(0.5, 0.2, 0);

/** Base opacity and stroke of each connection kind (0 solid, 1 dashed, 2 dotted). */
export const LINK_STYLE: Record<LinkType, { alpha: number; stroke: 0 | 1 | 2 }> = {
  wiki: { alpha: 0.6, stroke: 0 },
  indice: { alpha: 0.32, stroke: 0 },
  enlace: { alpha: 0.5, stroke: 0 },
  responde: { alpha: 0.6, stroke: 0 },
  mencion: { alpha: 0.38, stroke: 0 },
  carpeta: { alpha: 0.28, stroke: 0 },
  cadena: { alpha: 0.24, stroke: 0 },
  sugerida: { alpha: 0.4, stroke: 1 },
  parecida: { alpha: 0.5, stroke: 2 },
  comparte: { alpha: 0.2, stroke: 0 },
};

const vertex = /* glsl */ `
  attribute vec3 color;
  attribute float t;
  attribute float dist;
  attribute float alpha;
  attribute float stroke;
  attribute float seed;
  attribute float wake;
  uniform float uArousal;
  varying vec3 vColor;
  varying float vT;
  varying float vDist;
  varying float vAlpha;
  varying float vStroke;
  varying float vSeed;
  void main() {
    vColor = color; vT = t; vDist = dist; vStroke = stroke; vSeed = seed;
    // dim at rest; a connection lights up when one of its notes is in use
    vAlpha = alpha * mix(0.1, 1.0, max(wake, uArousal * 0.7));
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragment = /* glsl */ `
  uniform float uTime;
  uniform float uAnim;
  varying vec3 vColor;
  varying float vT;
  varying float vDist;
  varying float vAlpha;
  varying float vStroke;
  varying float vSeed;
  void main() {
    if (vStroke > 0.5 && vStroke < 1.5 && fract(vDist * 4.0) > 0.55) discard;   // dashed
    if (vStroke > 1.5 && fract(vDist * 9.0) > 0.3) discard;                     // dotted
    float wave = fract(vT - uTime * 0.35 + vSeed);
    float pulse = pow(smoothstep(0.0, 0.12, wave) * (1.0 - smoothstep(0.12, 0.3, wave)), 1.5);
    float a = min(1.0, vAlpha * 1.6 * (0.6 + 1.2 * pulse * uAnim));
    gl_FragColor = vec4(vColor * a, a);
  }
`;

/** Every connection between notes as a curved, glowing line (one draw call). */
export function LinksLayer() {
  const view = useNotesStore((s) => s.view);
  const hiddenGroups = useNotesStore((s) => s.hiddenGroups);
  const hiddenTypes = useNotesStore((s) => s.hiddenTypes);
  const hiddenLinks = useNotesStore((s) => s.hiddenLinks);
  const hovered = useNotesStore((s) => s.hovered);
  const selected = useNotesStore((s) => s.selected);
  const colorBy = useNotesStore((s) => s.colorBy);
  const anim = useBrainStore((s) => s.settings.anim);

  const links: NoteLink[] = useMemo(() => {
    if (!view) return [];
    const ids = new Set(visibleNotes({ view, hiddenGroups, hiddenTypes }).map((n) => n.id));
    return view.links.filter((l) => !hiddenLinks.has(l.type) && ids.has(l.source) && ids.has(l.target));
  }, [view, hiddenGroups, hiddenTypes, hiddenLinks]);

  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: vertex,
    fragmentShader: fragment,
    uniforms: { uTime: { value: 0 }, uAnim: { value: 1 }, uArousal: { value: 0 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }), []);

  const geometry = useMemo(() => {
    const verts = links.length * SEGMENTS * 2;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute("color", new THREE.BufferAttribute(new Float32Array(verts * 3), 3));
    g.setAttribute("t", new THREE.BufferAttribute(new Float32Array(verts), 1));
    g.setAttribute("dist", new THREE.BufferAttribute(new Float32Array(verts), 1));
    g.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(verts), 1));
    g.setAttribute("stroke", new THREE.BufferAttribute(new Float32Array(verts), 1));
    g.setAttribute("seed", new THREE.BufferAttribute(new Float32Array(verts), 1));
    g.setAttribute("wake", new THREE.BufferAttribute(new Float32Array(verts), 1));
    return g;
  }, [links]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  // colour / opacity / stroke per vertex (focus: links of the hovered or selected note)
  useEffect(() => {
    if (!view) return;
    const groupOf = new Map(view.notes.map((n) => [n.id, n.group]));
    const colorOf = new Map(view.groups.map((g) => [g.name, new THREE.Color(g.color)]));
    const white = new THREE.Color("#cfe3ff");
    const focus = hovered ?? selected;
    const col = geometry.getAttribute("color") as THREE.BufferAttribute;
    const al = geometry.getAttribute("alpha") as THREE.BufferAttribute;
    const st = geometry.getAttribute("stroke") as THREE.BufferAttribute;
    const sd = geometry.getAttribute("seed") as THREE.BufferAttribute;
    const a = new THREE.Color();
    const b = new THREE.Color();
    links.forEach((l, li) => {
      const style = LINK_STYLE[l.type];
      a.copy(colorBy === "uso" ? white : colorOf.get(groupOf.get(l.source) ?? "") ?? white);
      b.copy(colorBy === "uso" ? white : colorOf.get(groupOf.get(l.target) ?? "") ?? white);
      let alpha = style.alpha;
      if (focus) alpha = l.source === focus || l.target === focus ? Math.min(1, alpha * 2.4) : alpha * 0.25;
      const seed = (li * 0.61803398875) % 1;
      for (let s = 0; s < SEGMENTS * 2; s++) {
        const v = li * SEGMENTS * 2 + s;
        const t = (Math.floor(s / 2) + (s % 2)) / SEGMENTS;
        const c = a.clone().lerp(b, t);
        col.setXYZ(v, c.r, c.g, c.b);
        al.setX(v, alpha);
        st.setX(v, style.stroke);
        sd.setX(v, seed);
      }
    });
    col.needsUpdate = al.needsUpdate = st.needsUpdate = sd.needsUpdate = true;
  }, [geometry, links, view, hovered, selected, colorBy]);

  const pa = useMemo(() => new THREE.Vector3(), []);
  const pb = useMemo(() => new THREE.Vector3(), []);
  const ctrl = useMemo(() => new THREE.Vector3(), []);
  const pt = useMemo(() => new THREE.Vector3(), []);

  useFrame(({ clock }) => {
    material.uniforms.uTime.value = clock.elapsedTime;
    material.uniforms.uAnim.value = anim ? 1 : 0;
    material.uniforms.uArousal.value = arousal.level;
    const { hovered: hov, selected: sel } = useNotesStore.getState();
    const wk = geometry.getAttribute("wake") as THREE.BufferAttribute;
    const pos = geometry.getAttribute("position") as THREE.BufferAttribute;
    const tt = geometry.getAttribute("t") as THREE.BufferAttribute;
    const dd = geometry.getAttribute("dist") as THREE.BufferAttribute;
    links.forEach((l, li) => {
      const a = livePositions.get(l.source);
      const b = livePositions.get(l.target);
      if (!a || !b) return;
      pa.copy(a);
      pb.copy(b);
      const chord = pa.distanceTo(pb);
      const focused = l.source === hov || l.target === hov || l.source === sel || l.target === sel;
      const wake = focused ? 1 : Math.max(noteAwake.get(l.source) ?? 0, noteAwake.get(l.target) ?? 0);
      // quadratic Bézier bent toward the centre: long links bundle through the middle
      ctrl.copy(pa).add(pb).multiplyScalar(0.5);
      ctrl.lerp(BUNDLE_CENTER, Math.min(0.45, chord * 0.1));
      for (let s = 0; s < SEGMENTS * 2; s++) {
        const t = (Math.floor(s / 2) + (s % 2)) / SEGMENTS;
        const u = 1 - t;
        pt.set(
          u * u * pa.x + 2 * u * t * ctrl.x + t * t * pb.x,
          u * u * pa.y + 2 * u * t * ctrl.y + t * t * pb.y,
          u * u * pa.z + 2 * u * t * ctrl.z + t * t * pb.z,
        );
        const v = li * SEGMENTS * 2 + s;
        pos.setXYZ(v, pt.x, pt.y, pt.z);
        tt.setX(v, t);
        dd.setX(v, t * chord);
        wk.setX(v, wake);
      }
    });
    pos.needsUpdate = tt.needsUpdate = dd.needsUpdate = wk.needsUpdate = true;
  });

  return <lineSegments geometry={geometry} material={material} frustumCulled={false} />;
}

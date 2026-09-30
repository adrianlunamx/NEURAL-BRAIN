import { LinkType, NoteType } from "../../types";
import { LINK_STYLE } from "../LinksLayer";
import { TYPE_SHAPE } from "../FireflyNotes";

export const TYPE_LABELS: Record<NoteType, string> = {
  instrucciones: "Instrucciones", indice: "Índice", usuario: "Usuario", feedback: "Feedback",
  proyecto: "Proyecto", referencia: "Referencia", documento: "Documento", handoff: "Handoff",
};

export const LINK_LABELS: Record<LinkType, string> = {
  wiki: "Wiki [[…]]", indice: "Índice", enlace: "Enlace", responde: "Responde", mencion: "Mención",
  carpeta: "Carpeta", cadena: "Cadena", sugerida: "Sugerida", parecida: "Parecida", comparte: "Comparte",
};

export const PROBLEM_LABELS: Record<string, string> = {
  enlace_roto: "Enlace roto", huerfana: "Sin conexiones", duplicado: "Posible duplicado",
};

/** Glyph of each note type for the 2D legend (in 3D every note is a firefly; the type sets its size). */
export function TypeIcon({ type, color = "currentColor", size = 12 }: { type: NoteType; color?: string; size?: number }) {
  const shape = TYPE_SHAPE[type];
  return (
    <svg width={size} height={size} viewBox="0 0 12 12" aria-hidden>
      {shape === 0 && <path d="M6 1.5 L10.8 10 H1.2 Z" fill={color} />}
      {shape === 1 && <path d="M6 1 L11 6 L6 11 L1 6 Z" fill={color} />}
      {shape === 2 && <circle cx="6" cy="6" r="4" fill={color} />}
      {shape === 3 && <path d="M6 10.5 L10.8 2 H1.2 Z" fill={color} />}
      {shape === 4 && <rect x="2.2" y="2.2" width="7.6" height="7.6" fill={color} />}
      {shape === 5 && <circle cx="6" cy="6" r="2.2" fill={color} />}
    </svg>
  );
}

/** Line sample for a connection kind (solid, dashed, dotted). */
export function LinkSample({ type }: { type: LinkType }) {
  const stroke = LINK_STYLE[type].stroke;
  return (
    <svg width="22" height="8" viewBox="0 0 22 8" aria-hidden>
      <line x1="1" y1="4" x2="21" y2="4" stroke="currentColor" strokeWidth={type === "wiki" ? 2 : 1.3}
        strokeDasharray={stroke === 1 ? "4 3" : stroke === 2 ? "1 3" : undefined} strokeLinecap="round" />
    </svg>
  );
}

export function ago(ts: number, now: number): string {
  const s = Math.max(0, now - ts);
  if (s < 60) return "ahora";
  if (s < 3600) return `hace ${Math.floor(s / 60)} min`;
  return `hace ${Math.floor(s / 3600)} h`;
}

export function basename(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] || path;
}

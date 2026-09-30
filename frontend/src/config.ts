export const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ??
  "http://localhost:8000";

export const LOD_THRESHOLDS = [
  { maxDistance: 12, count: 19000 },  // ultra
  { maxDistance: 18, count: 12000 },  // high
  { maxDistance: 26, count: 5000 },   // medium
  { maxDistance: Infinity, count: 1000 }, // low
] as const;

/** Bundled font for 3D labels (drei Text would otherwise download one from a CDN). */
export const FONT_URL = "/fonts/inter-600.woff";

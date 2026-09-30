export const API_URL =
  (import.meta as unknown as { env: Record<string, string> }).env.VITE_API_URL ??
  "http://localhost:8000";


/** Bundled font for 3D labels (drei Text would otherwise download one from a CDN). */
export const FONT_URL = "/fonts/inter-600.woff";

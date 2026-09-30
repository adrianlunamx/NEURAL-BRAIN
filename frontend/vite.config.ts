import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // three + drei + postprocessing make one large chunk; that's expected for a 3D app
  build: { chunkSizeWarningLimit: 2500 },
  server: {
    port: 5173,
    proxy: {
      // optional: same-origin API during dev
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});

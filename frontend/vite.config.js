import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const backend = env.VITE_BACKEND_URL || 'http://localhost:8000'
  return {
    plugins: [react()],
    server: {
      port: 5173,
      host: true,
      // The browser talks to /api on the Vite origin; Vite forwards it to FastAPI.
      proxy: { '/api': { target: backend, changeOrigin: true } },
    },
    build: {
      chunkSizeWarningLimit: 2000,
    },
  }
})

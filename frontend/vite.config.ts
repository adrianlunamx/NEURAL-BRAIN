import { createHash, timingSafeEqual } from "node:crypto";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

/** HTTP Basic auth for the whole dev server (UI + /api proxy + SSE), on when
 *  BRAIN_PASSWORD is set: for sharing the brain beyond this machine, e.g. with
 *  `tailscale funnel 5173` and VITE_API_URL=/api. The user name is ignored. */
function basicAuth(password: string): Plugin {
  const digest = (s: string) => createHash("sha256").update(s).digest();
  const expected = digest(password);
  return {
    name: "neural-brain-basic-auth",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const header = req.headers.authorization ?? "";
        const given = header.startsWith("Basic ")
          ? Buffer.from(header.slice(6), "base64").toString().split(":").slice(1).join(":")
          : "";
        if (given && timingSafeEqual(digest(given), expected)) return next();
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="Neural Brain", charset="UTF-8"');
        res.end("password required");
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react(), ...(env.BRAIN_PASSWORD ? [basicAuth(env.BRAIN_PASSWORD)] : [])],
    // three + drei + postprocessing make one large chunk; that's expected for a 3D app
    build: { chunkSizeWarningLimit: 2500 },
    server: {
      port: 5173,
      // "localhost" is ::1 only on Windows; proxies such as tailscale serve/funnel dial 127.0.0.1
      host: "127.0.0.1",
      // Tailscale Serve / Funnel hostnames (Vite rejects unknown Host headers)
      allowedHosts: [".ts.net"],
      proxy: {
        // same-origin API: set VITE_API_URL=/api to reach the brain through this port only
        "/api": {
          target: "http://127.0.0.1:8000",
          changeOrigin: true,
          rewrite: (p) => p.replace(/^\/api/, ""),
        },
      },
    },
  };
});

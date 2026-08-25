import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // "." rather than process.cwd(), so this config needs no Node type definitions.
  const env = loadEnv(mode, ".", "");
  // Where the dev server forwards /api. Override in .env.local if port 8000 is
  // taken: VITE_API_PROXY=http://127.0.0.1:8001
  const target = env.VITE_API_PROXY || "http://127.0.0.1:8000";

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: 5173,
      proxy: {
        // In dev the API is a separate process; proxying keeps the browser on
        // one origin so cookies, CORS and the WebSocket all behave like
        // production.
        "/api": {
          target,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});

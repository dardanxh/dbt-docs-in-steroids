import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

export default defineConfig(({ mode }) => {
  // Dev-server API proxy target. Defaults to the local backend; override with
  // VITE_API_PROXY to hit a deployed environment.
  const { VITE_API_PROXY } = loadEnv(mode, process.cwd(), "");
  const apiProxyTarget = VITE_API_PROXY || "http://localhost:8000";

  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": path.resolve(__dirname, "./src") },
    },
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiProxyTarget, changeOrigin: true },
      },
    },
  };
});

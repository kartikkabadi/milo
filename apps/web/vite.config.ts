import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwind()],
  server: {
    port: 5273,
    proxy: {
      // The Worker owns /agents/* and /api/*. Proxying in dev means the GUI
      // talks to the same origin in development and production, so there is no
      // second code path to keep correct.
      "/agents": { target: "http://127.0.0.1:8787", ws: true, changeOrigin: true },
      "/api": { target: "http://127.0.0.1:8787", changeOrigin: true },
    },
  },
  build: {
    target: "es2022",
    sourcemap: true,
  },
});

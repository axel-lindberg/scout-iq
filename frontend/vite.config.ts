/// <reference types="vitest/config" />
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The FastAPI backend (python scripts/serve.py). 127.0.0.1 rather than "localhost": Node may
// resolve localhost to IPv6 (::1) first, but uvicorn only listens on IPv4.
const BACKEND = process.env.SCOUT_IQ_BACKEND ?? "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    strictPort: true,
    // Same-origin in the browser: requests go to :5173/api and Vite forwards them, so no CORS.
    proxy: { "/api": { target: BACKEND, changeOrigin: true } },
  },
  build: { outDir: "dist", emptyOutDir: true, sourcemap: true },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
    unstubGlobals: true,
  },
});

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const backend = process.env.STTV_BACKEND_URL ?? "http://127.0.0.1:4321";
const proxied = ["/api", "/media", "/stream", "/subtitles", "/receiver", "/assets"];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: "./",
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      ...Object.fromEntries(proxied.map((prefix) => [prefix, { target: backend, changeOrigin: false }])),
      "/ws": { target: backend.replace(/^http/, "ws"), ws: true }
    }
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022"
  },
  test: {
    environment: "jsdom",
    env: { VITE_API_BASE_URL: "http://localhost:3000" },
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/main.tsx", "src/test/**", "src/**/*.test.{ts,tsx}", "src/vite-env.d.ts"],
      reporter: ["text", "json-summary"],
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 }
    }
  }
});

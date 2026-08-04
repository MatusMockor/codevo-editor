import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error the perf autorun relay is a plain .mjs script module
import { createPerfAutorunVitePlugin } from "./scripts/perf/perfAutorunVitePlugin.mjs";

// @ts-expect-error process is a nodejs global
const environment = process.env;
const host = environment.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), createPerfAutorunVitePlugin({ env: environment })],
  base: "./",

  test: {
    execArgv: [
      "--max-old-space-size=6144",
      ...(process.allowedNodeEnvironmentFlags.has("--no-experimental-webstorage")
        ? ["--no-experimental-webstorage"]
        : []),
    ],
    setupFiles: ["./src/test/setup.ts"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },
}));

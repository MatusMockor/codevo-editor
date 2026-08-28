import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
// @ts-expect-error the perf autorun relay is a plain .mjs script module
import { createPerfAutorunVitePlugin } from "./scripts/perf/perfAutorunVitePlugin.mjs";
// @ts-expect-error the production perf capture plugin is a plain .mjs script module
import {
  createPerfProductionCaptureArtifactGuard,
  createPerfProductionCaptureVitePlugin,
} from "./scripts/perf/perfProductionCaptureVitePlugin.mjs";
// @ts-expect-error the Vite environment policy is a plain .mjs script module
import { perfViteEnvironment } from "./scripts/perf/perfViteEnvironment.mjs";

// https://vite.dev/config/
export default defineConfig(async ({ mode }) => {
  // @ts-expect-error process is a nodejs global
  const environment = perfViteEnvironment({
    modeEnvironment: loadEnv(mode, process.cwd(), ""),
    processEnvironment: process.env,
  });
  const ordinaryEnvironment = environment.ordinaryEnvironment;
  const trustedPerfEnvironment = environment.trustedPerfEnvironment;
  const host = ordinaryEnvironment.TAURI_DEV_HOST;

  return {
    plugins: [
      react(),
      createPerfAutorunVitePlugin({ env: trustedPerfEnvironment }),
      createPerfProductionCaptureVitePlugin({ env: trustedPerfEnvironment }),
      createPerfProductionCaptureArtifactGuard({
        captureEnabled: environment.productionCaptureEnabled,
      }),
    ],
    define: {
      ...environment.clientDefines,
      __CODEVO_PERF_AUTORUN_BAKED__: JSON.stringify(environment.autorunBaked),
      __CODEVO_PERF_CAPTURE_RUN_TOKEN__: JSON.stringify(environment.productionCaptureRunToken),
    },
    // Vite's implicit mode-file loading cannot express a deny-list. We load it
    // above, preserve ordinary VITE_* values explicitly, and keep QA/perf
    // authority process-only before it can reach import.meta.env or HTML.
    envDir: false,
    base: "./",

    build: {
      rolldownOptions: {
        preserveEntrySignatures: "allow-extension",
        output: {
          strictExecutionOrder: true,
          codeSplitting: {
            includeDependenciesRecursively: false,
            groups: [
              {
                entriesAware: true,
                maxSize: 450 * 1024,
                name: "vendor",
                test: /node_modules/,
              },
              {
                entriesAware: true,
                maxSize: 450 * 1024,
                name: "app",
                test: /\/src\//,
              },
            ],
          },
        },
      },
    },

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
  };
});

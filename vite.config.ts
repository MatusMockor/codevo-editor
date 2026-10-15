import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { configDefaults } from "vitest/config";
import react from "@vitejs/plugin-react";

// https://vite.dev/config/
export default defineConfig(() => {
  const host = process.env.TAURI_DEV_HOST;

  return {
    resolve: {
      alias: {
        "@codevo/agent-events": fileURLToPath(
          new URL("./packages/agent-events/src/index.ts", import.meta.url),
        ),
      },
    },
    plugins: [react()],
    base: "./",
    worker: { format: "es" },

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
      // Native integration tests create temporary JS projects below Cargo's target directory.
      exclude: [...configDefaults.exclude, "src-tauri/target/**"],
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

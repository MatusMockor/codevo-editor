import path from "node:path";
import { buildAutorunRunnerModule } from "./perfAutorunRelay.mjs";
import { buildRunnerOptions } from "./runPerfScenariosCli.mjs";

export const PERF_PRODUCTION_CAPTURE_MODULE_ID = "virtual:codevo-perf-production-runner";
export const PERF_PRODUCTION_CAPTURE_FLAG_ENV = "VITE_CODEVO_PERF_PRODUCTION_CAPTURE";
export const PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV = "CODEVO_PERF_CAPTURE_RUN_TOKEN";
export const PERF_PRODUCTION_CAPTURE_SMOKE_ENV = "CODEVO_PERF_CAPTURE_SMOKE";
export const PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV = "CODEVO_PERF_CAPTURE_WORK_ROOT";

const RESOLVED_MODULE_ID = `\0${PERF_PRODUCTION_CAPTURE_MODULE_ID}`;
const PLUGIN_NAME = "codevo-perf-production-capture";
const ARTIFACT_GUARD_PLUGIN_NAME = "codevo-perf-production-capture-artifact-guard";
export const PERF_PRODUCTION_CAPTURE_ARTIFACT_MARKERS = Object.freeze([
  "perf_capture_prepare_fixture_trust",
  "perf_capture_submit",
  "perf_capture_activate_window",
  "Perf production capture native window",
]);

export function createPerfProductionCaptureVitePlugin({ env }) {
  const capture = productionCaptureConfiguration(env);

  return {
    name: PLUGIN_NAME,
    resolveId(id) {
      return id === PERF_PRODUCTION_CAPTURE_MODULE_ID ? RESOLVED_MODULE_ID : null;
    },
    load(id) {
      if (id !== RESOLVED_MODULE_ID) {
        return null;
      }

      if (capture === null) {
        return disabledRunnerModule();
      }

      return buildAutorunRunnerModule(
        buildRunnerOptions({ smoke: capture.smoke, repoRoot: capture.workRoot }),
        capture.runToken,
      );
    },
  };
}

export function createPerfProductionCaptureArtifactGuard({ captureEnabled }) {
  return {
    name: ARTIFACT_GUARD_PLUGIN_NAME,
    apply: "build",
    enforce: "post",
    generateBundle(_options, bundle) {
      if (captureEnabled) {
        return;
      }

      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") {
          continue;
        }

        const marker = PERF_PRODUCTION_CAPTURE_ARTIFACT_MARKERS.find((candidate) =>
          output.code.includes(candidate),
        );
        if (marker) {
          this.error(
            `Ordinary production chunk ${output.fileName} retained disabled performance-capture code (${marker}).`,
          );
        }
      }
    },
  };
}

export function productionCaptureConfiguration(env) {
  if (env[PERF_PRODUCTION_CAPTURE_FLAG_ENV] !== "1") {
    return null;
  }

  const runToken = requiredNonemptyEnvironmentValue(env, PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV);
  const workRoot = requiredNonemptyEnvironmentValue(env, PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV);
  const smokeValue = requiredNonemptyEnvironmentValue(env, PERF_PRODUCTION_CAPTURE_SMOKE_ENV);

  if (!/^[!-~]{32,256}$/.test(runToken)) {
    throw new Error(
      `${PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV} must contain 32-256 printable ASCII characters.`,
    );
  }

  if (!path.isAbsolute(workRoot)) {
    throw new Error(`${PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV} must be an absolute path.`);
  }

  if (smokeValue !== "0" && smokeValue !== "1") {
    throw new Error(`${PERF_PRODUCTION_CAPTURE_SMOKE_ENV} must be exactly "0" or "1".`);
  }

  return Object.freeze({ runToken, workRoot, smoke: smokeValue === "1" });
}

function requiredNonemptyEnvironmentValue(env, name) {
  const value = env[name];

  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required for a production performance capture build.`);
  }

  return value;
}

function disabledRunnerModule() {
  return [
    "export const perfAutorunOptions = undefined;",
    'export const perfAutorunRunToken = "";',
    'export default async function disabledPerfProductionCapture() { throw new Error("Production performance capture is not enabled in this build."); }',
    "",
  ].join("\n");
}

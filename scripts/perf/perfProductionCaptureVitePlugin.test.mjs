import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  PERF_PRODUCTION_CAPTURE_FLAG_ENV,
  PERF_PRODUCTION_CAPTURE_MODULE_ID,
  PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV,
  PERF_PRODUCTION_CAPTURE_SMOKE_ENV,
  PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV,
  createPerfProductionCaptureArtifactGuard,
  createPerfProductionCaptureVitePlugin,
  productionCaptureConfiguration,
} from "./perfProductionCaptureVitePlugin.mjs";

const WORK_ROOT = path.join(path.sep, "private", "tmp", "codevo-perf-snapshot");

function captureEnvironment(extra = {}) {
  return {
    [PERF_PRODUCTION_CAPTURE_FLAG_ENV]: "1",
    [PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV]: "0123456789abcdef0123456789abcdef",
    [PERF_PRODUCTION_CAPTURE_SMOKE_ENV]: "0",
    [PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV]: WORK_ROOT,
    ...extra,
  };
}

function loadVirtualModule(env) {
  const plugin = createPerfProductionCaptureVitePlugin({ env });
  const resolved = plugin.resolveId(PERF_PRODUCTION_CAPTURE_MODULE_ID);

  return { plugin, source: plugin.load(resolved) };
}

describe("productionCaptureConfiguration", () => {
  it("is disabled unless the exact production capture flag is set", () => {
    expect(productionCaptureConfiguration({})).toBeNull();
    expect(
      productionCaptureConfiguration({ [PERF_PRODUCTION_CAPTURE_FLAG_ENV]: "true" }),
    ).toBeNull();
  });

  it("parses one closed capture configuration", () => {
    expect(productionCaptureConfiguration(captureEnvironment())).toEqual({
      runToken: "0123456789abcdef0123456789abcdef",
      smoke: false,
      workRoot: WORK_ROOT,
    });
    expect(
      productionCaptureConfiguration(
        captureEnvironment({ [PERF_PRODUCTION_CAPTURE_SMOKE_ENV]: "1" }),
      )?.smoke,
    ).toBe(true);
  });

  it("fails the build when an armed capture is incomplete or malformed", () => {
    for (const name of [
      PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV,
      PERF_PRODUCTION_CAPTURE_SMOKE_ENV,
      PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV,
    ]) {
      const env = captureEnvironment();
      delete env[name];
      expect(() => productionCaptureConfiguration(env)).toThrow(name);
    }

    expect(() =>
      productionCaptureConfiguration(
        captureEnvironment({ [PERF_PRODUCTION_CAPTURE_WORK_ROOT_ENV]: "relative/worktree" }),
      ),
    ).toThrow(/absolute/);
    expect(() =>
      productionCaptureConfiguration(
        captureEnvironment({ [PERF_PRODUCTION_CAPTURE_SMOKE_ENV]: "yes" }),
      ),
    ).toThrow(/exactly/);
    expect(() =>
      productionCaptureConfiguration(
        captureEnvironment({ [PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV]: "too-short" }),
      ),
    ).toThrow(/32-256/);
    expect(() =>
      productionCaptureConfiguration(
        captureEnvironment({
          [PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV]: "0123456789abcdef 123456789abcdef",
        }),
      ),
    ).toThrow(/printable ASCII/);
  });

  it("fails closed when a mode-file flag is merged without its capture credentials", () => {
    const modeEnvironment = { [PERF_PRODUCTION_CAPTURE_FLAG_ENV]: "1" };
    const processEnvironment = {};
    const authoritativeEnvironment = { ...modeEnvironment, ...processEnvironment };

    expect(() => createPerfProductionCaptureVitePlugin({ env: authoritativeEnvironment })).toThrow(
      PERF_PRODUCTION_CAPTURE_RUN_TOKEN_ENV,
    );
  });
});

describe("createPerfProductionCaptureVitePlugin", () => {
  it("owns only its exact virtual module id", () => {
    const { plugin } = loadVirtualModule({});

    expect(plugin.resolveId(PERF_PRODUCTION_CAPTURE_MODULE_ID)).toBe(
      `\0${PERF_PRODUCTION_CAPTURE_MODULE_ID}`,
    );
    expect(plugin.resolveId(`${PERF_PRODUCTION_CAPTURE_MODULE_ID}/nested`)).toBeNull();
    expect(plugin.load("\0another-module")).toBeNull();
  });

  it("keeps a normal production build free of runner source, paths, and tokens", () => {
    const { source } = loadVirtualModule({});

    expect(source).toContain("Production performance capture is not enabled");
    expect(source).not.toContain("runCodevoPerfScenarios");
    expect(source).not.toContain("0123456789abcdef0123456789abcdef");
    expect(source).not.toContain("perf/fixtures");
  });

  it("bundles the shared runner with exact snapshot options only for an armed capture", () => {
    const { source } = loadVirtualModule(
      captureEnvironment({ [PERF_PRODUCTION_CAPTURE_SMOKE_ENV]: "1" }),
    );

    expect(source).toContain("async function runCodevoPerfScenarios(options)");
    expect(source).toContain(
      'export const perfAutorunRunToken = "0123456789abcdef0123456789abcdef"',
    );
    expect(source).toContain(path.join(WORK_ROOT, "perf/fixtures/large-files"));
    expect(source).toContain('"smoke":true');
    expect(source).not.toContain("eval(");
    expect(source).not.toContain("new Function");
  });
});

describe("createPerfProductionCaptureArtifactGuard", () => {
  it("fails an ordinary build that retains production capture orchestration", () => {
    const plugin = createPerfProductionCaptureArtifactGuard({ captureEnabled: false });
    const error = (message) => {
      throw new Error(message);
    };

    expect(() =>
      plugin.generateBundle.call(
        { error },
        {},
        {
          "assets/app.js": {
            type: "chunk",
            fileName: "assets/app.js",
            code: 'invoke("perf_capture_submit")',
          },
        },
      ),
    ).toThrow(/retained disabled performance-capture code/);
  });

  it("accepts an ordinary artifact without capture code and an explicitly armed artifact", () => {
    const error = (message) => {
      throw new Error(message);
    };
    const cleanBundle = {
      "assets/app.js": { type: "chunk", fileName: "assets/app.js", code: "ordinaryEditor();" },
    };
    const armedBundle = {
      "assets/app.js": {
        type: "chunk",
        fileName: "assets/app.js",
        code: 'invoke("perf_capture_submit")',
      },
    };

    expect(() =>
      createPerfProductionCaptureArtifactGuard({ captureEnabled: false }).generateBundle.call(
        { error },
        {},
        cleanBundle,
      ),
    ).not.toThrow();
    expect(() =>
      createPerfProductionCaptureArtifactGuard({ captureEnabled: true }).generateBundle.call(
        { error },
        {},
        armedBundle,
      ),
    ).not.toThrow();
  });
});

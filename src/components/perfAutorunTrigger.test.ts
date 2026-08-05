// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_AUTORUN_PATHS } from "./perfAutorunEndpoints";
import {
  assertStableMeasurementWindow,
  installMeasurementWindowGuard,
  perfAutorunEnabled,
  perfAutorunRunnerModulePath,
  postAutorunPayload,
  runPerfAutorun,
  type PerfAutorunRunnerModule,
  type PerfAutorunWindowControl,
} from "./perfAutorunTrigger";

interface PostedPayload {
  readonly path: string;
  readonly body: string;
  readonly token: string;
}

const NATIVE_WINDOW_READY = Object.freeze({
  active: true,
  appActivationTransitions: 0,
  diagnosticSpaceLease: true,
  hidden: false,
  key: true,
  keyTransitions: 0,
  leaseId: "lease-1",
  minimized: false,
  minimizeTransitions: 0,
  occluded: false,
  occlusionTransitions: 0,
  occlusionVisible: true,
  onActiveSpace: true,
  transitionOverflow: false,
  visible: true,
  windowStabilityEpoch: 0,
});
const NATIVE_FOCUS_READY = Object.freeze({
  ...NATIVE_WINDOW_READY,
  diagnosticSpaceLease: false,
});

function runnerModule(
  run: (options: unknown) => Promise<unknown>,
  options: unknown = { smoke: true },
  token = "run-token",
): PerfAutorunRunnerModule {
  return { perfAutorunOptions: options, perfAutorunRunToken: token, default: run };
}

function fakeClock() {
  let current = 0;

  return {
    now: () => current,
    sleep: (ms: number) => {
      current += ms;

      return Promise.resolve();
    },
    activateProductionCaptureWindow: () => Promise.resolve(NATIVE_WINDOW_READY),
    prepareProductionCaptureFixtures: () => Promise.resolve(),
    releaseDiagnosticProductionCaptureWindow: () =>
      Promise.resolve({ ...NATIVE_WINDOW_READY, diagnosticSpaceLease: false }),
    resetProductionCaptureWindowLeaseBaseline: () => Promise.resolve(NATIVE_WINDOW_READY),
    snapshotProductionCaptureWindowLease: () => Promise.resolve(NATIVE_WINDOW_READY),
    windowMode: "focus-only" as const,
    preflightMeasurementWindow: () => Promise.resolve(),
    installMeasurementWindowGuard: () => ({ failure: () => null, dispose: () => {} }),
  };
}

function collectPosts(posted: PostedPayload[]) {
  return (path: string, body: string, token: string) => {
    posted.push({ path, body, token });

    return Promise.resolve();
  };
}

function recordingWindowControl(events: string[]): PerfAutorunWindowControl {
  return {
    isAlwaysOnTop: async () => {
      events.push("isAlwaysOnTop");
      return false;
    },
    show: async () => {
      events.push("show");
    },
    unminimize: async () => {
      events.push("unminimize");
    },
    setFocus: async () => {
      events.push("setFocus");
    },
    setAlwaysOnTop: async (alwaysOnTop) => {
      events.push(`setAlwaysOnTop:${String(alwaysOnTop)}`);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  window.localStorage.clear();
  delete window.__codevoQa;
  delete window.__codevoPerf;
  delete (window as unknown as { __codevoPerfProgress?: unknown }).__codevoPerfProgress;
});

describe("perfAutorunEnabled", () => {
  it("stays disabled outside DEV even with every flag set", () => {
    expect(
      perfAutorunEnabled({
        DEV: false,
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
        VITE_CODEVO_QA_BRIDGE: "1",
      }),
    ).toBe(false);
  });

  it("stays disabled without the autorun flag", () => {
    expect(
      perfAutorunEnabled({
        DEV: true,
        VITE_CODEVO_PERF_BRIDGE: "1",
        VITE_CODEVO_QA_BRIDGE: "1",
      }),
    ).toBe(false);
  });

  it("stays disabled while either bridge is disabled", () => {
    expect(
      perfAutorunEnabled({
        DEV: true,
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_QA_BRIDGE: "1",
      }),
    ).toBe(false);
    expect(
      perfAutorunEnabled({
        DEV: true,
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
      }),
    ).toBe(false);
  });

  it("enables only when DEV, the autorun flag, and both bridges are on", () => {
    expect(
      perfAutorunEnabled({
        DEV: true,
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
        VITE_CODEVO_QA_BRIDGE: "1",
      }),
    ).toBe(true);
  });

  it("enables production autorun only for the exact baked capture flag", () => {
    expect(
      perfAutorunEnabled({
        DEV: false,
        VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1",
      }),
    ).toBe(true);
    expect(
      perfAutorunEnabled({
        DEV: false,
        VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "true",
        VITE_CODEVO_PERF_AUTORUN: "1",
        VITE_CODEVO_PERF_BRIDGE: "1",
        VITE_CODEVO_QA_BRIDGE: "1",
      }),
    ).toBe(false);
    expect(
      perfAutorunEnabled({
        DEV: true,
        VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1",
      }),
    ).toBe(false);
  });

  it("selects the bundled virtual runner only for production capture", () => {
    expect(
      perfAutorunRunnerModulePath({
        DEV: false,
        VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1",
      }),
    ).toBe("virtual:codevo-perf-production-runner");
    expect(perfAutorunRunnerModulePath({ DEV: false })).toBe(PERF_AUTORUN_PATHS.runner);
    expect(perfAutorunRunnerModulePath({ DEV: true, VITE_CODEVO_PERF_AUTORUN: "1" })).toBe(
      PERF_AUTORUN_PATHS.runner,
    );
  });
});

describe("postAutorunPayload", () => {
  it("submits production captures through the typed Tauri command", async () => {
    const invoke = vi.fn(async () => undefined);
    const fetchRequest = vi.fn();

    await postAutorunPayload(
      PERF_AUTORUN_PATHS.result,
      '{"status":"ok"}',
      "one-run-token",
      { DEV: false, VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1" },
      { fetch: fetchRequest as unknown as typeof fetch, invoke },
    );

    expect(invoke).toHaveBeenCalledWith("perf_capture_submit", {
      payload: '{"status":"ok"}',
      runToken: "one-run-token",
    });
    expect(fetchRequest).not.toHaveBeenCalled();
  });

  it("preserves the existing same-origin fetch transport for DEV", async () => {
    const invoke = vi.fn();
    const fetchRequest = vi.fn(async () => ({ ok: true, status: 204 }));

    await postAutorunPayload(
      PERF_AUTORUN_PATHS.result,
      '{"status":"ok"}',
      "dev-token",
      { DEV: true, VITE_CODEVO_PERF_AUTORUN: "1" },
      { fetch: fetchRequest as unknown as typeof fetch, invoke },
    );

    expect(fetchRequest).toHaveBeenCalledWith(PERF_AUTORUN_PATHS.result, {
      method: "POST",
      headers: { "content-type": "application/json", "x-codevo-perf-run-token": "dev-token" },
      body: '{"status":"ok"}',
    });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe("assertStableMeasurementWindow", () => {
  it("accepts a visible focused window with stable frame cadence", async () => {
    let timestamp = performance.now();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      timestamp += 16;
      queueMicrotask(() => callback(timestamp));
      return 1;
    });

    await expect(assertStableMeasurementWindow()).resolves.toBeUndefined();
  });

  it("rejects hidden, unfocused, and throttled windows", async () => {
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await expect(assertStableMeasurementWindow()).rejects.toThrow(/visible/);

    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.spyOn(document, "hasFocus").mockReturnValue(false);
    await expect(assertStableMeasurementWindow()).rejects.toThrow(/focus/);

    let timestamp = performance.now();
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      timestamp += 250;
      queueMicrotask(() => callback(timestamp));
      return 1;
    });
    await expect(assertStableMeasurementWindow()).rejects.toThrow(/unstable/);
  });
});

describe("runPerfAutorun", () => {
  it("runs the served runner with its served options and posts the result", async () => {
    const posted: PostedPayload[] = [];
    const importedPaths: string[] = [];
    const receivedOptions: unknown[] = [];
    const options = { smoke: false, largeFilesRoot: "/repo/perf/fixtures/large-files" };

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: (modulePath) => {
        importedPaths.push(modulePath);

        return Promise.resolve(
          runnerModule((runOptions) => {
            receivedOptions.push(runOptions);

            return Promise.resolve({ bridgeResults: [{ id: "typing-large-5k", samples: [3] }] });
          }, options),
        );
      },
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
    });

    expect(importedPaths).toEqual([PERF_AUTORUN_PATHS.runner]);
    expect(receivedOptions).toEqual([options]);
    expect(posted).toHaveLength(1);
    expect(posted[0].path).toBe(PERF_AUTORUN_PATHS.result);
    expect(posted[0].token).toBe("run-token");
    expect(JSON.parse(posted[0].body)).toEqual({
      status: "ok",
      result: { bridgeResults: [{ id: "typing-large-5k", samples: [3] }] },
    });
  });

  it("waits for both bridges before running the served runner", async () => {
    const posted: PostedPayload[] = [];
    let readyChecks = 0;
    let ranAfterBridges = false;

    await runPerfAutorun({
      bridgesReady: () => {
        readyChecks += 1;

        return readyChecks > 3;
      },
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => {
            ranAfterBridges = readyChecks > 3;

            return Promise.resolve({ bridgeResults: [] });
          }),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
    });

    expect(ranAfterBridges).toBe(true);
    expect(readyChecks).toBeGreaterThan(3);
    expect(JSON.parse(posted[0].body).status).toBe("ok");
  });

  it("posts an authenticated error payload when the bridges never appear", async () => {
    const posted: PostedPayload[] = [];
    let ran = false;

    await runPerfAutorun({
      bridgesReady: () => false,
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => {
            ran = true;

            return Promise.resolve({});
          }),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
    });

    expect(ran).toBe(false);
    expect(posted[0].token).toBe("run-token");
    const payload = JSON.parse(posted[0].body);
    expect(payload.status).toBe("error");
    expect(payload.message).toMatch(/bridge/i);
  });

  it("posts an error payload and never rethrows when the runner fails", async () => {
    const posted: PostedPayload[] = [];

    await expect(
      runPerfAutorun({
        bridgesReady: () => true,
        importRunner: () =>
          Promise.resolve(runnerModule(() => Promise.reject(new Error("scenario blew up")))),
        postPayload: collectPosts(posted),
        acquireWindowControl: async () => recordingWindowControl([]),
        ...fakeClock(),
      }),
    ).resolves.toBeUndefined();

    const payload = JSON.parse(posted[0].body);
    expect(payload.status).toBe("error");
    expect(payload.message).toMatch(/scenario blew up/);
  });

  it("keeps the DEV load failure behavior when only the served runner carries the token", async () => {
    const posted: PostedPayload[] = [];
    const logged: string[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.reject(new Error("404 runner module")),
      postPayload: collectPosts(posted),
      logError: (message) => logged.push(message),
      ...fakeClock(),
    });

    expect(posted).toHaveLength(0);
    expect(logged.join("\n")).toMatch(/404 runner module/);
    expect(logged.join("\n")).toMatch(/run token/i);
  });

  it("reports a production runner-load failure with the eager capture token", async () => {
    const posted: PostedPayload[] = [];
    const abortProductionCapture = vi.fn(async () => undefined);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.reject(new Error("missing production runner chunk")),
      postPayload: collectPosts(posted),
      productionCaptureRunToken: "0123456789abcdef0123456789abcdef",
      abortProductionCapture,
      logError: () => {},
      ...fakeClock(),
    });

    expect(posted).toHaveLength(1);
    expect(posted[0].token).toBe("0123456789abcdef0123456789abcdef");
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/bundled scenario runner/),
    });
    expect(abortProductionCapture).not.toHaveBeenCalled();
  });

  it.each([
    ["focus-only", NATIVE_FOCUS_READY, ["isAlwaysOnTop", "show", "unminimize"]],
    [
      "always-on-top-diagnostic",
      NATIVE_WINDOW_READY,
      ["isAlwaysOnTop", "show", "unminimize", "setAlwaysOnTop:true"],
    ],
  ] as const)(
    "prepares %s fixture trust before sole native activation, strict guard, and runner",
    async (windowMode, nativeState, expectedPreparationEvents) => {
      const events: string[] = [];
      const runToken = "0123456789abcdef0123456789abcdef";
      const windowControl = recordingWindowControl(events);
      const genericSetFocus = vi.fn(async () => {
        throw new Error("deprecated generic activation must not run");
      });

      await runPerfAutorun({
        bridgesReady: () => true,
        importRunner: () =>
          Promise.resolve(
            runnerModule(
              () => {
                events.push("run");
                return Promise.resolve({ bridgeResults: [] });
              },
              { smoke: true },
              runToken,
            ),
          ),
        postPayload: async () => {},
        acquireWindowControl: async () => ({ ...windowControl, setFocus: genericSetFocus }),
        ...fakeClock(),
        productionCaptureRunToken: runToken,
        windowMode,
        prepareProductionCaptureFixtures: async (candidateToken) => {
          events.push(`trust:${candidateToken}`);
        },
        activateProductionCaptureWindow: async (candidateToken) => {
          events.push(`activate:${candidateToken}`);
          return nativeState;
        },
        resetProductionCaptureWindowLeaseBaseline: async () => nativeState,
        snapshotProductionCaptureWindowLease: async () => nativeState,
        installMeasurementWindowGuard: () => {
          events.push("guard");
          return { failure: () => null, dispose: () => events.push("dispose") };
        },
        preflightMeasurementWindow: async () => {
          events.push("preflight");
        },
      });

      expect(genericSetFocus).not.toHaveBeenCalled();
      expect(events.slice(0, expectedPreparationEvents.length)).toEqual(expectedPreparationEvents);
      expect(events).not.toContain("setFocus");
      expect(
        events.indexOf(expectedPreparationEvents[expectedPreparationEvents.length - 1]),
      ).toBeLessThan(events.indexOf(`trust:${runToken}`));
      expect(events.indexOf(`trust:${runToken}`)).toBeLessThan(
        events.indexOf(`activate:${runToken}`),
      );
      expect(events.indexOf(`activate:${runToken}`)).toBeLessThan(events.indexOf("guard"));
      expect(events.indexOf("preflight")).toBeLessThan(events.indexOf("guard"));
      expect(events.indexOf("guard")).toBeLessThan(events.indexOf("run"));
    },
  );

  it("fails closed before activation when exact fixture trust cannot be prepared", async () => {
    const posted: PostedPayload[] = [];
    const run = vi.fn(async () => ({ bridgeResults: [] }));
    const activateProductionCaptureWindow = vi.fn(async () => NATIVE_FOCUS_READY);
    const runToken = "0123456789abcdef0123456789abcdef";

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.resolve(runnerModule(run, { smoke: true }, runToken)),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      prepareProductionCaptureFixtures: () =>
        Promise.reject(new Error("Fixture trust preparation failed.")),
      activateProductionCaptureWindow,
    });

    expect(run).not.toHaveBeenCalled();
    expect(activateProductionCaptureWindow).not.toHaveBeenCalled();
    expect(JSON.parse(posted[0].body)).toEqual({
      status: "error",
      message: "Fixture trust preparation failed.",
    });
  });

  it("never invokes native capture activation for the DEV autorun path", async () => {
    const activateProductionCaptureWindow = vi.fn(async () => NATIVE_WINDOW_READY);
    const prepareProductionCaptureFixtures = vi.fn(async () => undefined);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: async () => {},
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: "",
      activateProductionCaptureWindow,
      prepareProductionCaptureFixtures,
    });

    expect(activateProductionCaptureWindow).not.toHaveBeenCalled();
    expect(prepareProductionCaptureFixtures).not.toHaveBeenCalled();
  });

  it("fails closed with an authenticated payload when native activation rejects", async () => {
    const posted: PostedPayload[] = [];
    const run = vi.fn(async () => ({ bridgeResults: [] }));
    const installMeasurementWindowGuard = vi.fn(() => ({
      failure: () => null,
      dispose: () => {},
    }));
    const runToken = "0123456789abcdef0123456789abcdef";

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.resolve(runnerModule(run, { smoke: true }, runToken)),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      activateProductionCaptureWindow: () =>
        Promise.reject(new Error("Native production capture window activation failed.")),
      installMeasurementWindowGuard,
    });

    expect(run).not.toHaveBeenCalled();
    expect(installMeasurementWindowGuard).not.toHaveBeenCalled();
    expect(posted).toHaveLength(1);
    expect(posted[0].token).toBe(runToken);
    expect(JSON.parse(posted[0].body)).toEqual({
      status: "error",
      message: "Native production capture window activation failed.",
    });
  });

  it.each([
    ["not ready", { ...NATIVE_WINDOW_READY, hidden: true, visible: false }],
    ["missing diagnostic lease", { ...NATIVE_WINDOW_READY, diagnosticSpaceLease: false }],
  ] as const)("rejects a %s final native snapshot", async (_label, invalidSnapshot) => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const run = vi.fn(async () => ({ bridgeResults: [] }));
    let snapshotCount = 0;
    let alwaysOnTop = false;
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.resolve(runnerModule(run, { smoke: true }, runToken)),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => alwaysOnTop,
        setAlwaysOnTop: async (enabled) => {
          alwaysOnTop = enabled;
        },
      }),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      snapshotProductionCaptureWindowLease: async () => {
        snapshotCount += 1;
        return snapshotCount === 1 ? NATIVE_WINDOW_READY : invalidSnapshot;
      },
      installMeasurementWindowGuard,
    });

    expect(run).toHaveBeenCalledOnce();
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "Perf production capture native window snapshot was not ready.",
    });
  });

  it("releases an acquired native observer when baseline reset fails", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const run = vi.fn(async () => ({ bridgeResults: [] }));
    const release = vi.fn(async () => NATIVE_FOCUS_READY);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.resolve(runnerModule(run, { smoke: false }, runToken)),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      activateProductionCaptureWindow: async () => NATIVE_FOCUS_READY,
      resetProductionCaptureWindowLeaseBaseline: () =>
        Promise.reject(new Error("native reset detail")),
      releaseDiagnosticProductionCaptureWindow: release,
    });

    expect(run).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledWith(runToken, NATIVE_FOCUS_READY.leaseId);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "native reset detail",
    });
  });

  it("fails a focus-only capture on any native transition and releases before submit", async () => {
    const posted: PostedPayload[] = [];
    const events: string[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const transitioned = {
      ...NATIVE_FOCUS_READY,
      keyTransitions: 1,
      windowStabilityEpoch: 1,
    };
    let snapshotCount = 0;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(async () => ({ bridgeResults: [] }), { smoke: false }, runToken),
        ),
      postPayload: async (path, body, token) => {
        events.push("submit");
        posted.push({ path, body, token });
      },
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      activateProductionCaptureWindow: async () => NATIVE_FOCUS_READY,
      resetProductionCaptureWindowLeaseBaseline: async () => NATIVE_FOCUS_READY,
      snapshotProductionCaptureWindowLease: async () => {
        snapshotCount += 1;
        return snapshotCount === 1 ? NATIVE_FOCUS_READY : transitioned;
      },
      releaseDiagnosticProductionCaptureWindow: async () => {
        events.push("release");
        return transitioned;
      },
    });

    expect(events).toEqual(["release", "submit"]);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "Perf focus-only capture observed a native window transition during the run.",
    });
  });

  it("coalesces a diagnostic blur/hidden storm and marks recovered smoke samples non-comparable", async () => {
    const posted: PostedPayload[] = [];
    const clock = fakeClock();
    const runToken = "0123456789abcdef0123456789abcdef";
    const reactivateDiagnosticProductionCaptureWindow = vi.fn(async () => NATIVE_WINDOW_READY);
    const releaseDiagnosticProductionCaptureWindow = vi.fn(async () => ({
      ...NATIVE_WINDOW_READY,
      diagnosticSpaceLease: false,
    }));
    let alwaysOnTop = false;
    const windowControl = recordingWindowControl([]);
    let visibility: DocumentVisibilityState = "visible";
    vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(
            async () => {
              window.dispatchEvent(new Event("blur"));
              await Promise.resolve();
              await Promise.resolve();
              visibility = "hidden";
              document.dispatchEvent(new Event("visibilitychange"));
              visibility = "visible";
              return {
                bridgeResults: [
                  { id: "typing-large-5k", samples: [1] },
                  { id: "tab-switch-cycle", samples: [2] },
                ],
                scenarioStatuses: [],
                environment: { windowMode: "always-on-top-diagnostic" },
              };
            },
            { smoke: true },
            runToken,
          ),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...windowControl,
        isAlwaysOnTop: async () => alwaysOnTop,
        setAlwaysOnTop: async (enabled) => {
          alwaysOnTop = enabled;
        },
      }),
      ...clock,
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      reactivateDiagnosticProductionCaptureWindow,
      releaseDiagnosticProductionCaptureWindow,
      installMeasurementWindowGuard,
    });

    expect(reactivateDiagnosticProductionCaptureWindow).toHaveBeenCalledTimes(3);
    expect(releaseDiagnosticProductionCaptureWindow).toHaveBeenCalledOnce();
    expect(reactivateDiagnosticProductionCaptureWindow).toHaveBeenCalledWith(
      runToken,
      NATIVE_WINDOW_READY.leaseId,
    );
    const payload = JSON.parse(posted[0].body);
    expect(payload.status).toBe("ok");
    expect(payload.result.environment).toMatchObject({
      windowInterruptionCount: 1,
      windowInterruptionStages: ["before-scenarios"],
      windowStability: "recovered-diagnostic",
    });
    expect(payload.result.scenarioStatuses).toEqual([
      expect.objectContaining({ id: "typing-large-5k", status: "non-comparable" }),
      expect.objectContaining({ id: "tab-switch-cycle", status: "non-comparable" }),
    ]);
  });

  it.each([
    ["missing production token", "", { smoke: true }, "always-on-top-diagnostic"],
    [
      "non-smoke options",
      "0123456789abcdef0123456789abcdef",
      { smoke: false },
      "always-on-top-diagnostic",
    ],
    [
      "missing runner options",
      "0123456789abcdef0123456789abcdef",
      null,
      "always-on-top-diagnostic",
    ],
    ["focus-only mode", "0123456789abcdef0123456789abcdef", { smoke: true }, "focus-only"],
  ] as const)(
    "keeps strict window failure behavior for %s",
    async (_label, token, options, mode) => {
      const posted: PostedPayload[] = [];
      const reactivateDiagnosticProductionCaptureWindow = vi.fn(async () => NATIVE_WINDOW_READY);
      const releaseDiagnosticProductionCaptureWindow = vi.fn(async () => ({
        ...NATIVE_WINDOW_READY,
        diagnosticSpaceLease: false,
      }));

      await runPerfAutorun({
        bridgesReady: () => true,
        importRunner: () =>
          Promise.resolve(
            runnerModule(
              async () => {
                window.dispatchEvent(new Event("blur"));
                return { bridgeResults: [] };
              },
              options,
              token || "dev-run-token",
            ),
          ),
        postPayload: collectPosts(posted),
        acquireWindowControl: async () => recordingWindowControl([]),
        ...fakeClock(),
        productionCaptureRunToken: token,
        windowMode: mode,
        activateProductionCaptureWindow: () => Promise.resolve(NATIVE_FOCUS_READY),
        resetProductionCaptureWindowLeaseBaseline: () => Promise.resolve(NATIVE_FOCUS_READY),
        snapshotProductionCaptureWindowLease: () => Promise.resolve(NATIVE_FOCUS_READY),
        reactivateDiagnosticProductionCaptureWindow,
        releaseDiagnosticProductionCaptureWindow,
        installMeasurementWindowGuard,
      });

      expect(reactivateDiagnosticProductionCaptureWindow).not.toHaveBeenCalled();
      if (token) {
        expect(releaseDiagnosticProductionCaptureWindow).toHaveBeenCalledOnce();
      } else {
        expect(releaseDiagnosticProductionCaptureWindow).not.toHaveBeenCalled();
      }
      expect(JSON.parse(posted[0].body)).toMatchObject({
        status: "error",
        message: expect.stringMatching(/lost focus/),
      });
    },
  );

  it("fails a diagnostic smoke when bounded recovery rejects", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const run = vi.fn(async () => {
      window.dispatchEvent(new Event("blur"));
      return { bridgeResults: [] };
    });

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.resolve(runnerModule(run, { smoke: true }, runToken)),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      reactivateDiagnosticProductionCaptureWindow: () => Promise.reject(new Error("native detail")),
      installMeasurementWindowGuard,
    });

    expect(JSON.parse(posted[0].body)).toEqual({
      status: "error",
      message: "Perf diagnostic capture could not recover its measurement window.",
    });
    expect(posted[0].body).not.toContain("native detail");
  });

  it("reports native diagnostic lease release failure with the authenticated token", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    let alwaysOnTop = false;
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(async () => ({ bridgeResults: [] }), { smoke: true }, runToken),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => alwaysOnTop,
        setAlwaysOnTop: async (enabled) => {
          alwaysOnTop = enabled;
        },
      }),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      releaseDiagnosticProductionCaptureWindow: () => Promise.reject(new Error("native detail")),
    });

    expect(posted[0].token).toBe(runToken);
    expect(JSON.parse(posted[0].body)).toEqual({
      status: "error",
      message: "Perf production capture could not release its native window observer lease.",
    });
    expect(posted[0].body).not.toContain("native detail");
  });

  it("blocks a prequeued blur from starting recovery during diagnostic cleanup", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const reactivate = vi.fn(async () => NATIVE_WINDOW_READY);
    const release = vi.fn(async () => ({
      ...NATIVE_WINDOW_READY,
      diagnosticSpaceLease: false,
    }));
    let alwaysOnTop = false;
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(async () => ({ bridgeResults: [] }), { smoke: true }, runToken),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => alwaysOnTop,
        setAlwaysOnTop: async (enabled) => {
          alwaysOnTop = enabled;
        },
      }),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      reactivateDiagnosticProductionCaptureWindow: reactivate,
      releaseDiagnosticProductionCaptureWindow: release,
      installMeasurementWindowGuard: (options) => {
        const guard = installMeasurementWindowGuard(options);
        return {
          failure: guard.failure,
          dispose: () => {
            guard.dispose();
            queueMicrotask(() => window.dispatchEvent(new Event("blur")));
          },
        };
      },
    });

    expect(reactivate).not.toHaveBeenCalled();
    expect(release).toHaveBeenCalledOnce();
    expect(JSON.parse(posted[0].body)).toMatchObject({ status: "ok" });
  });

  it("keeps resize fatal in diagnostic smoke without requesting recovery", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const reactivateDiagnosticProductionCaptureWindow = vi.fn(async () => NATIVE_WINDOW_READY);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(
            async () => {
              window.dispatchEvent(new Event("resize"));
              return { bridgeResults: [] };
            },
            { smoke: true },
            runToken,
          ),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      reactivateDiagnosticProductionCaptureWindow,
      installMeasurementWindowGuard,
    });

    expect(reactivateDiagnosticProductionCaptureWindow).not.toHaveBeenCalled();
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/was resized/),
    });
  });

  it("repeats the complete final diagnostic cycle when interruption starts during preflight", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const reactivateDiagnosticProductionCaptureWindow = vi.fn(async () => NATIVE_WINDOW_READY);
    let preflightCalls = 0;
    let alwaysOnTop = false;
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(
            async () => ({
              bridgeResults: [{ id: "typing-large-5k", samples: [1] }],
              scenarioStatuses: [],
              environment: { windowMode: "always-on-top-diagnostic" },
            }),
            { smoke: true },
            runToken,
          ),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => alwaysOnTop,
        setAlwaysOnTop: async (enabled) => {
          alwaysOnTop = enabled;
        },
      }),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      reactivateDiagnosticProductionCaptureWindow,
      installMeasurementWindowGuard,
      preflightMeasurementWindow: async () => {
        preflightCalls += 1;
        if (preflightCalls === 2) {
          window.dispatchEvent(new Event("blur"));
        }
      },
    });

    expect(preflightCalls).toBe(3);
    expect(reactivateDiagnosticProductionCaptureWindow).toHaveBeenCalledTimes(2);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "ok",
      result: {
        environment: {
          windowInterruptionCount: 1,
          windowStability: "recovered-diagnostic",
        },
      },
    });
  });

  it("awaits recovery and repeats preflight when interruption starts during native verification", async () => {
    const posted: PostedPayload[] = [];
    const runToken = "0123456789abcdef0123456789abcdef";
    const reactivateDiagnosticProductionCaptureWindow = vi.fn(async () => NATIVE_WINDOW_READY);
    let preflightCalls = 0;
    let levelReads = 0;
    let alwaysOnTop = false;
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(
            async () => {
              window.dispatchEvent(new Event("blur"));
              return {
                bridgeResults: [{ id: "typing-large-5k", samples: [1] }],
                scenarioStatuses: [],
                environment: { windowMode: "always-on-top-diagnostic" },
              };
            },
            { smoke: true },
            runToken,
          ),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => {
          levelReads += 1;
          if (levelReads === 2) {
            window.dispatchEvent(new Event("blur"));
          }
          return alwaysOnTop;
        },
        setAlwaysOnTop: async (enabled) => {
          alwaysOnTop = enabled;
        },
      }),
      ...fakeClock(),
      productionCaptureRunToken: runToken,
      windowMode: "always-on-top-diagnostic",
      reactivateDiagnosticProductionCaptureWindow,
      installMeasurementWindowGuard,
      preflightMeasurementWindow: async () => {
        preflightCalls += 1;
      },
    });

    expect(preflightCalls).toBe(4);
    expect(levelReads).toBe(3);
    expect(reactivateDiagnosticProductionCaptureWindow).toHaveBeenCalledTimes(3);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "ok",
      result: {
        environment: {
          windowInterruptionCount: 2,
          windowStability: "recovered-diagnostic",
        },
      },
    });
  });

  it("terminates a production capture when its IPC result cannot be submitted", async () => {
    const abortProductionCapture = vi.fn(async () => undefined);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(
            () => Promise.resolve({ bridgeResults: [] }),
            { smoke: true },
            "0123456789abcdef0123456789abcdef",
          ),
        ),
      postPayload: () => Promise.reject(new Error("capture command unavailable")),
      productionCaptureRunToken: "0123456789abcdef0123456789abcdef",
      abortProductionCapture,
      acquireWindowControl: async () => recordingWindowControl([]),
      logError: () => {},
      ...fakeClock(),
    });

    expect(abortProductionCapture).toHaveBeenCalledOnce();
  });

  it("refuses to run a served module that carries no run token", async () => {
    const posted: PostedPayload[] = [];
    const logged: string[] = [];
    let ran = false;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve({
          perfAutorunOptions: { smoke: true },
          default: () => {
            ran = true;

            return Promise.resolve({ bridgeResults: [] });
          },
        }),
      postPayload: collectPosts(posted),
      logError: (message) => logged.push(message),
      ...fakeClock(),
    });

    expect(ran).toBe(false);
    expect(posted).toHaveLength(0);
    expect(logged.join("\n")).toMatch(/run token/i);
  });

  it("authenticates the error payload it posts when the run fails", async () => {
    const posted: PostedPayload[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => Promise.reject(new Error("scenario blew up")), { smoke: true }, "abc"),
        ),
      postPayload: collectPosts(posted),
      ...fakeClock(),
    });

    expect(posted[0].token).toBe("abc");
    expect(JSON.parse(posted[0].body).status).toBe("error");
  });

  it("shows and focuses the app without changing its window level by default", async () => {
    const events: string[] = [];
    const posted: PostedPayload[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => {
            events.push("run");

            return Promise.resolve({ bridgeResults: [] });
          }),
        ),
      postPayload: (path, body, token) => {
        events.push("post");
        posted.push({ path, body, token });

        return Promise.resolve();
      },
      acquireWindowControl: async () => recordingWindowControl(events),
      ...fakeClock(),
    });

    expect(events).toEqual([
      "isAlwaysOnTop",
      "show",
      "unminimize",
      "setFocus",
      "run",
      "isAlwaysOnTop",
      "post",
    ]);
    expect(posted).toHaveLength(1);
  });

  it("uses and restores always-on-top only in explicit diagnostic mode", async () => {
    const events: string[] = [];
    const posted: PostedPayload[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.reject(new Error("scenario blew up")))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl(events),
      ...fakeClock(),
      windowMode: "always-on-top-diagnostic",
    });

    expect(events).toContain("setAlwaysOnTop:true");
    expect(events[events.length - 1]).toBe("setAlwaysOnTop:false");
    expect(JSON.parse(posted[0].body).status).toBe("error");
  });

  it("preserves a pre-existing always-on-top state in diagnostic mode", async () => {
    const events: string[] = [];
    const posted: PostedPayload[] = [];
    const control = recordingWindowControl(events);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({ ...control, isAlwaysOnTop: async () => true }),
      ...fakeClock(),
      windowMode: "always-on-top-diagnostic",
    });

    expect(events.some((event) => event.startsWith("setAlwaysOnTop:"))).toBe(false);
    expect(JSON.parse(posted[0].body).status).toBe("ok");
  });

  it("restores the always-on-top flag even when the relay post fails", async () => {
    const events: string[] = [];
    const logged: string[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: () => Promise.reject(new Error("relay down")),
      acquireWindowControl: async () => recordingWindowControl(events),
      logError: (message) => logged.push(message),
      ...fakeClock(),
      windowMode: "always-on-top-diagnostic",
    });

    expect(events[events.length - 1]).toBe("setAlwaysOnTop:false");
    expect(logged.join("\n")).toMatch(/relay down/);
  });

  it("never lifts the window when the runner module cannot be loaded", async () => {
    const acquireWindowControl = vi.fn(async () => recordingWindowControl([]));

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () => Promise.reject(new Error("404 runner module")),
      postPayload: collectPosts([]),
      acquireWindowControl,
      logError: () => {},
      ...fakeClock(),
    });

    expect(acquireWindowControl).not.toHaveBeenCalled();
  });

  it("fails closed without authoritative window control and logs acquisition failures", async () => {
    const posted: PostedPayload[] = [];
    const logged: string[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => null,
      ...fakeClock(),
    });

    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/authoritative window control/),
    });

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: () => Promise.reject(new Error("no tauri window")),
      logError: (message) => logged.push(message),
      ...fakeClock(),
    });

    expect(posted).toHaveLength(2);
    expect(JSON.parse(posted[1].body).status).toBe("error");
    expect(logged.join("\n")).toMatch(/no tauri window/);
  });

  it("fails closed when a required focus-only window call fails", async () => {
    const posted: PostedPayload[] = [];
    const logged: string[] = [];
    const events: string[] = [];
    const control = recordingWindowControl(events);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        setFocus: async () => {
          throw new Error("focus denied");
        },
      }),
      logError: (message) => logged.push(message),
      ...fakeClock(),
    });

    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/setFocus: focus denied/),
    });
    expect(logged).toEqual([]);
  });

  it("rejects a pre-existing always-on-top window in focus-only mode", async () => {
    const posted: PostedPayload[] = [];
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({ ...control, isAlwaysOnTop: async () => true }),
      ...fakeClock(),
    });

    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/already always-on-top/),
    });
  });

  it("fails the result when diagnostic window restoration fails", async () => {
    const posted: PostedPayload[] = [];
    let calls = 0;
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        setAlwaysOnTop: async (enabled) => {
          calls += 1;
          if (!enabled) {
            throw new Error("restore denied");
          }
        },
      }),
      ...fakeClock(),
      windowMode: "always-on-top-diagnostic",
    });

    expect(calls).toBe(2);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/restore denied/),
    });
  });

  it("restores the original level after an uncertain diagnostic elevation failure", async () => {
    const posted: PostedPayload[] = [];
    const calls: boolean[] = [];
    const control = recordingWindowControl([]);

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        setAlwaysOnTop: async (enabled) => {
          calls.push(enabled);
          if (enabled) {
            throw new Error("native settlement uncertain");
          }
        },
      }),
      ...fakeClock(),
      windowMode: "always-on-top-diagnostic",
    });

    expect(calls).toEqual([true, false]);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/native settlement uncertain/),
    });
  });

  it("fails closed before running when the visibility and rAF preflight rejects", async () => {
    const posted: PostedPayload[] = [];
    let ran = false;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => {
            ran = true;
            return Promise.resolve({ bridgeResults: [] });
          }),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      preflightMeasurementWindow: () => Promise.reject(new Error("rAF preflight is unstable")),
    });

    expect(ran).toBe(false);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "rAF preflight is unstable",
    });
  });

  it("invalidates before the runner when the guard latches during first preflight", async () => {
    const posted: PostedPayload[] = [];
    const dispose = vi.fn();
    let ran = false;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => {
            ran = true;
            return Promise.resolve({ bridgeResults: [] });
          }),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      installMeasurementWindowGuard: () => ({
        failure: () => "measurement window lost focus during the run",
        dispose,
      }),
    });

    expect(dispose).toHaveBeenCalledOnce();
    expect(ran).toBe(false);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "measurement window lost focus during the run",
    });
  });

  it("invalidates when the guard latches during postflight", async () => {
    const posted: PostedPayload[] = [];
    let preflightCalls = 0;
    let failure: string | null = null;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      preflightMeasurementWindow: async () => {
        preflightCalls += 1;
        if (preflightCalls === 2) {
          failure = "measurement window blurred during postflight";
        }
      },
      installMeasurementWindowGuard: () => ({ failure: () => failure, dispose: () => {} }),
    });

    expect(preflightCalls).toBe(2);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "measurement window blurred during postflight",
    });
  });

  it("invalidates a native window-level change during a focus-only run", async () => {
    const posted: PostedPayload[] = [];
    const control = recordingWindowControl([]);
    let levelReads = 0;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => {
          levelReads += 1;
          return levelReads > 1;
        },
      }),
      ...fakeClock(),
    });

    expect(levelReads).toBe(2);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: expect.stringMatching(/window level changed/),
    });
  });

  it("revalidates the guard after the post-run native window query", async () => {
    const posted: PostedPayload[] = [];
    const control = recordingWindowControl([]);
    let levelReads = 0;
    let failure: string | null = null;

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => ({
        ...control,
        isAlwaysOnTop: async () => {
          levelReads += 1;
          if (levelReads === 2) {
            failure = "measurement window blurred during native postflight query";
          }
          return false;
        },
      }),
      ...fakeClock(),
      installMeasurementWindowGuard: () => ({ failure: () => failure, dispose: () => {} }),
    });

    expect(levelReads).toBe(2);
    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "measurement window blurred during native postflight query",
    });
  });

  it("invalidates a resize event during measurement", async () => {
    const posted: PostedPayload[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(
          runnerModule(() => {
            window.dispatchEvent(new Event("resize"));
            return Promise.resolve({ bridgeResults: [] });
          }),
        ),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl([]),
      ...fakeClock(),
      installMeasurementWindowGuard,
    });

    expect(JSON.parse(posted[0].body)).toMatchObject({
      status: "error",
      message: "Perf autorun measurement window was resized during the run.",
    });
  });

  it("logs instead of throwing when the relay itself is unreachable", async () => {
    const logged: string[] = [];

    await expect(
      runPerfAutorun({
        bridgesReady: () => true,
        importRunner: () =>
          Promise.resolve(runnerModule(() => Promise.resolve({ bridgeResults: [] }))),
        postPayload: () => Promise.reject(new Error("relay down")),
        logError: (message) => logged.push(message),
        ...fakeClock(),
      }),
    ).resolves.toBeUndefined();

    expect(logged.join("\n")).toMatch(/relay down/);
  });
});

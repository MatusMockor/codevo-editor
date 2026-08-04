// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_AUTORUN_PATHS } from "./perfAutorunEndpoints";
import {
  assertStableMeasurementWindow,
  installMeasurementWindowGuard,
  perfAutorunEnabled,
  runPerfAutorun,
  type PerfAutorunRunnerModule,
  type PerfAutorunWindowControl,
} from "./perfAutorunTrigger";

interface PostedPayload {
  readonly path: string;
  readonly body: string;
  readonly token: string;
}

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

  it("logs and posts nothing when the runner module cannot be fetched, because it carries the run token", async () => {
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

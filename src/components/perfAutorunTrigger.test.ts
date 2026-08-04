// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import { PERF_AUTORUN_PATHS } from "./perfAutorunEndpoints";
import {
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

  it("lifts the app window above other windows before the run and restores it after posting", async () => {
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
      "show",
      "unminimize",
      "setAlwaysOnTop:true",
      "setFocus",
      "run",
      "post",
      "setAlwaysOnTop:false",
    ]);
    expect(posted).toHaveLength(1);
  });

  it("restores the always-on-top flag even when the run aborts", async () => {
    const events: string[] = [];
    const posted: PostedPayload[] = [];

    await runPerfAutorun({
      bridgesReady: () => true,
      importRunner: () =>
        Promise.resolve(runnerModule(() => Promise.reject(new Error("scenario blew up")))),
      postPayload: collectPosts(posted),
      acquireWindowControl: async () => recordingWindowControl(events),
      ...fakeClock(),
    });

    expect(events[events.length - 1]).toBe("setAlwaysOnTop:false");
    expect(JSON.parse(posted[0].body).status).toBe("error");
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

  it("runs without window control when none is available and logs acquisition failures", async () => {
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

    expect(JSON.parse(posted[0].body).status).toBe("ok");

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
    expect(logged.join("\n")).toMatch(/no tauri window/);
  });

  it("continues the run and logs when individual window calls fail", async () => {
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
        setAlwaysOnTop: async () => {
          throw new Error("always-on-top denied");
        },
      }),
      logError: (message) => logged.push(message),
      ...fakeClock(),
    });

    expect(JSON.parse(posted[0].body).status).toBe("ok");
    expect(logged.join("\n")).toMatch(/setAlwaysOnTop\(true\): always-on-top denied/);
    expect(logged.join("\n")).toMatch(/setAlwaysOnTop\(false\): always-on-top denied/);
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

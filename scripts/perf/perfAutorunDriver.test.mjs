import { EventEmitter } from "node:events";
import { createServer } from "node:http";
import { describe, expect, it } from "vitest";
import { PERF_AUTORUN_TOKEN_ENV, PERF_AUTORUN_TOKEN_HEADER } from "./perfAutorunRelay.mjs";
import {
  DEFAULT_AUTORUN_TIMEOUT_MS,
  MAX_AUTORUN_TIMEOUT_MS,
  assertPortFree,
  parseAutorunTimeoutMs,
  runAutorunLane,
  spawnDebugTauri,
} from "./perfAutorunDriver.mjs";

function validResult() {
  return {
    bridgeResults: [
      { id: "typing-large-5k", samples: [4, 5] },
      { id: "tab-switch-cycle", samples: [7] },
    ],
    trackerSnapshot: [],
    scenarioStatuses: [],
    failedPaths: [],
    retainedCounts: { models: 2, editors: 1 },
    memorySample: { usedJsHeapBytes: null },
  };
}

function postingLauncher(bodyFactory, trace, headerOverrides = {}) {
  return ({ endpoint, env }) => {
    let resolveExit = () => {};
    const exited = new Promise((resolve) => {
      resolveExit = resolve;
    });

    trace.postStatus = (async () => {
      const response = await fetch(new URL("/result", endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [PERF_AUTORUN_TOKEN_HEADER]: env[PERF_AUTORUN_TOKEN_ENV],
          ...headerOverrides,
        },
        body: bodyFactory(),
      });

      return response.status;
    })();

    return {
      exited,
      async stop() {
        trace.stopped = (trace.stopped ?? 0) + 1;
        resolveExit({ code: 0, signal: null });
      },
    };
  };
}

function silentLauncher(trace) {
  return () => {
    let resolveExit = () => {};
    const exited = new Promise((resolve) => {
      resolveExit = resolve;
    });

    return {
      exited,
      async stop() {
        trace.stopped = (trace.stopped ?? 0) + 1;
        resolveExit({ code: null, signal: "SIGTERM" });
      },
    };
  };
}

function crashingLauncher(trace) {
  return () => ({
    exited: Promise.resolve({ code: 101, signal: null }),
    async stop() {
      trace.stopped = (trace.stopped ?? 0) + 1;
    },
  });
}

function lane(launchApp, overrides = {}) {
  return runAutorunLane({
    smoke: true,
    timeoutMs: 5000,
    repoRoot: "/repo",
    launchApp,
    ...overrides,
  });
}

describe("parseAutorunTimeoutMs", () => {
  it("keeps a value inside the allowed window", () => {
    expect(parseAutorunTimeoutMs("60000")).toBe(60000);
  });

  it("rejects a non-numeric value", () => {
    expect(() => parseAutorunTimeoutMs("soon")).toThrow(/timeout/i);
  });

  it("rejects a zero or negative timeout", () => {
    expect(() => parseAutorunTimeoutMs("0")).toThrow(/timeout/i);
    expect(() => parseAutorunTimeoutMs("-1")).toThrow(/timeout/i);
  });

  it("rejects a timeout above the 30 minute ceiling", () => {
    expect(() => parseAutorunTimeoutMs(String(MAX_AUTORUN_TIMEOUT_MS + 1))).toThrow(/30/);
  });

  it("accepts its own default, so the default can never sit outside the allowed window", () => {
    expect(parseAutorunTimeoutMs(String(DEFAULT_AUTORUN_TIMEOUT_MS))).toBe(
      DEFAULT_AUTORUN_TIMEOUT_MS,
    );
  });
});

describe("spawnDebugTauri", () => {
  function fakeChildProcess() {
    const child = new EventEmitter();
    child.pid = undefined;
    child.kill = () => true;

    return child;
  }

  it("turns a failed spawn into a settled exit instead of an uncaught error", async () => {
    const child = fakeChildProcess();
    const app = spawnDebugTauri({ env: {}, repoRoot: "/repo", spawnProcess: () => child });
    child.emit("error", new Error("spawn npm ENOENT"));

    await expect(app.exited).resolves.toMatchObject({ error: "spawn npm ENOENT" });
  });

  it("stops promptly after a failed spawn instead of waiting on a process that never ran", async () => {
    const child = fakeChildProcess();
    const app = spawnDebugTauri({ env: {}, repoRoot: "/repo", spawnProcess: () => child });
    child.emit("error", new Error("spawn npm ENOENT"));
    await app.exited;

    await expect(app.stop()).resolves.toBeUndefined();
  });

  it("ignores a late error event once the child has already exited", async () => {
    const child = fakeChildProcess();
    const app = spawnDebugTauri({ env: {}, repoRoot: "/repo", spawnProcess: () => child });
    child.emit("exit", 0, null);

    await expect(app.exited).resolves.toEqual({ code: 0, signal: null, error: null });

    child.emit("error", new Error("kill refused"));

    await expect(app.stop()).resolves.toBeUndefined();
  });

  it("passes the driver env and repo root to the spawned command", () => {
    let spawnedWith = null;
    spawnDebugTauri({
      env: { CODEVO_PERF_AUTORUN_SMOKE: "1" },
      repoRoot: "/repo",
      spawnProcess: (command, args, options) => {
        spawnedWith = { command, args, options };

        return fakeChildProcess();
      },
    });

    expect(spawnedWith.command).toBe("npm");
    expect(spawnedWith.args).toEqual(["run", "debug:tauri"]);
    expect(spawnedWith.options.cwd).toBe("/repo");
    expect(spawnedWith.options.detached).toBe(true);
    expect(spawnedWith.options.env.CODEVO_PERF_AUTORUN_SMOKE).toBe("1");
  });
});

describe("assertPortFree", () => {
  it("passes for a port nothing is listening on", async () => {
    await expect(assertPortFree(1)).resolves.toBeUndefined();
  });

  it("refuses when the dev server port is already taken", async () => {
    const server = createServer(() => {});
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const { port } = server.address();

    await expect(assertPortFree(port)).rejects.toThrow(/already/i);

    await new Promise((resolve) => {
      server.close(resolve);
    });
  });

  it("refuses a listener bound only to the IPv6 loopback, as vite dev binds it", async () => {
    const server = createServer(() => {});
    await new Promise((resolve) => {
      server.listen(0, "::1", resolve);
    });
    const { port } = server.address();

    await expect(assertPortFree(port)).rejects.toThrow(/already/i);

    await new Promise((resolve) => {
      server.close(resolve);
    });
  });
});

describe("runAutorunLane", () => {
  it("returns the posted result and stops the app", async () => {
    const trace = {};
    const outcome = await lane(
      postingLauncher(() => JSON.stringify({ status: "ok", result: validResult() }), trace),
    );

    expect(outcome.status).toBe("ok");
    expect(outcome.result.bridgeResults).toHaveLength(2);
    expect(trace.stopped).toBe(1);
  });

  it("passes the smoke flag and the relay endpoint to the launched app", async () => {
    const trace = {};
    let launchedWith = null;
    const launcher = postingLauncher(
      () => JSON.stringify({ status: "ok", result: validResult() }),
      trace,
    );
    await lane((launchOptions) => {
      launchedWith = launchOptions;

      return launcher(launchOptions);
    });

    expect(launchedWith.env.VITE_CODEVO_PERF_AUTORUN).toBe("1");
    expect(launchedWith.env.VITE_CODEVO_PERF_BRIDGE).toBe("1");
    expect(launchedWith.env.VITE_CODEVO_QA_BRIDGE).toBe("1");
    expect(launchedWith.env.CODEVO_PERF_AUTORUN_SMOKE).toBe("1");
    expect(launchedWith.env.CODEVO_PERF_AUTORUN_ENDPOINT).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it("fails closed on a garbage payload and answers the app with HTTP 400", async () => {
    const trace = {};
    const outcome = await lane(postingLauncher(() => '{"status":"ok","result":{"brid', trace));

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/not valid JSON/);
    await expect(trace.postStatus).resolves.toBe(400);
    expect(trace.stopped).toBe(1);
  });

  it("fails closed on a result payload missing required fields", async () => {
    const trace = {};
    const outcome = await lane(
      postingLauncher(
        () => JSON.stringify({ status: "ok", result: { trackerSnapshot: [], failedPaths: [] } }),
        trace,
      ),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/bridgeResults/);
    expect(trace.stopped).toBe(1);
  });

  it("surfaces an error reported by the in-app trigger", async () => {
    const trace = {};
    const outcome = await lane(
      postingLauncher(
        () => JSON.stringify({ status: "error", message: "bridges never became available" }),
        trace,
      ),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/bridges never became available/);
    expect(trace.stopped).toBe(1);
  });

  it("ignores a post that carries no run token and keeps waiting for the real result", async () => {
    const trace = {};
    let strayStatus = 0;
    const outcome = await lane(
      ({ endpoint, env }) => {
        let resolveExit = () => {};
        const exited = new Promise((resolve) => {
          resolveExit = resolve;
        });

        void (async () => {
          const stray = await fetch(new URL("/result", endpoint), {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "totally not a perf result",
          });
          strayStatus = stray.status;
          await fetch(new URL("/result", endpoint), {
            method: "POST",
            headers: {
              "content-type": "application/json",
              [PERF_AUTORUN_TOKEN_HEADER]: env[PERF_AUTORUN_TOKEN_ENV],
            },
            body: JSON.stringify({ status: "ok", result: validResult() }),
          });
        })();

        return {
          exited,
          async stop() {
            trace.stopped = (trace.stopped ?? 0) + 1;
            resolveExit({ code: 0, signal: null });
          },
        };
      },
      { timeoutMs: 5000 },
    );

    expect(strayStatus).toBe(403);
    expect(outcome.status).toBe("ok");
  });

  it("ignores a duplicate post that lands after the first accepted result", async () => {
    const trace = {};
    let duplicate = null;
    const outcome = await lane(({ endpoint, env }) => {
      const body = JSON.stringify({ status: "ok", result: validResult() });
      const headers = {
        "content-type": "application/json",
        [PERF_AUTORUN_TOKEN_HEADER]: env[PERF_AUTORUN_TOKEN_ENV],
      };
      let resolveExit = () => {};
      const exited = new Promise((resolve) => {
        resolveExit = resolve;
      });

      void (async () => {
        await fetch(new URL("/result", endpoint), { method: "POST", headers, body });
        duplicate = await fetch(new URL("/result", endpoint), {
          method: "POST",
          headers,
          body: JSON.stringify({ status: "error", message: "second thoughts" }),
        }).catch(() => null);
      })();

      return {
        exited,
        async stop() {
          trace.stopped = (trace.stopped ?? 0) + 1;
          resolveExit({ code: 0, signal: null });
        },
      };
    });

    expect(outcome.status).toBe("ok");
    expect(duplicate === null || duplicate.status === 204).toBe(true);
  });

  it("rejects a body over the result server cap", async () => {
    const trace = {};
    const outcome = await lane(
      postingLauncher(() => `{"padding":"${"x".repeat(9 * 1024 * 1024)}"}`, trace),
    );

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/size cap/);
    await expect(trace.postStatus).resolves.toBe(413);
  });

  it("times out, stops the app, and reports the elapsed budget", async () => {
    const trace = {};
    const outcome = await lane(silentLauncher(trace), { timeoutMs: 150 });

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/150 ms/);
    expect(trace.stopped).toBe(1);
  });

  it("fails when the app exits before posting a result", async () => {
    const trace = {};
    const outcome = await lane(crashingLauncher(trace));

    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/exited/i);
    expect(outcome.message).toMatch(/101/);
  });

  it("releases the result server port when the launcher itself fails", async () => {
    let endpoint = "";

    await expect(
      lane((launchOptions) => {
        endpoint = launchOptions.endpoint;

        throw new Error("npm is missing");
      }),
    ).rejects.toThrow(/npm is missing/);

    await expect(
      fetch(new URL("/result", endpoint), { method: "POST", body: "{}" }),
    ).rejects.toThrow();
  });

  it("still releases the result server when stopping the app fails", async () => {
    let endpoint = "";

    await expect(
      lane((launchOptions) => {
        endpoint = launchOptions.endpoint;

        return {
          exited: Promise.resolve({ code: 0, signal: null }),
          stop: () => Promise.reject(new Error("kill refused")),
        };
      }),
    ).rejects.toThrow(/kill refused/);

    await expect(
      fetch(new URL("/result", endpoint), { method: "POST", body: "{}" }),
    ).rejects.toThrow();
  });

  it("releases the result server port after the lane settles", async () => {
    const trace = {};
    let endpoint = "";
    const launcher = postingLauncher(
      () => JSON.stringify({ status: "ok", result: validResult() }),
      trace,
    );
    await lane((launchOptions) => {
      endpoint = launchOptions.endpoint;

      return launcher(launchOptions);
    });

    await expect(
      fetch(new URL("/result", endpoint), { method: "POST", body: "{}" }),
    ).rejects.toThrow();
  });
});

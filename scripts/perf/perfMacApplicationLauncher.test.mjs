import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import process from "node:process";
import { describe, expect, it, vi } from "vitest";
import { spawnDirectApplicationSupervisor } from "./perfMacApplicationLauncher.mjs";

const expectedIdentity = Object.freeze({
  artifactSha256: "a".repeat(64),
  bundleManifestSha256: "c".repeat(64),
  bundleId: "dev.mockor.editor.perf.0123456789abcdef01234567",
  bundlePath: "/owned/Codevo Editor.app",
  executablePath: "/owned/Codevo Editor.app/Contents/MacOS/codevo-editor",
  runToken: "01234567-89ab-cdef-0123-456789abcdef",
});

function launchPlan() {
  return {
    command: "/owned/codevo-perf-capture-launcher",
    args: ["--bundle", expectedIdentity.bundlePath],
    cwd: "/owned",
    env: { PATH: "/usr/bin:/bin" },
    expectedIdentity,
  };
}

function createFakeChild(pid = 4312) {
  const child = new EventEmitter();
  child.pid = pid;
  child.stdout = new EventEmitter();
  child.stdout.destroy = vi.fn();
  child.stderr = new EventEmitter();
  child.stderr.destroy = vi.fn();
  child.stdin = new EventEmitter();
  child.stdin.end = vi.fn();
  child.kill = vi.fn(() => true);
  child.unref = vi.fn();
  child.stdout.unref = vi.fn();
  child.stderr.unref = vi.fn();
  return child;
}

function createHarness() {
  const child = createFakeChild();
  const spawnProcess = vi.fn(() => child);
  const launched = spawnDirectApplicationSupervisor(launchPlan(), spawnProcess);
  return { child, launched, spawnProcess };
}

function readyMessage(overrides = {}) {
  return {
    schemaVersion: 1,
    state: "ready",
    runToken: expectedIdentity.runToken,
    artifactSha256: expectedIdentity.artifactSha256,
    bundleManifestSha256: expectedIdentity.bundleManifestSha256,
    bundlePath: expectedIdentity.bundlePath,
    executablePath: expectedIdentity.executablePath,
    bundleId: expectedIdentity.bundleId,
    pid: 9917,
    pgid: 9917,
    launchTimeMillis: 1_783_000_000_000,
    ...overrides,
  };
}

function terminalMessage(overrides = {}) {
  return {
    schemaVersion: 1,
    state: "terminated",
    runToken: expectedIdentity.runToken,
    bundleManifestSha256: expectedIdentity.bundleManifestSha256,
    pid: 9917,
    graceful: true,
    ...overrides,
  };
}

function publish(child, message, suffix = "\n") {
  const payload = typeof message === "string" ? message : JSON.stringify(message);
  child.stdout.emit("data", Buffer.from(`${payload}${suffix}`, "utf8"));
}

describe("spawnDirectApplicationSupervisor", () => {
  it("resolves readiness from an exact closed ownership message", async () => {
    const { child, launched } = createHarness();

    publish(child, readyMessage());

    await expect(launched.ready).resolves.toEqual(readyMessage());
    publish(child, terminalMessage());
    child.emit("close", 0, null);
    await expect(launched.exited).resolves.toMatchObject({ error: null });
  });

  it("accepts exact ready and graceful terminal ownership proof", async () => {
    const { child, launched, spawnProcess } = createHarness();

    publish(child, readyMessage());
    await expect(launched.ready).resolves.toEqual(readyMessage());
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toEqual({ code: 0, signal: null, error: null });
    expect(spawnProcess).toHaveBeenCalledWith(
      "/owned/codevo-perf-capture-launcher",
      ["--bundle", expectedIdentity.bundlePath],
      expect.objectContaining({
        cwd: "/owned",
        detached: true,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
  });

  it("waits for stdio close so terminal proof buffered after exit is accepted", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;

    child.emit("exit", 0, null);
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toEqual({ code: 0, signal: null, error: null });
  });

  it("never interrupts a recycled helper group after exit while stdout is draining", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;

    child.emit("exit", 0, null);
    const stopping = launched.interrupt();
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(stopping).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
    await expect(launched.exited).resolves.toEqual({ code: 0, signal: null, error: null });
  });

  it("stop drains terminal proof after exit without signalling a recycled group", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;

    child.emit("exit", 0, null);
    const stopping = launched.stop();
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(stopping).resolves.toBeUndefined();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("treats stdin EPIPE as an expected cleanup race", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;
    child.stdin.emit("error", Object.assign(new Error("closed"), { code: "EPIPE" }));
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({ error: null });
  });

  it("rejects a ready proof for a foreign artifact identity", async () => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(/invalid or duplicate/);

    publish(child, readyMessage({ artifactSha256: "b".repeat(64) }));
    child.emit("close", 1, null);

    await readyRejection;
    await expect(launched.exited).resolves.toMatchObject({
      code: 1,
      error:
        "Production application supervisor published invalid or duplicate application ownership.",
    });
  });

  it("rejects a ready ownership message with an unknown field", async () => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(/invalid or duplicate/);

    publish(child, readyMessage({ unexpected: true }));
    child.emit("close", 1, null);

    await readyRejection;
    await expect(launched.exited).resolves.toMatchObject({
      error:
        "Production application supervisor published invalid or duplicate application ownership.",
    });
  });

  it("rejects a terminal ownership message with an unknown field", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;

    publish(child, terminalMessage({ unexpected: true }));
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({
      error:
        "Production application supervisor published invalid or duplicate terminal ownership state.",
    });
  });

  it("rejects terminal proof when the post-capture bundle identity changed", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;

    publish(child, terminalMessage({ bundleManifestSha256: "d".repeat(64) }));
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({
      error:
        "Production application supervisor published invalid or duplicate terminal ownership state.",
    });
  });

  it.each([
    ["malformed JSON", "{not-json}\n", /malformed ownership state/],
    [
      "legacy watchdog-prepared state",
      `${JSON.stringify({
        schemaVersion: 1,
        state: "watchdog-prepared",
        runToken: expectedIdentity.runToken,
        bundleManifestSha256: expectedIdentity.bundleManifestSha256,
      })}\n`,
      /unknown ownership state/,
    ],
    [
      "unknown trailing state",
      `${JSON.stringify({ state: "surprise" })}\n`,
      /unknown ownership state/,
    ],
  ])("fails closed on %s", async (_label, output, expectedError) => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(expectedError);

    child.stdout.emit("data", Buffer.from(output, "utf8"));
    child.emit("close", 1, null);

    await readyRejection;
    await expect(launched.exited).resolves.toMatchObject({
      error: expect.stringMatching(expectedError),
    });
  });

  it("discards all later helper output after the first protocol failure", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;

    publish(child, { state: "unknown-after-ready" });
    child.stdout.emit("data", Buffer.alloc(1024 * 1024, 0x78));
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({
      error: "Production application supervisor published an unknown ownership state.",
    });
  });

  it("records duplicate ready proof as a terminal protocol failure", async () => {
    const { child, launched } = createHarness();

    publish(child, readyMessage());
    await expect(launched.ready).resolves.toMatchObject({ state: "ready", pid: 9917 });
    publish(child, readyMessage());
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({
      error:
        "Production application supervisor published invalid or duplicate application ownership.",
    });
  });

  it("rejects non-whitespace trailing protocol output after valid proof", async () => {
    const { child, launched } = createHarness();

    publish(child, readyMessage());
    await launched.ready;
    publish(child, terminalMessage());
    child.stdout.emit("data", Buffer.from("trailing garbage", "utf8"));
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({
      error: "Production application supervisor published malformed ownership state.",
    });
  });

  it("fails when the helper exits after ready without terminal proof", async () => {
    const { child, launched } = createHarness();

    publish(child, readyMessage());
    await launched.ready;
    child.emit("close", 0, null);

    await expect(launched.exited).resolves.toMatchObject({
      code: 0,
      error: "Production application supervisor exited without terminal proof.",
    });
  });

  it("fails both readiness and exit when the helper exits without any proof", async () => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(
      /exited before publishing ownership/,
    );

    child.stderr.emit("data", Buffer.from("launch denied\n", "utf8"));
    child.emit("close", 2, null);

    await readyRejection;
    await expect(launched.exited).resolves.toMatchObject({
      code: 2,
      error: expect.stringMatching(/launch denied/),
    });
  });

  it("refuses to SIGKILL the sole cleanup authority without terminal proof", async () => {
    const { child, launched } = createHarness();
    let clock = 10_000;

    await expect(
      launched.stop({
        now: () => clock,
        timeoutMs: 100,
        delay: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/refusing to SIGKILL.*owned roots must be preserved/);

    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    expect(child.unref).not.toHaveBeenCalled();
    expect(child.stdout.unref).not.toHaveBeenCalled();
    expect(child.stderr.unref).not.toHaveBeenCalled();
  });

  it("interrupts before ready using stdin EOF without signalling a process group", async () => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(
      /exited before publishing ownership/,
    );

    const firstInterrupt = launched.interrupt();
    const secondInterrupt = launched.interrupt();
    child.emit("close", null, "SIGTERM");

    await readyRejection;
    await expect(firstInterrupt).rejects.toThrow(/cleanup was not proven/);
    await expect(secondInterrupt).rejects.toThrow(/cleanup was not proven/);
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("never signals a recycled helper group after close", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;
    publish(child, terminalMessage());
    child.emit("close", 0, null);
    await launched.exited;

    await expect(launched.interrupt()).resolves.toBeUndefined();

    expect(child.kill).not.toHaveBeenCalled();
  });

  it("reaps after TERM escalation and never reaches KILL", async () => {
    const { child, launched } = createHarness();
    let clock = 1_000;
    publish(child, readyMessage());
    await launched.ready;
    child.kill.mockImplementation((signal) => {
      if (signal === "SIGTERM") {
        publish(child, terminalMessage({ graceful: false }));
        child.emit("exit", null, signal);
        child.emit("close", null, signal);
      }
      return true;
    });

    await expect(
      launched.stop({
        now: () => clock,
        timeoutMs: 100,
        delay: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/cleanup was not proven.*force termination/);

    expect(child.kill.mock.calls).toEqual([["SIGTERM"]]);
    await expect(launched.exited).resolves.toMatchObject({ signal: "SIGTERM" });
  });

  it("reaps after KILL escalation without signalling again", async () => {
    const { child, launched } = createHarness();
    let clock = 2_000;
    publish(child, readyMessage());
    await launched.ready;
    publish(child, terminalMessage());
    child.kill.mockImplementation((signal) => {
      if (signal === "SIGKILL") {
        child.emit("exit", null, signal);
        child.emit("close", null, signal);
      }
      return true;
    });

    const firstStop = launched.stop({
      now: () => clock,
      timeoutMs: 100,
      delay: async (ms) => {
        clock += ms;
      },
    });
    const repeatedStop = launched.stop();

    expect(repeatedStop).toBe(firstStop);
    await expect(firstStop).rejects.toThrow(/cleanup was not proven.*SIGKILL/);
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
    launched.interrupt();
    expect(child.kill.mock.calls).toEqual([["SIGTERM"], ["SIGKILL"]]);
  });

  it("treats repeated stop after an already-exited child as idempotent", async () => {
    const { child, launched } = createHarness();
    publish(child, readyMessage());
    await launched.ready;
    publish(child, terminalMessage());
    child.emit("exit", 0, null);
    child.emit("close", 0, null);

    const firstStop = launched.stop();
    const repeatedStop = launched.stop();

    expect(repeatedStop).toBe(firstStop);
    await expect(firstStop).resolves.toBeUndefined();
    expect(child.stdin.end).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("settles exited after reaping even when inherited stdout never closes", async () => {
    const { child, launched } = createHarness();
    let clock = 3_000;
    publish(child, readyMessage());
    await launched.ready;
    publish(child, terminalMessage());
    child.emit("exit", 0, null);

    await expect(
      launched.stop({
        now: () => clock,
        timeoutMs: 100,
        delay: async (ms) => {
          clock += ms;
        },
      }),
    ).resolves.toBeUndefined();

    expect(child.stdout.destroy).toHaveBeenCalledOnce();
    expect(child.stderr.destroy).toHaveBeenCalledOnce();
    await expect(launched.exited).resolves.toEqual({ code: 0, signal: null, error: null });
  });

  it("does not leave the real exact launcher child alive after stop escalation", async () => {
    const script = [
      `const ready = ${JSON.stringify(readyMessage())};`,
      "ready.pid = process.pid;",
      "ready.pgid = process.pid;",
      "process.stdout.write(JSON.stringify(ready) + '\\n');",
      "process.stdin.resume();",
      "process.stdin.on('end', () => {});",
      "setInterval(() => {}, 1000);",
    ].join("");
    let realChild;
    const launched = spawnDirectApplicationSupervisor(
      {
        ...launchPlan(),
        command: process.execPath,
        args: ["-e", script],
        cwd: process.cwd(),
        env: process.env,
      },
      (...args) => {
        realChild = spawn(...args);
        return realChild;
      },
    );
    const ready = await launched.ready;

    await expect(launched.stop({ timeoutMs: 250 })).rejects.toThrow(
      /cleanup was not proven.*without terminal proof/,
    );
    await expect(launched.exited).resolves.toMatchObject({ signal: "SIGTERM" });
    expect(() => process.kill(ready.pid, 0)).toThrow(expect.objectContaining({ code: "ESRCH" }));
    expect(realChild.exitCode === null && realChild.signalCode === null).toBe(false);
  });

  it("rejects terminal proof published before valid ready ownership", async () => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(
      /invalid or duplicate terminal ownership state/,
    );

    const stopping = launched.stop();
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(stopping).rejects.toThrow(/cleanup was not proven/);
    await readyRejection;
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(child.kill).not.toHaveBeenCalled();
  });

  it.each([
    [
      "ready runToken",
      () =>
        JSON.stringify(readyMessage()).replace('"runToken":', '"runToken":"shadow","runToken":'),
    ],
    ["terminal pid", () => JSON.stringify(terminalMessage()).replace('"pid":', '"pid":123,"pid":')],
  ])("rejects duplicate raw JSON key in %s", async (label, duplicateMessage) => {
    const { child, launched } = createHarness();
    if (label.startsWith("terminal")) {
      publish(child, readyMessage());
      await launched.ready;
    }

    publish(child, duplicateMessage());
    child.emit("close", 1, null);

    if (label.startsWith("ready")) {
      await expect(launched.ready).rejects.toThrow(/malformed ownership state/);
    }
    await expect(launched.exited).resolves.toMatchObject({
      error: "Production application supervisor published malformed ownership state.",
    });
  });

  it("latches bounded stdout rejection and discards every later chunk", async () => {
    const { child, launched } = createHarness();
    const readyRejection = expect(launched.ready).rejects.toThrow(/bounded ownership output/);

    child.stdout.emit("data", Buffer.alloc(16 * 1024 + 1, 0x61));
    for (let index = 0; index < 100; index += 1) {
      child.stdout.emit("data", Buffer.alloc(16 * 1024, 0x62));
    }
    publish(child, readyMessage());
    child.emit("close", 1, null);

    await readyRejection;
    await expect(launched.exited).resolves.toMatchObject({
      error: "Production application supervisor exceeded its bounded ownership output.",
    });
  });
});

import { Buffer } from "node:buffer";
import { EventEmitter } from "node:events";
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
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = vi.fn();
  child.unref = vi.fn();
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
    const kill = vi.fn();
    publish(child, readyMessage());
    await launched.ready;

    child.emit("exit", 0, null);
    launched.interrupt({ kill });
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    expect(kill).not.toHaveBeenCalled();
    await expect(launched.exited).resolves.toEqual({ code: 0, signal: null, error: null });
  });

  it("stop drains terminal proof after exit without signalling a recycled group", async () => {
    const { child, launched } = createHarness();
    const kill = vi.fn();
    publish(child, readyMessage());
    await launched.ready;

    child.emit("exit", 0, null);
    const stopping = launched.stop({ kill });
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(stopping).resolves.toBeUndefined();
    expect(kill).not.toHaveBeenCalled();
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

  it("preserves an unsettled supervisor instead of deleting roots with unproven cleanup", async () => {
    const { child, launched } = createHarness();
    const kill = vi.fn(() => {
      throw Object.assign(new Error("foreign group"), { code: "EPERM" });
    });
    let clock = 10_000;

    await expect(
      launched.stop({
        kill,
        now: () => clock,
        timeoutMs: 100,
        delay: async (ms) => {
          clock += ms;
        },
      }),
    ).rejects.toThrow(/unsettled application.*owned roots must be preserved/);

    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
    expect(child.unref).toHaveBeenCalledOnce();
  });

  it("interrupts before ready using stdin EOF without signalling a process group", async () => {
    const { child, launched } = createHarness();
    const kill = vi.fn(() => {
      throw Object.assign(new Error("reused group"), { code: "EPERM" });
    });
    const readyRejection = expect(launched.ready).rejects.toThrow(
      /exited before publishing ownership/,
    );

    launched.interrupt({ kill });
    launched.interrupt({ kill });
    child.emit("close", null, "SIGTERM");

    await readyRejection;
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
  });

  it("never signals a recycled helper group after close", async () => {
    const { child, launched } = createHarness();
    const kill = vi.fn();
    publish(child, readyMessage());
    await launched.ready;
    publish(child, terminalMessage());
    child.emit("close", 0, null);
    await launched.exited;

    launched.interrupt({ kill });

    expect(kill).not.toHaveBeenCalled();
  });

  it("rejects terminal proof published before valid ready ownership", async () => {
    const { child, launched } = createHarness();
    const kill = vi.fn();
    const readyRejection = expect(launched.ready).rejects.toThrow(
      /invalid or duplicate terminal ownership state/,
    );

    const stopping = launched.stop({ kill });
    publish(child, terminalMessage());
    child.emit("close", 0, null);

    await expect(stopping).rejects.toThrow(/cleanup was not proven/);
    await readyRejection;
    expect(child.stdin.end).toHaveBeenCalledOnce();
    expect(kill).not.toHaveBeenCalled();
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

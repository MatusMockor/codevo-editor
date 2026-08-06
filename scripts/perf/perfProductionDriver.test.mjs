import { EventEmitter } from "node:events";
import { spawn as spawnProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MAX_PRODUCTION_BUILD_TIMEOUT_MS,
  parseProductionTimeoutMs,
  productionBuildPlan,
  productionApplicationBundlePath,
  createOwnedCaptureRoot,
  productionExecutablePath,
  resolvePinnedTauriCli,
  resolvePinnedViteEntry,
  removeOwnedCaptureRoot,
  runProductionCaptureLane,
  sanitizedProductionEnvironment,
  sha256File,
  spawnOwnedProcess,
  waitForAtomicResult,
  verifyOwnedCaptureRoot,
} from "./perfProductionDriver.mjs";
import { createProductionAbortAuthority } from "./run-perf-scenarios.mjs";

const scratch = [];

afterEach(() => {
  for (const root of scratch.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryRoot() {
  const root = mkdtempSync(path.join(os.tmpdir(), "production-driver-test-"));
  scratch.push(root);
  return root;
}

function validPayload() {
  return JSON.stringify({
    status: "ok",
    result: {
      bridgeResults: [
        { id: "typing-large-5k", samples: [1] },
        { id: "tab-switch-cycle", samples: [2] },
      ],
      trackerSnapshot: [],
      scenarioStatuses: [],
      failedPaths: [],
      retainedCounts: { models: 1, editors: 1 },
    },
  });
}

function settledProcess(status = { code: 0, signal: null, error: null }, trace = {}) {
  let stopped = false;
  return {
    exited: Promise.resolve(status),
    async stop() {
      if (stopped) return;
      stopped = true;
      trace.stopped = (trace.stopped ?? 0) + 1;
    },
  };
}

function laneDependencies(root, overrides = {}) {
  let launches = 0;
  const targetDir = path.join(root, "target");
  const appBundlePath = path.join(targetDir, "release", "Codevo Editor.app");
  const executablePath = path.join(appBundlePath, "Contents", "MacOS", "codevo-editor");
  const launcherExecutablePath = path.join(targetDir, "release", "codevo-perf-capture-launcher");
  mkdirSync(path.dirname(executablePath), { recursive: true });
  writeFileSync(executablePath, "artifact");
  chmodSync(executablePath, 0o700);
  writeFileSync(launcherExecutablePath, "launcher");
  chmodSync(launcherExecutablePath, 0o700);
  const launchApp = () => ({
    ready: Promise.resolve({ pid: 42, pgid: 42 }),
    exited: Promise.resolve({ code: 0, signal: null, error: null }),
    async stop() {},
  });
  return {
    makeOwnedRoot: () => root,
    removeOwnedRoot: () => {},
    randomToken: () => "01234567-89ab-cdef-0123-456789abcdef",
    createSnapshot: () => ({ workRoot: path.join(root, "work") }),
    verifySnapshot: () => ({ failure: null, metadata: { digest: "fixture" } }),
    cleanupSnapshot: () => {},
    createBuildPlan: () => ({
      command: "cargo",
      args: [],
      cwd: "/repo",
      env: {},
      frontendPlan: { command: "node", args: [], cwd: "/repo", env: {} },
      launcherBuildPlan: { command: "cargo", args: [], cwd: "/repo", env: {} },
      targetDir,
      executablePath,
      appBundlePath,
      launcherExecutablePath,
      bundleId: "dev.mockor.editor.perf.0123456789abcdef01234567",
    }),
    launchProcess: () => {
      launches += 1;
      return settledProcess();
    },
    waitForResult: async () => validPayload(),
    launchApp,
    hashFile: () => "a".repeat(64),
    readSourceRevision: () => "b".repeat(40),
    launches: () => launches,
    ...overrides,
  };
}

describe("production build plan", () => {
  it("uses an isolated release app bundle and compile-time capture authority", () => {
    const root = temporaryRoot();
    const repoRoot = path.join(root, "repo");
    const tauriCli = path.join(repoRoot, "node_modules", ".bin", "tauri");
    const viteEntry = path.join(repoRoot, "node_modules", "vite", "bin", "vite.js");
    mkdirSync(path.dirname(tauriCli), { recursive: true });
    mkdirSync(path.dirname(viteEntry), { recursive: true });
    writeFileSync(tauriCli, "#!/bin/sh\n");
    writeFileSync(viteEntry, "// vite\n");
    chmodSync(tauriCli, 0o700);
    const plan = productionBuildPlan({
      repoRoot,
      ownedRoot: root,
      runToken: "01234567-89ab-cdef-0123-456789abcdef",
      resultPath: path.join(root, "result.json"),
      workRoot: path.join(root, "work"),
      smoke: true,
    });

    expect(plan.command).toBe(realpathSync(tauriCli));
    expect(plan.args).toEqual([
      "build",
      "--bundles",
      "app",
      "--no-sign",
      "--features",
      "perf-capture",
      "--config",
      plan.configPath,
    ]);
    expect(plan.env.CARGO_TARGET_DIR).toBe(plan.targetDir);
    expect(plan.env.VITE_CODEVO_PERF_PRODUCTION_CAPTURE).toBe("1");
    expect(plan.env.VITE_CODEVO_PERF_WINDOW_MODE).toBe("always-on-top-diagnostic");
    expect(plan.env.CODEVO_PERF_CAPTURE_SMOKE).toBe("1");
    expect(plan.env.CODEVO_PERF_CAPTURE_WORK_ROOT).toBe(path.join(root, "work"));
    expect(plan.env.CODEVO_PERF_CAPTURE_RESULT_PATH).toBe(path.join(root, "result.json"));
    expect(plan.env.CODEVO_PERF_CAPTURE_SHUTDOWN_PATH).toBe(path.join(root, "shutdown-proof.json"));
    expect(plan.frontendPlan).toMatchObject({
      command: process.execPath,
      args: [
        realpathSync(viteEntry),
        "build",
        "--outDir",
        path.join(root, "dist"),
        "--emptyOutDir",
      ],
    });
    expect(plan.executablePath).toContain("Codevo Editor.app/Contents/MacOS/codevo-editor");
    expect(plan.appBundlePath).toBe(productionApplicationBundlePath(plan.targetDir));
    expect(plan.launcherBuildPlan.args).toEqual([
      "build",
      "--release",
      "--example",
      "codevo-perf-capture-launcher",
      "--features",
      "perf-capture-launcher",
    ]);
    expect(plan.launcherExecutablePath).toBe(
      path.join(plan.targetDir, "release", "examples", "codevo-perf-capture-launcher"),
    );

    const fullRoot = path.join(root, "full");
    mkdirSync(fullRoot);
    const fullPlan = productionBuildPlan({
      repoRoot,
      ownedRoot: fullRoot,
      runToken: "fedcba98-7654-3210-fedc-ba9876543210",
      resultPath: path.join(fullRoot, "result.json"),
      workRoot: path.join(fullRoot, "work"),
      smoke: false,
    });
    expect(fullPlan.env.VITE_CODEVO_PERF_WINDOW_MODE).toBe("focus-only");
  });

  it("resolves only the executable repository-pinned Tauri CLI", () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, "node_modules", ".bin"), { recursive: true });
    expect(() => resolvePinnedTauriCli(root)).toThrow();
    const cli = path.join(root, "node_modules", ".bin", "tauri");
    writeFileSync(cli, "not executable");
    expect(() => resolvePinnedTauriCli(root)).toThrow(/unavailable/);
  });

  it("resolves only a regular repository-pinned Vite entry", () => {
    const root = temporaryRoot();
    mkdirSync(path.join(root, "node_modules", "vite", "bin"), { recursive: true });
    expect(() => resolvePinnedViteEntry(root)).toThrow();
  });

  it("drops arbitrary inherited environment values", () => {
    expect(
      sanitizedProductionEnvironment(
        { PATH: "/bin", AWS_SECRET_ACCESS_KEY: "secret", NODE_OPTIONS: "--inspect" },
        { OWNED: "yes" },
      ),
    ).toEqual({ PATH: "/bin", OWNED: "yes" });
  });

  it("fails closed off macOS", () => {
    expect(() => productionExecutablePath("/target", "linux")).toThrow(/macOS only/);
  });

  it("bounds timeout flags", () => {
    expect(
      parseProductionTimeoutMs("1000", {
        flag: "--production-build-timeout-ms",
        maximum: MAX_PRODUCTION_BUILD_TIMEOUT_MS,
      }),
    ).toBe(1000);
    expect(() =>
      parseProductionTimeoutMs("0", {
        flag: "--production-build-timeout-ms",
        maximum: MAX_PRODUCTION_BUILD_TIMEOUT_MS,
      }),
    ).toThrow(/positive integer/);
  });
});

describe("bounded executable identity", () => {
  it("hashes a stable regular executable and rejects an oversized sparse artifact", () => {
    const root = temporaryRoot();
    const executable = path.join(root, "app");
    writeFileSync(executable, "artifact");
    expect(sha256File(executable)).toMatch(/^[a-f0-9]{64}$/);
    truncateSync(executable, 512 * 1024 * 1024 + 1);
    expect(() => sha256File(executable)).toThrow(/bounded file contract/);
  });
});

describe("owned capture root", () => {
  it("refuses to delete a replacement at the remembered path", () => {
    const record = createOwnedCaptureRoot();
    const moved = `${record.path}-moved`;
    renameSync(record.path, moved);
    mkdirSync(record.path);
    try {
      expect(() => removeOwnedCaptureRoot(record)).toThrow(/replaced/);
    } finally {
      rmSync(record.path, { recursive: true, force: true });
      rmSync(moved, { recursive: true, force: true });
    }
  });

  it("refuses to delete an owned root whose permissions changed", () => {
    const record = createOwnedCaptureRoot();
    chmodSync(record.path, 0o755);
    expect(() => removeOwnedCaptureRoot(record)).toThrow(/replaced/);
    expect(existsSync(record.path)).toBe(true);
    expect(() => verifyOwnedCaptureRoot(record)).toThrow(/replaced/);
    chmodSync(record.path, 0o700);
    removeOwnedCaptureRoot(record);
  });

  it("preserves the marker creation error when exact rollback also fails", () => {
    const parent = temporaryRoot();
    const owned = path.join(parent, "codevo-perf-production-marker-failure");
    expect(() =>
      createOwnedCaptureRoot({
        temporaryParent: parent,
        createDirectory: () => {
          mkdirSync(owned, { mode: 0o700 });
          return owned;
        },
        writeMarker: () => {
          throw new Error("marker write failed");
        },
        remove: () => {
          throw new Error("rollback failed");
        },
      }),
    ).toThrow("marker write failed");
  });

  it("rejects and rolls back a capture root writable by another account class", () => {
    const parent = temporaryRoot();
    const owned = path.join(parent, "codevo-perf-production-open-root");
    expect(() =>
      createOwnedCaptureRoot({
        temporaryParent: parent,
        createDirectory: () => {
          mkdirSync(owned, { mode: 0o777 });
          chmodSync(owned, 0o777);
          return owned;
        },
      }),
    ).toThrow(/permissions were rejected/);
    expect(existsSync(owned)).toBe(false);
  });
});

describe("runProductionCaptureLane", () => {
  it("builds, launches the exact artifact, validates the result and cleans both owned roots", async () => {
    const root = temporaryRoot();
    const trace = { snapshotCleaned: 0, rootCleaned: 0, stopped: 0 };
    let applicationPlan;
    const deps = laneDependencies(root, {
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
      launchProcess: () => settledProcess(undefined, trace),
      launchApp: (plan) => {
        applicationPlan = plan;
        return {
          ready: Promise.resolve({ pid: 42, pgid: 42 }),
          exited: Promise.resolve({ code: 0, signal: null, error: null }),
          async stop() {
            trace.stopped += 1;
          },
        };
      },
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });

    expect(outcome.status).toBe("ok");
    expect(outcome.artifactSha256).toBe("a".repeat(64));
    expect(outcome.bundleManifestSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(outcome.captureEnvironment).toMatchObject({
      bundleManifestSha256: outcome.bundleManifestSha256,
      captureFlavor: "production-instrumented",
      launchState: "cold-fresh-profile",
      sourceRevision: "b".repeat(40),
      workspaceState: "fixture-clean",
    });
    expect(trace).toMatchObject({ snapshotCleaned: 1, rootCleaned: 1, stopped: 4 });
    expect(applicationPlan.command).toContain("codevo-perf-capture-launcher");
    expect(applicationPlan.args).toHaveLength(9);
    expect(applicationPlan.args[0]).toContain("Codevo Editor.app");
    expect(applicationPlan.args[1]).toContain("Contents/MacOS/codevo-editor");
    expect(applicationPlan.args[4]).toMatch(/^[a-f0-9]{64}$/);
    expect(applicationPlan.expectedIdentity.bundleManifestSha256).toBe(applicationPlan.args[4]);
    expect(applicationPlan.args[7]).toBe("01234567-89ab-cdef-0123-456789abcdef");
    expect(applicationPlan.args[8]).toMatch(/^[a-f0-9]{64}$/);
    expect(applicationPlan.env).toMatchObject({
      HOME: path.join(root, "profile-home"),
      TMPDIR: path.join(root, "runtime-temp"),
      CODEVO_PERF_CAPTURE_PROCESS_OWNER: applicationPlan.args[8],
    });
  });

  it("does not launch an app after a failed build", async () => {
    const root = temporaryRoot();
    let launches = 0;
    const deps = laneDependencies(root, {
      launchProcess: () => {
        launches += 1;
        return settledProcess({ code: 1, signal: null, error: null });
      },
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/build failed/);
    expect(launches).toBe(1);
  });

  it("fails on an app exit before publication", async () => {
    const root = temporaryRoot();
    const deps = laneDependencies(root, {
      launchApp: () => ({
        ready: Promise.resolve({ pid: 42, pgid: 42 }),
        exited: Promise.resolve({ code: 70, signal: null, error: null }),
        stop: async () => {},
      }),
      waitForResult: () => new Promise(() => {}),
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome.message).toMatch(/exited before publishing.*code 70/);
  });

  it("rejects malformed and in-app error payloads", async () => {
    for (const raw of ["not-json", JSON.stringify({ status: "error", message: "bridge failed" })]) {
      const root = temporaryRoot();
      const deps = laneDependencies(root, {
        waitForResult: async () => raw,
      });
      const outcome = await runProductionCaptureLane({
        repoRoot: "/repo",
        smoke: true,
        dependencies: deps,
      });
      expect(outcome.status).toBe("failed");
    }
  });

  it("rejects fixture or executable mutation", async () => {
    for (const mutation of ["fixture", "artifact"]) {
      const root = temporaryRoot();
      let hashes = 0;
      const deps = laneDependencies(root, {
        verifySnapshot: () => ({
          failure: mutation === "fixture" ? "fixtures changed" : null,
          metadata: {},
        }),
        hashFile: () => `${mutation === "artifact" && hashes++ > 0 ? "b" : "a"}`.repeat(64),
      });
      const outcome = await runProductionCaptureLane({
        repoRoot: "/repo",
        smoke: true,
        dependencies: deps,
      });
      expect(outcome.status).toBe("failed");
      expect(outcome.message).toMatch(
        mutation === "fixture" ? /fixtures changed/ : /executable changed/,
      );
    }
  });

  it("rejects application bundle mutation after result acceptance", async () => {
    const root = temporaryRoot();
    let captures = 0;
    const deps = laneDependencies(root, {
      captureBundleIdentity: () => ({
        schemaVersion: 1,
        digest: `${captures++ === 0 ? "c" : "d"}`.repeat(64),
        entryCount: 4,
        fileCount: 3,
        totalBytes: 12,
      }),
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/application bundle changed/);
  });

  it("rejects an application bundle writable outside its owner", async () => {
    const root = temporaryRoot();
    const deps = laneDependencies(root);
    chmodSync(deps.createBuildPlan().appBundlePath, 0o777);
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/regular app bundle/);
  });

  it("disposes the ownership abort listener when readiness rejects", async () => {
    const root = temporaryRoot();
    const controller = new AbortController();
    const add = vi.spyOn(controller.signal, "addEventListener");
    const remove = vi.spyOn(controller.signal, "removeEventListener");
    const deps = laneDependencies(root, {
      launchApp: () => ({
        ready: Promise.reject(new Error("readiness rejected")),
        exited: Promise.resolve({ code: 0, signal: null, error: null }),
        async stop() {},
      }),
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      signal: controller.signal,
      dependencies: deps,
    });
    expect(outcome).toMatchObject({ status: "failed", message: "readiness rejected" });
    expect(remove.mock.calls.length).toBe(add.mock.calls.length);
  });

  it("rejects a source change across the isolated frontend and Rust build", async () => {
    const root = temporaryRoot();
    let reads = 0;
    const deps = laneDependencies(root, {
      readSourceRevision: () => `${reads++ === 0 ? "a" : "b"}`.repeat(40),
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/source changed/);
    expect(deps.launches()).toBe(3);
  });

  it("preserves both the primary failure and cleanup failure", async () => {
    const root = temporaryRoot();
    const deps = laneDependencies(root, {
      launchProcess: () => settledProcess({ code: 9, signal: null, error: null }),
      cleanupSnapshot: () => {
        throw new Error("snapshot cleanup refused");
      },
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome.status).toBe("failed");
    expect(outcome.message).toMatch(/frontend build failed.*snapshot cleanup refused/);
  });

  it("fails closed when cancellation arrives after result acceptance during cleanup", async () => {
    const root = temporaryRoot();
    const controller = new AbortController();
    const deps = laneDependencies(root, {
      cleanupSnapshot: () => controller.abort(),
      removeOwnedRoot: () => {
        throw new Error("late root cleanup failed");
      },
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      signal: controller.signal,
      dependencies: deps,
    });
    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/cancelled/);
    expect(outcome.message).toMatch(/late root cleanup failed/);
  });

  it("does not delete owned roots while an owned process group survives cleanup", async () => {
    const root = temporaryRoot();
    const trace = { snapshotCleaned: 0, rootCleaned: 0 };
    const deps = laneDependencies(root, {
      launchApp: () => ({
        ready: Promise.resolve({ pid: 42, pgid: 42 }),
        exited: new Promise(() => {}),
        async stop() {
          throw new Error("owned PGID survived");
        },
      }),
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome.message).toMatch(/owned PGID survived/);
    expect(trace).toEqual({ snapshotCleaned: 0, rootCleaned: 0 });
  });

  it("retains every owned root while direct application cleanup remains unsettled", async () => {
    const root = temporaryRoot();
    const trace = { snapshotCleaned: 0, rootCleaned: 0 };
    const deps = laneDependencies(root, {
      launchApp: () => ({
        ready: Promise.reject(new Error("direct application ownership failed")),
        exited: Promise.resolve({ code: 70, signal: null, error: "cleanup pending" }),
        async stop() {
          throw new Error("direct application cleanup remains pending");
        },
      }),
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
    });
    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });
    expect(outcome.message).toMatch(/direct application cleanup remains pending/);
    expect(outcome.message).toMatch(/process cleanup failed/);
    expect(trace).toEqual({ snapshotCleaned: 0, rootCleaned: 0 });
  });

  it("preserves every owned root when the native launch callback never settles", async () => {
    const root = temporaryRoot();
    const trace = {
      appLaunches: 0,
      interrupts: 0,
      resultReads: 0,
      snapshotCleaned: 0,
      rootCleaned: 0,
    };
    const deps = laneDependencies(root, {
      applicationOwnershipTimeoutMs: 1,
      applicationTerminalProofTimeoutMs: 1,
      launchApp: () => {
        trace.appLaunches += 1;
        return {
          ready: new Promise(() => {}),
          exited: new Promise(() => {}),
          interrupt() {
            trace.interrupts += 1;
          },
          async stop() {
            throw new Error("native launch settlement and cleanup remain unproven");
          },
        };
      },
      waitForResult: async () => {
        trace.resultReads += 1;
        return validPayload();
      },
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
    });

    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });

    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/ownership timed out/);
    expect(outcome.message).toMatch(/settlement and cleanup remain unproven/);
    expect(trace).toEqual({
      appLaunches: 1,
      interrupts: 1,
      resultReads: 0,
      snapshotCleaned: 0,
      rootCleaned: 0,
    });
  });

  it("accepts only cleanup proof when the native callback arrives after the Node timeout", async () => {
    const root = temporaryRoot();
    const trace = {
      appLaunches: 0,
      interrupts: 0,
      resultReads: 0,
      stops: 0,
      snapshotCleaned: 0,
      rootCleaned: 0,
    };
    let resolveReady;
    let resolveExited;
    let resolveCleanup;
    const ready = new Promise((resolve) => {
      resolveReady = resolve;
    });
    const exited = new Promise((resolve) => {
      resolveExited = resolve;
    });
    const cleanup = new Promise((resolve) => {
      resolveCleanup = resolve;
    });
    const deps = laneDependencies(root, {
      applicationOwnershipTimeoutMs: 1,
      applicationTerminalProofTimeoutMs: 10,
      launchApp: () => {
        trace.appLaunches += 1;
        return {
          ready,
          exited,
          interrupt() {
            trace.interrupts += 1;
            Promise.resolve().then(() => {
              resolveReady({ pid: 42, pgid: 42 });
              resolveExited({ code: 0, signal: null, error: null });
              resolveCleanup();
            });
          },
          async stop() {
            trace.stops += 1;
            await cleanup;
          },
        };
      },
      waitForResult: async () => {
        trace.resultReads += 1;
        return validPayload();
      },
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
    });

    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });

    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/ownership timed out/);
    expect(trace).toEqual({
      appLaunches: 1,
      interrupts: 1,
      resultReads: 0,
      stops: 1,
      snapshotCleaned: 1,
      rootCleaned: 1,
    });
  });

  it("preserves roots when direct supervisor cleanup remains unsettled after ownership", async () => {
    const root = temporaryRoot();
    const trace = { appLaunches: 0, snapshotCleaned: 0, rootCleaned: 0 };
    const deps = laneDependencies(root, {
      launchApp: () => {
        trace.appLaunches += 1;
        return {
          ready: Promise.resolve({ pid: 42, pgid: 42 }),
          exited: new Promise(() => {}),
          async stop() {
            throw new Error("direct supervisor cleanup remained unsettled");
          },
        };
      },
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
    });

    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });

    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/direct supervisor cleanup remained unsettled/);
    expect(trace).toEqual({ appLaunches: 1, snapshotCleaned: 0, rootCleaned: 0 });
  });

  it("does not retry or delete roots when terminal proof is missing after stop", async () => {
    const root = temporaryRoot();
    const trace = { appLaunches: 0, stops: 0, snapshotCleaned: 0, rootCleaned: 0 };
    const deps = laneDependencies(root, {
      launchApp: () => {
        trace.appLaunches += 1;
        return {
          ready: Promise.resolve({ pid: 42, pgid: 42 }),
          exited: Promise.resolve({
            code: 0,
            signal: null,
            error: "supervisor exited without terminal proof",
          }),
          async stop() {
            trace.stops += 1;
          },
        };
      },
      cleanupSnapshot: () => {
        trace.snapshotCleaned += 1;
      },
      removeOwnedRoot: () => {
        trace.rootCleaned += 1;
      },
    });

    const outcome = await runProductionCaptureLane({
      repoRoot: "/repo",
      smoke: true,
      dependencies: deps,
    });

    expect(outcome).toMatchObject({ status: "failed" });
    expect(outcome.message).toMatch(/cleanup was not proven/);
    expect(outcome.message).toMatch(/without terminal proof/);
    expect(trace).toEqual({
      appLaunches: 1,
      stops: 1,
      snapshotCleaned: 0,
      rootCleaned: 0,
    });
  });
});

describe("owned process supervision", () => {
  it("sends TERM and then KILL to the exact detached process group", async () => {
    const child = new EventEmitter();
    child.pid = 4242;
    child.kill = () => true;
    const handle = spawnOwnedProcess(
      { command: "app", args: [], cwd: "/tmp", env: {} },
      () => child,
    );
    const signals = [];
    let now = 0;
    await handle.stop({
      delay: async (ms) => {
        now += ms;
      },
      kill: (pid, signal) => signals.push([pid, signal]),
      groupAlive: () => signals.at(-1)?.[1] !== "SIGKILL",
      now: () => now,
    });
    expect(signals).toEqual([
      [-4242, "SIGTERM"],
      [-4242, "SIGKILL"],
    ]);
  });

  it("still reaps the owned group when its leader exits before a descendant", async () => {
    const child = new EventEmitter();
    child.pid = 4343;
    child.kill = () => true;
    const handle = spawnOwnedProcess(
      { command: "app", args: [], cwd: "/tmp", env: {} },
      () => child,
    );
    child.emit("exit", 0, null);
    const signals = [];
    let now = 0;
    await handle.stop({
      delay: async (ms) => {
        now += ms;
      },
      kill: (pid, signal) => signals.push([pid, signal]),
      groupAlive: () => signals.at(-1)?.[1] !== "SIGKILL",
      now: () => now,
    });
    expect(signals).toEqual([
      [-4343, "SIGTERM"],
      [-4343, "SIGKILL"],
    ]);
  });

  it("fails cleanup when a descendant survives the final KILL grace", async () => {
    const child = new EventEmitter();
    child.pid = 4444;
    child.kill = () => true;
    const handle = spawnOwnedProcess(
      { command: "app", args: [], cwd: "/tmp", env: {} },
      () => child,
    );
    let now = 0;
    await expect(
      handle.stop({
        delay: async (ms) => {
          now += ms;
        },
        kill: () => {},
        groupAlive: () => true,
        now: () => now,
      }),
    ).rejects.toThrow(/survived SIGKILL/);
  });

  it("reaps a real detached build group when the npm-facing SIGINT handler fires", async () => {
    const root = temporaryRoot();
    const readyPath = path.join(root, "ready");
    let child;
    const handle = spawnOwnedProcess(
      {
        command: process.execPath,
        args: [
          "-e",
          [
            'const { spawn } = require("node:child_process");',
            'const { writeFileSync } = require("node:fs");',
            'spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });',
            `writeFileSync(${JSON.stringify(readyPath)}, "ready");`,
            "setInterval(() => {}, 1000);",
          ].join("\n"),
        ],
        cwd: root,
        env: process.env,
      },
      (...args) => {
        child = spawnProcess(...args);
        return child;
      },
    );
    try {
      await waitUntil(() => existsSync(readyPath));
      const processTarget = new EventEmitter();
      processTarget.exitCode = undefined;
      const authority = createProductionAbortAuthority(processTarget);
      authority.ownProcess(handle);
      processTarget.emit("SIGINT");
      processTarget.emit("SIGINT");
      expect(processTarget.listenerCount("SIGINT")).toBe(1);
      await handle.stop();
      expect(processTarget.exitCode).toBe(130);
      expect(isProcessGroupAlive(child.pid)).toBe(false);
      authority.dispose();
    } finally {
      if (child && isProcessGroupAlive(child.pid)) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // Best-effort test-only containment after an assertion failure.
        }
      }
    }
  });
});

async function waitUntil(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Timed out waiting for spawned process readiness.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function isProcessGroupAlive(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

describe("atomic result ingestion", () => {
  it("reads a bounded regular result", async () => {
    const root = temporaryRoot();
    const result = path.join(root, "result.json");
    writeFileSync(result, validPayload());
    await expect(waitForAtomicResult(result, { timeoutMs: 100 })).resolves.toBe(validPayload());
  });

  it("rejects a symlink result", async () => {
    const root = temporaryRoot();
    const target = path.join(root, "target.json");
    const result = path.join(root, "result.json");
    writeFileSync(target, validPayload());
    symlinkSync(target, result);
    await expect(waitForAtomicResult(result, { timeoutMs: 100 })).rejects.toThrow(/regular file/);
  });

  it("times out without accepting a stale or missing result", async () => {
    await expect(
      waitForAtomicResult(path.join(temporaryRoot(), "missing.json"), {
        timeoutMs: 1,
        pollMs: 1,
      }),
    ).rejects.toThrow(/timed out/);
  });
});

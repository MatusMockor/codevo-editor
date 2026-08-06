import { execFileSync, spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  constants as fsConstants,
  fstatSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readSync,
  realpathSync,
  rmSync,
  statSync,
  writeFileSync,
  closeSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureApplicationBundleIdentity,
  MAX_APPLICATION_BUNDLE_FILE_BYTES,
} from "./perfApplicationBundleIdentity.mjs";
import { parseAutorunPayload, MAX_AUTORUN_PAYLOAD_BYTES } from "./perfAutorunRelay.mjs";
import {
  cleanupPerfFixtureSnapshot,
  createPerfFixtureSnapshot,
  verifyPerfFixtureSnapshot,
} from "./perfFixtureSnapshot.mjs";
import { spawnDirectApplicationSupervisor } from "./perfMacApplicationLauncher.mjs";

export const DEFAULT_PRODUCTION_BUILD_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_PRODUCTION_RUN_TIMEOUT_MS = 20 * 60 * 1000;
export const DEFAULT_PRODUCTION_SMOKE_TIMEOUT_MS = 2 * 60 * 1000;
export const MAX_PRODUCTION_BUILD_TIMEOUT_MS = 60 * 60 * 1000;
export const MAX_PRODUCTION_RUN_TIMEOUT_MS = 30 * 60 * 1000;
export const DEFAULT_APPLICATION_OWNERSHIP_TIMEOUT_MS = 30_000;
export const DEFAULT_APPLICATION_TERMINAL_PROOF_TIMEOUT_MS = 1_000;
const PROCESS_STOP_GRACE_MS = 10_000;
const RESULT_POLL_MS = 50;
const CAPTURE_PREFIX = "codevo-perf-production-";
const OWNERSHIP_FILE = ".codevo-perf-production-owner.json";
const SOURCE_PATHS = Object.freeze([
  "package.json",
  "package-lock.json",
  "index.html",
  "tsconfig.json",
  "tsconfig.app.json",
  "tsconfig.node.json",
  ".env",
  ".env.local",
  ".env.production",
  ".env.production.local",
  ".cargo",
  "rust-toolchain.toml",
  "vite.config.ts",
  "src",
  "scripts/perf",
  "src-tauri",
  "perf/capture-contract.json",
]);
const BUILD_ENV_ALLOWLIST = Object.freeze([
  "AR",
  "CARGO_HOME",
  "CC",
  "CXX",
  "DEVELOPER_DIR",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOGNAME",
  "MACOSX_DEPLOYMENT_TARGET",
  "PATH",
  "RUSTUP_HOME",
  "RUSTUP_TOOLCHAIN",
  "SDKROOT",
  "SHELL",
  "TMPDIR",
  "USER",
]);

export function parseProductionTimeoutMs(value, { flag, maximum }) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0 || parsed > maximum) {
    throw new Error(`${flag} requires a positive integer at or below ${maximum} ms.`);
  }
  return parsed;
}

export function sanitizedProductionEnvironment(source, additions) {
  const sanitized = {};
  for (const name of BUILD_ENV_ALLOWLIST) {
    if (typeof source[name] === "string" && source[name].length > 0) {
      sanitized[name] = source[name];
    }
  }
  return { ...sanitized, ...additions };
}

export function productionBuildPlan({
  repoRoot,
  ownedRoot,
  runToken,
  resultPath,
  workRoot,
  smoke,
}) {
  const targetDir = path.join(ownedRoot, "target");
  const frontendDist = path.join(ownedRoot, "dist");
  const configPath = path.join(ownedRoot, "tauri.perf.json");
  const identifierSuffix = runToken.replaceAll("-", "").slice(0, 24).toLowerCase();
  const bundleId = `dev.mockor.editor.perf.${identifierSuffix}`;
  const config = {
    identifier: bundleId,
    build: { beforeBuildCommand: "", frontendDist },
    bundle: { active: true },
  };
  const env = sanitizedProductionEnvironment(process.env, {
    CARGO_TARGET_DIR: targetDir,
    VITE_CODEVO_PERF_PRODUCTION_CAPTURE: "1",
    VITE_CODEVO_PERF_WINDOW_MODE: smoke ? "always-on-top-diagnostic" : "focus-only",
    CODEVO_PERF_CAPTURE_RUN_TOKEN: runToken,
    CODEVO_PERF_CAPTURE_RESULT_PATH: resultPath,
    CODEVO_PERF_CAPTURE_SHUTDOWN_PATH: path.join(ownedRoot, "shutdown-proof.json"),
    CODEVO_PERF_CAPTURE_SMOKE: smoke ? "1" : "0",
    CODEVO_PERF_CAPTURE_WORK_ROOT: workRoot,
  });

  writeFileSync(configPath, `${JSON.stringify(config)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });

  return Object.freeze({
    command: resolvePinnedTauriCli(repoRoot),
    args: [
      "build",
      "--bundles",
      "app",
      "--no-sign",
      "--features",
      "perf-capture",
      "--config",
      configPath,
    ],
    cwd: repoRoot,
    env,
    frontendPlan: Object.freeze({
      command: process.execPath,
      args: [resolvePinnedViteEntry(repoRoot), "build", "--outDir", frontendDist, "--emptyOutDir"],
      cwd: repoRoot,
      env,
    }),
    launcherBuildPlan: Object.freeze({
      command: "cargo",
      args: [
        "build",
        "--release",
        "--example",
        "codevo-perf-capture-launcher",
        "--features",
        "perf-capture-launcher",
      ],
      cwd: path.join(repoRoot, "src-tauri"),
      env,
    }),
    configPath,
    targetDir,
    executablePath: productionExecutablePath(targetDir),
    appBundlePath: productionApplicationBundlePath(targetDir),
    launcherExecutablePath: path.join(
      targetDir,
      "release",
      "examples",
      "codevo-perf-capture-launcher",
    ),
    bundleId,
  });
}

export function resolvePinnedTauriCli(repoRoot) {
  const nodeModulesRoot = realpathSync(path.join(repoRoot, "node_modules"));
  const executable = realpathSync(path.join(nodeModulesRoot, ".bin", "tauri"));
  const stat = statSync(executable);
  if (
    !stat.isFile() ||
    (stat.mode & 0o111) === 0 ||
    !executable.startsWith(`${nodeModulesRoot}${path.sep}`)
  ) {
    throw new Error("The repository-pinned Tauri CLI is unavailable or escaped node_modules.");
  }
  return executable;
}

export function resolvePinnedViteEntry(repoRoot) {
  const nodeModulesRoot = realpathSync(path.join(repoRoot, "node_modules"));
  const entry = realpathSync(path.join(nodeModulesRoot, "vite", "bin", "vite.js"));
  const stat = statSync(entry);
  if (!stat.isFile() || !entry.startsWith(`${nodeModulesRoot}${path.sep}`)) {
    throw new Error("The repository-pinned Vite entry is unavailable or escaped node_modules.");
  }
  return entry;
}

export function productionExecutablePath(targetDir, platform = process.platform) {
  if (platform !== "darwin") {
    throw new Error(
      `Production performance capture currently supports macOS only, got ${platform}.`,
    );
  }
  return path.join(
    targetDir,
    "release",
    "bundle",
    "macos",
    "Codevo Editor.app",
    "Contents",
    "MacOS",
    "codevo-editor",
  );
}

export function productionApplicationBundlePath(targetDir, platform = process.platform) {
  return path.resolve(productionExecutablePath(targetDir, platform), "..", "..", "..");
}

export async function runProductionCaptureLane({
  repoRoot,
  smoke,
  buildTimeoutMs = DEFAULT_PRODUCTION_BUILD_TIMEOUT_MS,
  runTimeoutMs = DEFAULT_PRODUCTION_RUN_TIMEOUT_MS,
  signal,
  onProcessOwned = () => {},
  dependencies = {},
}) {
  const deps = productionDependencies(dependencies);
  const ownedRootRecord = deps.makeOwnedRoot();
  const ownedRoot = typeof ownedRootRecord === "string" ? ownedRootRecord : ownedRootRecord.path;
  const resultPath = path.join(ownedRoot, "capture-result.json");
  let runToken;
  let snapshot = null;
  let app = null;
  const ownedProcesses = [];
  let outcome;

  try {
    throwIfAborted(signal);
    runToken = deps.randomToken();
    const sourceRevision = deps.readSourceRevision(repoRoot);
    snapshot = deps.createSnapshot(path.join(repoRoot, "perf", "fixtures"));
    const runtimeHome = path.join(ownedRoot, "profile-home");
    const runtimeTemp = path.join(ownedRoot, "runtime-temp");
    mkdirSync(runtimeHome, { mode: 0o700 });
    mkdirSync(runtimeTemp, { mode: 0o700 });
    const plan = deps.createBuildPlan({
      repoRoot,
      ownedRoot,
      runToken,
      resultPath,
      workRoot: snapshot.workRoot,
      smoke,
    });
    const buildDeadline = Date.now() + buildTimeoutMs;
    const frontendBuild = deps.launchProcess(plan.frontendPlan);
    ownedProcesses.push(frontendBuild);
    onProcessOwned(frontendBuild);
    const frontendStatus = await awaitOwnedProcess(frontendBuild, {
      timeoutMs: remainingTimeout(buildDeadline, "Production frontend build"),
      operation: "Production frontend build",
      signal,
    });
    assertSuccessfulExit(frontendStatus, "Production frontend build");
    await frontendBuild.stop();
    const build = deps.launchProcess(plan);
    ownedProcesses.push(build);
    onProcessOwned(build);
    const buildStatus = await awaitOwnedProcess(build, {
      timeoutMs: remainingTimeout(buildDeadline, "Production Tauri build"),
      operation: "Production performance build",
      signal,
    });
    assertSuccessfulExit(buildStatus, "Production performance build");
    await build.stop();
    const launcherBuild = deps.launchProcess(plan.launcherBuildPlan);
    ownedProcesses.push(launcherBuild);
    onProcessOwned(launcherBuild);
    const launcherBuildStatus = await awaitOwnedProcess(launcherBuild, {
      timeoutMs: remainingTimeout(buildDeadline, "Production application supervisor build"),
      operation: "Production application supervisor build",
      signal,
    });
    assertSuccessfulExit(launcherBuildStatus, "Production application supervisor build");
    await launcherBuild.stop();
    const executablePath = assertRegularOwnedExecutable(plan.executablePath, plan.targetDir);
    const launcherExecutablePath = assertRegularOwnedExecutable(
      plan.launcherExecutablePath,
      plan.targetDir,
    );
    const appBundlePath = assertOwnedApplicationBundle(plan.appBundlePath, plan.targetDir);
    const artifactSha256 = deps.hashFile(executablePath);
    const bundleIdentity = deps.captureBundleIdentity(appBundlePath);
    const processOwnerTag = createHash("sha256")
      .update("codevo-production-process-owner\0")
      .update(runToken)
      .digest("hex");
    const artifactStat = statSync(executablePath);
    if (deps.readSourceRevision(repoRoot) !== sourceRevision) {
      throw new Error("Production performance source changed while the artifact was built.");
    }
    if (typeof ownedRootRecord !== "string") {
      verifyOwnedCaptureRoot(ownedRootRecord);
    }
    throwIfAborted(signal);

    app = deps.launchApp({
      command: launcherExecutablePath,
      args: [
        appBundlePath,
        executablePath,
        plan.bundleId,
        artifactSha256,
        bundleIdentity.digest,
        String(artifactStat.dev),
        String(artifactStat.ino),
        runToken,
        processOwnerTag,
      ],
      cwd: ownedRoot,
      env: sanitizedProductionEnvironment(process.env, {
        HOME: runtimeHome,
        TMPDIR: runtimeTemp,
        CODEVO_PERF_CAPTURE_PROCESS_OWNER: processOwnerTag,
      }),
      expectedIdentity: Object.freeze({
        artifactSha256,
        bundleManifestSha256: bundleIdentity.digest,
        bundleId: plan.bundleId,
        bundlePath: appBundlePath,
        executablePath,
        runToken,
      }),
    });
    ownedProcesses.push(app);
    onProcessOwned(app);
    await awaitApplicationOwnership(app, {
      timeoutMs: deps.applicationOwnershipTimeoutMs,
      signal,
    });
    const raw = await awaitCaptureResult({
      resultPath,
      app,
      timeoutMs: runTimeoutMs,
      signal,
      deps,
    });
    const payload = parseAutorunPayload(raw);
    if (payload.kind !== "result") {
      throw new Error(
        payload.kind === "error"
          ? `Production performance capture failed inside the app: ${payload.message}`
          : `Production performance capture rejected the result: ${payload.message}`,
      );
    }
    const fixtureVerification = deps.verifySnapshot(snapshot);
    if (fixtureVerification.failure !== null) {
      throw new Error(fixtureVerification.failure);
    }
    if (deps.hashFile(executablePath) !== artifactSha256) {
      throw new Error("Production performance executable changed while the capture was running.");
    }
    const finalBundleIdentity = deps.captureBundleIdentity(appBundlePath);
    if (!sameBundleIdentity(finalBundleIdentity, bundleIdentity)) {
      throw new Error(
        "Production performance application bundle changed while the capture was running.",
      );
    }
    outcome = {
      status: "ok",
      result: payload.result,
      artifactSha256,
      bundleManifestSha256: bundleIdentity.digest,
      captureEnvironment: Object.freeze({
        artifactSha256,
        bundleManifestSha256: bundleIdentity.digest,
        captureFlavor: "production-instrumented",
        hostArch: process.arch,
        hostPlatform: process.platform,
        launchState: "cold-fresh-profile",
        osRelease: os.release(),
        sourceRevision,
        workspaceState: "fixture-clean",
      }),
      fixtureMetadata: fixtureVerification.metadata,
    };
  } catch (error) {
    outcome = { status: "failed", message: messageOf(error) };
  } finally {
    if (signal?.aborted) {
      outcome = { status: "failed", message: "Production performance capture was cancelled." };
    }
    const cleanupErrors = [];
    let processCleanupFailed = false;
    for (const processHandle of ownedProcesses.toReversed()) {
      try {
        await processHandle.stop();
        if (processHandle === app) {
          await requireApplicationTerminalProof(app, {
            timeoutMs: deps.applicationTerminalProofTimeoutMs,
          });
        }
      } catch (error) {
        processCleanupFailed = true;
        cleanupErrors.push(`process cleanup failed: ${messageOf(error)}`);
      }
    }
    if (!processCleanupFailed && snapshot !== null) {
      try {
        deps.cleanupSnapshot(snapshot);
      } catch (error) {
        cleanupErrors.push(`fixture cleanup failed: ${messageOf(error)}`);
      }
    }
    if (!processCleanupFailed) {
      try {
        deps.removeOwnedRoot(ownedRootRecord);
      } catch (error) {
        cleanupErrors.push(`capture cleanup failed: ${messageOf(error)}`);
      }
    }
    if (cleanupErrors.length > 0) {
      const cleanupMessage = cleanupErrors.join("; ");
      outcome = {
        status: "failed",
        message:
          outcome?.status === "failed" ? `${outcome.message}; ${cleanupMessage}` : cleanupMessage,
      };
    }
    if (signal?.aborted && !outcome?.message?.includes("was cancelled")) {
      outcome = {
        status: "failed",
        message:
          outcome?.status === "failed"
            ? `Production performance capture was cancelled; ${outcome.message}`
            : "Production performance capture was cancelled.",
      };
    }
  }
  return outcome;
}

export function spawnOwnedProcess(plan, spawnProcess = spawn) {
  const child = spawnProcess(plan.command, plan.args, {
    cwd: plan.cwd,
    detached: true,
    env: plan.env,
    stdio: "inherit",
  });
  let running = true;
  let terminationRequested = false;
  let stopPromise = null;
  let settle;
  const exited = new Promise((resolve) => {
    settle = resolve;
  });
  const finish = (status) => {
    if (!running) return;
    running = false;
    settle(status);
  };
  child.once("exit", (code, childSignal) => finish({ code, signal: childSignal, error: null }));
  child.once("error", (error) => finish({ code: null, signal: null, error: messageOf(error) }));
  return {
    exited,
    interrupt({ kill = process.kill } = {}) {
      if (terminationRequested || !Number.isInteger(child.pid) || child.pid <= 0) return;
      signalOwnedGroup(child.pid, "SIGTERM", kill);
      terminationRequested = true;
    },
    stop({
      delay = defaultDelay,
      kill = process.kill,
      groupAlive = ownedGroupAlive,
      now = Date.now,
    } = {}) {
      if (stopPromise !== null) return stopPromise;
      stopPromise = (async () => {
        if (!Number.isInteger(child.pid) || child.pid <= 0) return;
        if (!terminationRequested) {
          signalOwnedGroup(child.pid, "SIGTERM", kill);
          terminationRequested = true;
        }
        if (
          await waitForOwnedGroupExit(child.pid, {
            delay,
            groupAlive,
            kill,
            now,
            timeoutMs: PROCESS_STOP_GRACE_MS,
          })
        ) {
          return;
        }
        signalOwnedGroup(child.pid, "SIGKILL", kill);
        if (
          !(await waitForOwnedGroupExit(child.pid, {
            delay,
            groupAlive,
            kill,
            now,
            timeoutMs: PROCESS_STOP_GRACE_MS,
          }))
        ) {
          throw new Error(
            "Owned process group survived SIGKILL and the final cleanup grace period.",
          );
        }
        finish({ code: null, signal: "SIGKILL", error: "owned process group did not report exit" });
      })();
      return stopPromise;
    },
  };
}

async function awaitOwnedProcess(processHandle, { timeoutMs, operation, signal }) {
  const race = raceWithTimeoutAndAbort(processHandle.exited, timeoutMs, signal);
  const outcome = await race.promise;
  race.dispose();
  if (outcome.kind === "value") return outcome.value;
  await processHandle.stop();
  throw new Error(
    outcome.kind === "aborted"
      ? `${operation} was cancelled.`
      : `${operation} timed out after ${timeoutMs} ms.`,
  );
}

function remainingTimeout(deadline, operation) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error(`${operation} exceeded the shared build timeout.`);
  return remaining;
}

async function awaitCaptureResult({ resultPath, app, timeoutMs, signal, deps }) {
  const localAbort = new AbortController();
  const relayAbort = () => localAbort.abort();
  if (signal?.aborted) relayAbort();
  else signal?.addEventListener("abort", relayAbort, { once: true });
  let outcome;
  try {
    const result = deps.waitForResult(resultPath, { timeoutMs, signal: localAbort.signal });
    outcome = await Promise.race([
      result.then((value) => ({ kind: "result", value })),
      app.exited.then((status) => ({ kind: "exit", status })),
    ]);
  } finally {
    localAbort.abort();
    signal?.removeEventListener("abort", relayAbort);
  }
  if (outcome.kind === "result") return outcome.value;
  throw new Error(
    `Production performance app exited before publishing a result (${describeExit(outcome.status)}).`,
  );
}

export async function waitForAtomicResult(
  resultPath,
  { timeoutMs, signal, pollMs = RESULT_POLL_MS, delay = defaultDelay } = {},
) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    throwIfAborted(signal);
    try {
      const stat = lstatSync(resultPath);
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new Error("Production performance result is not a regular file.");
      }
      if (stat.size <= 0 || stat.size > MAX_AUTORUN_PAYLOAD_BYTES) {
        throw new Error("Production performance result exceeded its bounded payload contract.");
      }
      const descriptor = openSync(resultPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
      try {
        const opened = fstatSync(descriptor);
        if (
          !opened.isFile() ||
          opened.dev !== stat.dev ||
          opened.ino !== stat.ino ||
          opened.size !== stat.size ||
          opened.size <= 0 ||
          opened.size > MAX_AUTORUN_PAYLOAD_BYTES
        ) {
          throw new Error("Production performance result changed outside its bounded contract.");
        }
        const raw = readFileSync(descriptor, "utf8");
        const after = fstatSync(descriptor);
        if (after.dev !== opened.dev || after.ino !== opened.ino || after.size !== opened.size) {
          throw new Error("Production performance result changed while it was read.");
        }
        return raw;
      } finally {
        closeSync(descriptor);
      }
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`Production performance capture timed out after ${timeoutMs} ms.`);
    }
    await delay(Math.min(pollMs, Math.max(1, deadline - Date.now())));
  }
}

function productionDependencies(overrides) {
  return {
    makeOwnedRoot: overrides.makeOwnedRoot ?? createOwnedCaptureRoot,
    removeOwnedRoot: overrides.removeOwnedRoot ?? removeOwnedCaptureRoot,
    randomToken: overrides.randomToken ?? randomUUID,
    createSnapshot: overrides.createSnapshot ?? createPerfFixtureSnapshot,
    verifySnapshot: overrides.verifySnapshot ?? verifyPerfFixtureSnapshot,
    cleanupSnapshot: overrides.cleanupSnapshot ?? cleanupPerfFixtureSnapshot,
    createBuildPlan: overrides.createBuildPlan ?? productionBuildPlan,
    launchProcess: overrides.launchProcess ?? ((plan) => spawnOwnedProcess(plan)),
    launchApp: overrides.launchApp ?? ((plan) => spawnDirectApplicationSupervisor(plan)),
    waitForResult: overrides.waitForResult ?? waitForAtomicResult,
    hashFile: overrides.hashFile ?? sha256File,
    captureBundleIdentity: overrides.captureBundleIdentity ?? captureApplicationBundleIdentity,
    readSourceRevision: overrides.readSourceRevision ?? readSourceRevision,
    applicationOwnershipTimeoutMs: boundedInternalTimeout(
      overrides.applicationOwnershipTimeoutMs,
      DEFAULT_APPLICATION_OWNERSHIP_TIMEOUT_MS,
      "application ownership timeout",
    ),
    applicationTerminalProofTimeoutMs: boundedInternalTimeout(
      overrides.applicationTerminalProofTimeoutMs,
      DEFAULT_APPLICATION_TERMINAL_PROOF_TIMEOUT_MS,
      "application terminal-proof timeout",
    ),
  };
}

async function awaitApplicationOwnership(app, { timeoutMs, signal }) {
  const race = raceWithTimeoutAndAbort(app.ready, timeoutMs, signal);
  let outcome;
  try {
    outcome = await race.promise;
  } finally {
    race.dispose();
  }
  if (outcome.kind === "value") return outcome.value;
  let interruptFailure = "";
  try {
    app.interrupt?.();
  } catch (error) {
    interruptFailure = ` Supervisor interrupt failed: ${messageOf(error)}`;
  }
  throw new Error(
    `${
      outcome.kind === "aborted"
        ? "Production application ownership was cancelled."
        : `Production application ownership timed out after ${timeoutMs} ms.`
    }${interruptFailure}`,
  );
}

async function requireApplicationTerminalProof(app, { timeoutMs }) {
  if (!app || typeof app !== "object" || !(app.exited instanceof Promise)) {
    throw new Error("Production application supervisor did not expose terminal cleanup proof.");
  }
  const race = raceWithTimeoutAndAbort(app.exited, timeoutMs);
  let outcome;
  try {
    outcome = await race.promise;
  } finally {
    race.dispose();
  }
  if (outcome.kind !== "value") {
    throw new Error(
      "Production application supervisor cleanup completed without bounded terminal proof; owned roots were preserved.",
    );
  }
  const status = outcome.value;
  if (!status || status.error !== null || status.code !== 0 || status.signal !== null) {
    throw new Error(
      `Production application supervisor cleanup was not proven (${describeExit(status ?? {})}); owned roots were preserved.`,
    );
  }
}

function boundedInternalTimeout(value, fallback, label) {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) {
    throw new Error(`${label} must be a positive integer at or below ${fallback} ms.`);
  }
  return value;
}

function sameBundleIdentity(left, right) {
  return (
    left?.schemaVersion === 1 &&
    right?.schemaVersion === 1 &&
    left.digest === right.digest &&
    left.entryCount === right.entryCount &&
    left.fileCount === right.fileCount &&
    left.totalBytes === right.totalBytes
  );
}

function assertRegularOwnedExecutable(executablePath, targetDir) {
  const canonicalTarget = realpathSync(targetDir);
  const stat = lstatSync(executablePath);
  if (stat.isSymbolicLink() || !stat.isFile() || (stat.mode & 0o111) === 0) {
    throw new Error("Production performance build did not produce a regular executable.");
  }
  const canonicalExecutable = realpathSync(executablePath);
  if (!canonicalExecutable.startsWith(`${canonicalTarget}${path.sep}`)) {
    throw new Error("Production performance executable escaped its owned build directory.");
  }
  return canonicalExecutable;
}

function assertOwnedApplicationBundle(bundlePath, targetDir) {
  const canonicalTarget = realpathSync(targetDir);
  const stat = lstatSync(bundlePath);
  if (
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
    (stat.mode & 0o022) !== 0
  ) {
    throw new Error("Production performance build did not produce a regular app bundle.");
  }
  const canonicalBundle = realpathSync(bundlePath);
  if (!canonicalBundle.startsWith(`${canonicalTarget}${path.sep}`)) {
    throw new Error("Production performance app bundle escaped its owned build directory.");
  }
  return canonicalBundle;
}

export function sha256File(filePath) {
  const before = lstatSync(filePath, { bigint: true });
  if (
    before.isSymbolicLink() ||
    !before.isFile() ||
    before.size > BigInt(MAX_APPLICATION_BUNDLE_FILE_BYTES)
  ) {
    throw new Error("Production performance executable exceeded its bounded file contract.");
  }
  const descriptor = openSync(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  try {
    const opened = fstatSync(descriptor, { bigint: true });
    assertSameRegularFileIdentity(before, opened);
    const digest = createHash("sha256");
    const buffer = Buffer.allocUnsafe(64 * 1024);
    let total = 0;
    for (;;) {
      const read = readSync(descriptor, buffer, 0, buffer.length, null);
      if (read === 0) break;
      total += read;
      if (total > MAX_APPLICATION_BUNDLE_FILE_BYTES) {
        throw new Error("Production performance executable exceeded its bounded read contract.");
      }
      digest.update(buffer.subarray(0, read));
    }
    const after = fstatSync(descriptor, { bigint: true });
    assertSameRegularFileIdentity(before, after);
    assertSameRegularFileIdentity(before, lstatSync(filePath, { bigint: true }));
    if (BigInt(total) !== before.size) {
      throw new Error("Production performance executable changed while it was hashed.");
    }
    return digest.digest("hex");
  } finally {
    closeSync(descriptor);
  }
}

function assertSameRegularFileIdentity(expected, actual) {
  if (
    !actual.isFile() ||
    actual.dev !== expected.dev ||
    actual.ino !== expected.ino ||
    actual.size !== expected.size ||
    actual.mode !== expected.mode ||
    actual.ctimeNs !== expected.ctimeNs
  ) {
    throw new Error("Production performance executable identity changed while it was hashed.");
  }
}

function readSourceRevision(repoRoot) {
  const options = {
    cwd: repoRoot,
    env: sanitizedProductionEnvironment(process.env, {}),
    timeout: 15_000,
    maxBuffer: 64 * 1024 * 1024,
  };
  const head = execFileSync("git", ["rev-parse", "HEAD"], options);
  const diff = execFileSync("git", ["diff", "--binary", "HEAD", "--", ...SOURCE_PATHS], options);
  const untracked = execFileSync(
    "git",
    ["ls-files", "--others", "--exclude-standard", "-z", "--", ...SOURCE_PATHS],
    options,
  );
  const digest = createHash("sha256").update(head).update(diff);
  for (const relativePath of untracked.toString("utf8").split("\0").filter(Boolean).sort()) {
    const absolutePath = path.join(repoRoot, relativePath);
    const stat = lstatSync(absolutePath);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Production source identity rejected non-regular input ${relativePath}.`);
    }
    digest.update(relativePath).update("\0").update(readFileSync(absolutePath));
  }
  return digest.digest("hex");
}

export function createOwnedCaptureRoot({
  temporaryParent = os.tmpdir(),
  createDirectory = mkdtempSync,
  writeMarker = writeFileSync,
  remove = rmSync,
} = {}) {
  const parent = realpathSync(temporaryParent);
  const root = realpathSync(createDirectory(path.join(parent, CAPTURE_PREFIX)));
  const token = randomUUID();
  const stat = lstatSync(root);
  const markerPath = path.join(root, OWNERSHIP_FILE);
  try {
    if (
      (typeof process.getuid === "function" && stat.uid !== process.getuid()) ||
      (stat.mode & 0o077) !== 0
    ) {
      throw new Error("Production capture root ownership or permissions were rejected.");
    }
    writeMarker(markerPath, `${JSON.stringify({ schemaVersion: 1, token })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
  } catch (error) {
    try {
      const current = lstatSync(root);
      if (current.dev === stat.dev && current.ino === stat.ino && current.isDirectory()) {
        remove(root, { recursive: true, force: false });
      }
    } catch {
      // Preserve the marker creation error; exact-root rollback was best effort.
    }
    throw error;
  }
  return Object.freeze({
    path: root,
    parent,
    token,
    dev: stat.dev,
    ino: stat.ino,
    uid: stat.uid,
    mode: stat.mode,
  });
}

export function removeOwnedCaptureRoot(record) {
  verifyOwnedCaptureRoot(record);
  rmSync(record.path, { recursive: true, force: false });
}

export function verifyOwnedCaptureRoot(record) {
  if (!record || typeof record !== "object") {
    throw new Error("Refusing production capture access without exact ownership.");
  }
  const parent = realpathSync(record.parent);
  const stat = lstatSync(record.path);
  if (
    parent !== record.parent ||
    path.dirname(record.path) !== parent ||
    !path.basename(record.path).startsWith(CAPTURE_PREFIX) ||
    stat.isSymbolicLink() ||
    !stat.isDirectory() ||
    stat.dev !== record.dev ||
    stat.ino !== record.ino ||
    stat.uid !== record.uid ||
    stat.mode !== record.mode ||
    (stat.mode & 0o077) !== 0
  ) {
    throw new Error("Refusing access to a replaced production capture root.");
  }
  const marker = JSON.parse(readFileSync(path.join(record.path, OWNERSHIP_FILE), "utf8"));
  if (marker?.schemaVersion !== 1 || marker?.token !== record.token) {
    throw new Error("Refusing access to a production capture root owned by another run.");
  }
}

function signalOwnedGroup(pid, signal, kill) {
  if (!Number.isInteger(pid) || pid <= 0) return;
  try {
    kill(-pid, signal);
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw new Error(`Failed to send ${signal} to the owned process group: ${messageOf(error)}`);
  }
}

async function waitForOwnedGroupExit(pid, { delay, groupAlive, kill, now, timeoutMs }) {
  const deadline = now() + timeoutMs;
  while (groupAlive(pid, kill)) {
    const remaining = deadline - now();
    if (remaining <= 0) return false;
    await delay(Math.min(50, remaining));
  }
  return true;
}

function ownedGroupAlive(pid, kill) {
  try {
    kill(-pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function assertSuccessfulExit(status, operation) {
  if (status.error) throw new Error(`${operation} launch failed: ${status.error}`);
  if (status.code !== 0) {
    throw new Error(`${operation} failed with code ${status.code}, signal ${status.signal}.`);
  }
}

function describeExit(status) {
  return status.error
    ? `launch failed: ${status.error}`
    : `code ${status.code}, signal ${status.signal}`;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw new Error("Production performance capture was cancelled.");
}

function raceWithTimeoutAndAbort(promise, timeoutMs, signal) {
  let timer;
  let abortListener;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ kind: "timeout" }), timeoutMs);
  });
  const aborted = signal
    ? new Promise((resolve) => {
        abortListener = () => resolve({ kind: "aborted" });
        if (signal.aborted) abortListener();
        else signal.addEventListener("abort", abortListener, { once: true });
      })
    : new Promise(() => {});
  return {
    promise: Promise.race([promise.then((value) => ({ kind: "value", value })), timeout, aborted]),
    dispose() {
      clearTimeout(timer);
      if (abortListener) signal?.removeEventListener("abort", abortListener);
    },
  };
}

function defaultDelay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function messageOf(error) {
  return error instanceof Error ? error.message : String(error);
}

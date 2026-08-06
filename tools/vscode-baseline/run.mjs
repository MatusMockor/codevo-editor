import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFixtureHashes, fixtureHashFenceFailure } from "../../scripts/perf/fixtureHash.mjs";
import {
  MAX_CAPTURE_JSON_BYTES,
  PERF_CAPTURE_CONTRACT,
  PERF_CAPTURE_CONTRACT_METADATA,
  parseCaptureRunJson,
  validateCaptureRun,
} from "../../scripts/perf/perfCaptureContract.mjs";
import { FIXTURE_VERSION } from "../../scripts/perf/perfScenarios.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const extensionDir = path.join(repoRoot, "tools/vscode-baseline");
const largeFilesRoot = path.join(repoRoot, "perf/fixtures/large-files");
const monorepoRoot = path.join(repoRoot, "perf/fixtures/monorepo");
const EXPECTED_SCENARIO_IDS = PERF_CAPTURE_CONTRACT.scenarios
  .filter((scenario) => scenario.cutPointByEditor.vscode !== null)
  .map((scenario) => scenario.id);
const EXPECTED_SCENARIO_IDS_BY_ROOT = Object.freeze({
  "large-files": EXPECTED_SCENARIO_IDS.filter((id) => id !== "file-search-engine"),
  monorepo: ["file-search-engine"],
});
const PROCESS_EXIT_GRACE_MS = 5000;

function findMissingScenarioIds(scenarios) {
  const presentIds = new Set(scenarios.map((scenario) => scenario.id));
  return EXPECTED_SCENARIO_IDS.filter((id) => !presentIds.has(id));
}

export function validateCapturedScenarios(label, captured, validateContract = false) {
  if (!captured || typeof captured !== "object" || Array.isArray(captured)) {
    throw new Error(label + " capture must be a JSON object");
  }
  if (!captured.environment || typeof captured.environment !== "object") {
    throw new Error(label + " capture carries no environment block");
  }
  if (!Array.isArray(captured.scenarios)) {
    throw new Error(label + " capture carries no scenarios array");
  }

  const expectedIds = EXPECTED_SCENARIO_IDS_BY_ROOT[label];
  if (!expectedIds) {
    throw new Error("unknown capture root label: " + label);
  }
  const expected = new Set(expectedIds);
  const seen = new Set();
  for (const scenario of captured.scenarios) {
    const id = scenario && typeof scenario === "object" ? scenario.id : null;
    if (typeof id !== "string" || id.length === 0) {
      throw new Error(label + " capture contains a scenario without a non-empty id");
    }
    if (seen.has(id)) {
      throw new Error(label + " capture contains duplicate scenario id: " + id);
    }
    if (!expected.has(id)) {
      throw new Error(label + " capture contains foreign scenario id: " + id);
    }
    seen.add(id);
  }

  const missing = expectedIds.filter((id) => !seen.has(id));
  if (missing.length > 0) {
    throw new Error(label + " capture is missing scenario ids: " + missing.join(", "));
  }
  if (validateContract) {
    const contractFailures = validateCaptureRun(captured, { expectedEditor: "vscode" });
    if (contractFailures.length > 0) {
      throw new Error(
        label + " capture violates the canonical contract: " + contractFailures.join(" "),
      );
    }
  }
  return captured;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForOutput(outPath, budgetMilliseconds, readLaunchError = () => null) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMilliseconds) {
    const launchError = readLaunchError();
    if (launchError) {
      throw launchError;
    }
    if (fs.existsSync(outPath)) {
      return true;
    }
    await sleep(2000);
  }
  return fs.existsSync(outPath);
}

export function captureExitBeforeOutputError(label, outPath, exitCode, signal, fileSystem = fs) {
  if (fileSystem.existsSync(outPath)) {
    return null;
  }
  const outcome = signal === null ? "exit code " + String(exitCode) : "signal " + String(signal);
  return new Error(
    label +
      " VS Code process exited before publishing its capture output (" +
      outcome +
      "). Check the inherited extension-host error output above.",
  );
}

function readBoundedUtf8File(filePath, maxBytes) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(descriptor).size;
    if (size > maxBytes) {
      throw new Error(
        "capture output exceeds the " + maxBytes + " byte limit (received " + size + " bytes)",
      );
    }
    const bytes = Buffer.alloc(size);
    const bytesRead = fs.readSync(descriptor, bytes, 0, size, 0);
    if (bytesRead !== size) {
      throw new Error("capture output changed while it was being read");
    }
    return bytes.toString("utf8");
  } finally {
    fs.closeSync(descriptor);
  }
}

export function readBoundedJsonFile(filePath, maxBytes = MAX_CAPTURE_JSON_BYTES) {
  return JSON.parse(readBoundedUtf8File(filePath, maxBytes));
}

export function readBoundedCaptureFile(filePath) {
  return parseCaptureRunJson(readBoundedUtf8File(filePath, MAX_CAPTURE_JSON_BYTES), {
    expectedEditor: "vscode",
    enforceCanonicalScenarios: false,
  });
}

function seedIsolatedProfile(userDataDir) {
  const userDir = path.join(userDataDir, "User");
  fs.mkdirSync(userDir, { recursive: true });
  const settings = {
    "security.workspace.trust.enabled": false,
    "update.mode": "none",
    "workbench.startupEditor": "none",
    "extensions.autoCheckUpdates": false,
    "extensions.autoUpdate": false,
    "telemetry.telemetryLevel": "off",
    "chat.disableAIFeatures": true,
    "chat.allowAnonymousAccess": false,
  };
  fs.writeFileSync(path.join(userDir, "settings.json"), JSON.stringify(settings, null, 2) + "\n");
}

function signalOwnedProcessTree(processGroupId, signal) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
    return;
  }
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", [
        "/PID",
        String(processGroupId),
        "/T",
        ...(signal === "SIGKILL" ? ["/F"] : []),
      ]);
      return;
    }
    process.kill(-processGroupId, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") {
      throw error;
    }
  }
}

function ownedProcessTreeExists(processGroupId) {
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
    return false;
  }
  if (process.platform === "win32") {
    return true;
  }
  try {
    process.kill(-processGroupId, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

function waitForOwnedProcessTreeExit(processGroupId, timeoutMs) {
  if (!ownedProcessTreeExists(processGroupId)) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    const deadline = Date.now() + timeoutMs;
    const inspect = () => {
      if (!ownedProcessTreeExists(processGroupId)) {
        resolve(true);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(false);
        return;
      }
      setTimeout(inspect, 25);
    };
    inspect();
  });
}

export async function terminateOwnedProcessTree(child, graceMs = PROCESS_EXIT_GRACE_MS) {
  const processGroupId = child?.pid;
  if (!Number.isInteger(processGroupId) || processGroupId <= 0) {
    return;
  }
  if (await waitForOwnedProcessTreeExit(processGroupId, graceMs)) {
    return;
  }
  signalOwnedProcessTree(processGroupId, "SIGTERM");
  if (await waitForOwnedProcessTreeExit(processGroupId, graceMs)) {
    return;
  }
  signalOwnedProcessTree(processGroupId, "SIGKILL");
  await waitForOwnedProcessTreeExit(processGroupId, graceMs);
}

function ipcSafeTmpDir() {
  if (process.platform === "win32") {
    return os.tmpdir();
  }

  return "/tmp";
}

function aggregateDigest(hashes) {
  const digest = createHash("sha256");
  for (const relativePath of Object.keys(hashes).sort()) {
    digest.update(relativePath + ":" + hashes[relativePath] + "\n");
  }
  return digest.digest("hex");
}

function collectFixtureHashes() {
  const hashes = {};
  const largeFileHashes = computeFixtureHashes(largeFilesRoot);
  for (const relativePath of Object.keys(largeFileHashes).sort()) {
    hashes["large-files/" + relativePath] = largeFileHashes[relativePath];
  }
  hashes["monorepo/"] = aggregateDigest(computeFixtureHashes(monorepoRoot));
  return hashes;
}

export function resolveExecutableIdentity(command) {
  let resolved = path.isAbsolute(command)
    ? command
    : command.includes(path.sep)
      ? path.resolve(command)
      : null;
  if (resolved === null) {
    const lookup = spawnSync(process.platform === "win32" ? "where" : "which", [command], {
      encoding: "utf8",
    });
    if (!lookup.error && lookup.status === 0 && typeof lookup.stdout === "string") {
      resolved = lookup.stdout.trim().split(/\r?\n/)[0];
    }
  }
  if (!resolved) {
    throw new Error("VS Code executable could not be resolved: " + command);
  }
  const launchPath = fs.realpathSync(resolved);
  const appRoot = findMacOsAppRoot(launchPath);
  const nativeExecutable = appRoot ? path.join(appRoot, "Contents/MacOS/Code") : launchPath;
  const artifactFiles = appRoot
    ? [
        ["cli-launcher", launchPath],
        ["native-executable", nativeExecutable],
        ["product-identity", path.join(appRoot, "Contents/Resources/app/product.json")],
        ["product-package", path.join(appRoot, "Contents/Resources/app/package.json")],
      ]
    : [["invoked-executable", launchPath]];
  for (const [, artifactPath] of artifactFiles) {
    if (!fs.statSync(artifactPath).isFile()) {
      throw new Error("VS Code artifact identity path is not a file: " + artifactPath);
    }
  }
  const digest = createHash("sha256");
  for (const [label, artifactPath] of artifactFiles) {
    const fileDigest = createHash("sha256").update(fs.readFileSync(artifactPath)).digest("hex");
    digest.update(label + ":" + fileDigest + "\n");
  }
  return {
    command: launchPath,
    launchPath,
    realPath: fs.realpathSync(nativeExecutable),
    artifactSha256: digest.digest("hex"),
    artifactIdentity: appRoot ? "macos-app-native+product+package+launcher" : "invoked-executable",
  };
}

function findMacOsAppRoot(executablePath) {
  let candidate = path.dirname(executablePath);
  while (candidate !== path.dirname(candidate)) {
    if (candidate.endsWith(".app")) {
      return candidate;
    }
    candidate = path.dirname(candidate);
  }
  return null;
}

function readVscodeRelease(command) {
  const result = spawnSync(command, ["--version"], { encoding: "utf8" });
  if (result.error || result.status !== 0) {
    throw new Error(
      "Failed to read VS Code release identity: " +
        String(result.error?.message ?? result.stderr?.trim() ?? "unknown error"),
    );
  }
  const lines = result.stdout.trim().split("\n");
  return { version: lines[0] ?? "", commit: lines[1] ?? "", arch: lines[2] ?? "" };
}

function mergeEnvironments(fragments, release, capturedAt) {
  const first = fragments[0];
  for (const fragment of fragments) {
    if (
      fragment.editor !== first.editor ||
      fragment.platform !== first.platform ||
      fragment.hostPlatform !== first.hostPlatform ||
      fragment.hostArch !== first.hostArch ||
      fragment.windowMode !== first.windowMode ||
      fragment.sourceRevision !== first.sourceRevision ||
      fragment.artifactSha256 !== first.artifactSha256 ||
      fragment.artifactIdentity !== first.artifactIdentity ||
      fragment.executableIdentity !== first.executableIdentity
    ) {
      throw new Error(
        "capture windows disagree on environment: " +
          JSON.stringify(first) +
          " vs " +
          JSON.stringify(fragment),
      );
    }
    if (fragment.version !== release.version) {
      throw new Error(
        "extension host reported VS Code " +
          fragment.version +
          " but the code CLI reported " +
          release.version,
      );
    }
  }
  const timerQuantizationMs = fragments.reduce(
    (worst, fragment) => Math.max(worst, fragment.timerQuantizationMs),
    0,
  );
  return {
    editor: first.editor,
    version: release.version,
    commit: release.commit,
    arch: release.arch,
    bundleMode: first.bundleMode,
    captureFlavor: first.captureFlavor,
    windowMode: first.windowMode,
    hostPlatform: first.hostPlatform,
    hostArch: first.hostArch,
    timerQuantizationMs,
    platform: first.platform,
    osRelease: first.osRelease,
    launchState: first.launchState,
    workspaceState: first.workspaceState,
    sourceRevision: first.sourceRevision,
    artifactSha256: first.artifactSha256,
    artifactIdentity: first.artifactIdentity,
    executableIdentity: first.executableIdentity,
    capturedAt,
  };
}

async function captureRoot(
  label,
  fixtureRoot,
  allScenarios,
  environments,
  failures,
  executableIdentity,
  release,
) {
  const runId = label + "-" + randomUUID();
  const tmpDir = ipcSafeTmpDir();
  const outPath = path.join(tmpDir, "codevo-vscode-baseline-out-" + runId + ".json");
  const userDataDir = path.join(tmpDir, "codevo-vscode-baseline-user-data-" + runId);
  const extensionsDir = path.join(tmpDir, "codevo-vscode-baseline-extensions-" + runId);
  let child = null;
  let launchError = null;
  try {
    seedIsolatedProfile(userDataDir);
    child = spawn(
      executableIdentity.command,
      [
        "--new-window",
        "--wait",
        "--disable-extensions",
        `--user-data-dir=${userDataDir}`,
        `--extensions-dir=${extensionsDir}`,
        `--extensionDevelopmentPath=${extensionDir}`,
        fixtureRoot,
      ],
      {
        env: {
          ...process.env,
          CODEVO_BASELINE_OUT: outPath,
          CODEVO_BASELINE_SOURCE_REVISION: release.commit,
          CODEVO_BASELINE_ARTIFACT_SHA256: executableIdentity.artifactSha256,
          CODEVO_BASELINE_ARTIFACT_IDENTITY: executableIdentity.artifactIdentity,
          CODEVO_BASELINE_EXECUTABLE_IDENTITY: executableIdentity.realPath,
        },
        stdio: "inherit",
        detached: process.platform !== "win32",
      },
    );
    child.once("error", (error) => {
      launchError = error;
    });
    child.once("exit", (exitCode, signal) => {
      launchError ??= captureExitBeforeOutputError(label, outPath, exitCode, signal);
    });
    const outputExists = await waitForOutput(outPath, 900000, () => launchError);
    if (!outputExists) {
      failures.push({
        id: label + "-root",
        error: "no output file produced by VS Code process within 900000 ms",
      });
      return;
    }

    try {
      const captured = validateCapturedScenarios(label, readBoundedCaptureFile(outPath));
      environments.push(captured.environment);
      allScenarios.push(...captured.scenarios);
    } catch (error) {
      failures.push({ id: label + "-root", error: String((error && error.message) || error) });
    }
  } finally {
    try {
      await terminateOwnedProcessTree(child);
    } finally {
      fs.rmSync(outPath, { force: true });
      fs.rmSync(userDataDir, { force: true, recursive: true });
      fs.rmSync(extensionsDir, { force: true, recursive: true });
    }
  }
}

function describeScenarioFailure(scenario) {
  if (Object.prototype.hasOwnProperty.call(scenario, "error")) {
    return String(scenario.status ?? "invalid") + ": " + scenario.error;
  }
  return "status is " + String(scenario.status ?? "missing") + " instead of ok";
}

function collectScenarioFailures(scenarios) {
  return scenarios
    .filter((scenario) => scenario.status !== "ok")
    .map((scenario) => ({ id: scenario.id, error: describeScenarioFailure(scenario) }));
}

async function main() {
  if (!fs.existsSync(largeFilesRoot) || !fs.existsSync(monorepoRoot)) {
    console.error("VS Code baseline fixtures are missing. Run npm run perf:fixtures first.");
    process.exit(1);
  }

  const allScenarios = [];
  const environments = [];
  const failures = [];
  const executableIdentity = resolveExecutableIdentity(
    process.env.CODEVO_VSCODE_EXECUTABLE || "code",
  );
  const release = readVscodeRelease(executableIdentity.command);
  const fixtureHashesBefore = collectFixtureHashes();
  await captureRoot(
    "large-files",
    largeFilesRoot,
    allScenarios,
    environments,
    failures,
    executableIdentity,
    release,
  );
  await captureRoot(
    "monorepo",
    monorepoRoot,
    allScenarios,
    environments,
    failures,
    executableIdentity,
    release,
  );
  const fixtureHashesAfter = collectFixtureHashes();
  const fixtureFenceFailure = fixtureHashFenceFailure(fixtureHashesBefore, fixtureHashesAfter);

  if (fixtureFenceFailure !== null) {
    console.error("fixture-hash-fence: " + fixtureFenceFailure);
    process.exit(1);
  }

  if (environments.length === 0) {
    for (const failure of failures) {
      console.error(failure.id + ": " + failure.error);
    }
    console.error("no capture window produced an environment block; nothing was written.");
    process.exit(1);
  }

  const capturedAt = new Date().toISOString();
  const merged = {
    captureContract: PERF_CAPTURE_CONTRACT_METADATA,
    fixtureVersion: FIXTURE_VERSION,
    fixtureHashes: fixtureHashesAfter,
    environment: mergeEnvironments(environments, release, capturedAt),
    scenarios: allScenarios,
  };
  const mergedContractFailures = validateCaptureRun(merged, { expectedEditor: "vscode" });
  if (mergedContractFailures.length > 0) {
    throw new Error(
      "merged VS Code baseline violates the canonical contract: " +
        mergedContractFailures.join(" "),
    );
  }
  const baselinesDir = path.join(repoRoot, "perf/baselines");
  const finalPath = path.join(baselinesDir, "vscode.json");
  const tempPath = finalPath + ".tmp-" + randomUUID();

  try {
    fs.mkdirSync(baselinesDir, { recursive: true });
    fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2) + "\n");

    const missingIds = findMissingScenarioIds(allScenarios);
    const failedEntries = [
      ...collectScenarioFailures(allScenarios),
      ...failures,
      ...missingIds.map((id) => ({ id, error: "scenario missing from captured output" })),
    ];
    if (failedEntries.length > 0) {
      for (const failure of failedEntries) {
        console.error(failure.id + ": " + failure.error);
      }
      throw new Error("baseline capture failed; final baseline was not replaced.");
    }

    fs.renameSync(tempPath, finalPath);
  } finally {
    fs.rmSync(tempPath, { force: true });
  }

  console.log("Captured VS Code baseline scenarios:");
  for (const scenario of allScenarios) {
    console.log(scenario.id + ": p95=" + scenario.p95 + " ms");
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(String((error && error.message) || error));
    process.exit(1);
  });
}

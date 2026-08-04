import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { computeFixtureHashes } from "../../scripts/perf/fixtureHash.mjs";
import { FIXTURE_VERSION } from "../../scripts/perf/perfScenarios.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const extensionDir = path.join(repoRoot, "tools/vscode-baseline");
const largeFilesRoot = path.join(repoRoot, "perf/fixtures/large-files");
const monorepoRoot = path.join(repoRoot, "perf/fixtures/monorepo");
const EXPECTED_SCENARIO_IDS = [
  "tab-switch-cycle",
  "typing-large-5k",
  "typing-large-20k",
  "typing-large-100k",
  "completion-bounded",
  "completion-unbounded",
  "definition-medium-2k",
  "references-medium-2k",
  "rename-medium-2k",
  "completion-large-20k",
  "definition-large-20k",
  "references-large-20k",
  "rename-large-20k",
  "file-search-engine",
];

function findMissingScenarioIds(scenarios) {
  const presentIds = new Set(scenarios.map((scenario) => scenario.id));
  return EXPECTED_SCENARIO_IDS.filter((id) => !presentIds.has(id));
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForOutput(outPath, budgetMilliseconds) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < budgetMilliseconds) {
    if (fs.existsSync(outPath)) {
      return true;
    }
    await sleep(2000);
  }
  return fs.existsSync(outPath);
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

function killIsolatedProfileProcesses(userDataDir) {
  spawnSync("pkill", ["-9", "-f", userDataDir]);
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

function readVscodeRelease() {
  const lines = spawnSync("code", ["--version"], { encoding: "utf8" }).stdout.trim().split("\n");
  return { version: lines[0] ?? "", commit: lines[1] ?? "", arch: lines[2] ?? "" };
}

function mergeEnvironments(fragments, release, capturedAt) {
  const first = fragments[0];
  for (const fragment of fragments) {
    if (fragment.editor !== first.editor || fragment.platform !== first.platform) {
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
    timerQuantizationMs,
    platform: first.platform,
    capturedAt,
  };
}

async function captureRoot(label, fixtureRoot, allScenarios, environments, failures) {
  const runId = label + "-" + Date.now();
  const tmpDir = ipcSafeTmpDir();
  const outPath = path.join(tmpDir, "codevo-vscode-baseline-out-" + runId + ".json");
  const userDataDir = path.join(tmpDir, "codevo-vscode-baseline-user-data-" + runId);
  const extensionsDir = path.join(tmpDir, "codevo-vscode-baseline-extensions-" + runId);
  seedIsolatedProfile(userDataDir);
  const result = spawnSync(
    "code",
    [
      "--new-window",
      "--disable-extensions",
      `--user-data-dir=${userDataDir}`,
      `--extensions-dir=${extensionsDir}`,
      `--extensionDevelopmentPath=${extensionDir}`,
      fixtureRoot,
    ],
    {
      env: { ...process.env, CODEVO_BASELINE_OUT: outPath },
      stdio: "inherit",
      timeout: 900000,
      killSignal: "SIGKILL",
    },
  );
  const outputExists = await waitForOutput(outPath, 900000);
  killIsolatedProfileProcesses(userDataDir);
  if (!outputExists) {
    failures.push({
      id: label + "-root",
      error:
        "no output file produced by VS Code process (spawnSync status=" +
        result.status +
        ", signal=" +
        result.signal +
        ")",
    });
    return;
  }
  try {
    const captured = JSON.parse(fs.readFileSync(outPath, "utf8"));
    if (!captured.environment) {
      failures.push({ id: label + "-root", error: "captured output carries no environment block" });
      return;
    }
    environments.push(captured.environment);
    allScenarios.push(...captured.scenarios);
  } catch (error) {
    failures.push({ id: label + "-root", error: String((error && error.message) || error) });
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
  await captureRoot("large-files", largeFilesRoot, allScenarios, environments, failures);
  await captureRoot("monorepo", monorepoRoot, allScenarios, environments, failures);

  if (environments.length === 0) {
    for (const failure of failures) {
      console.error(failure.id + ": " + failure.error);
    }
    console.error("no capture window produced an environment block; nothing was written.");
    process.exit(1);
  }

  const capturedAt = new Date().toISOString();
  const merged = {
    fixtureVersion: FIXTURE_VERSION,
    fixtureHashes: collectFixtureHashes(),
    environment: mergeEnvironments(environments, readVscodeRelease(), capturedAt),
    scenarios: allScenarios,
  };
  const baselinesDir = path.join(repoRoot, "perf/baselines");
  const finalPath = path.join(baselinesDir, "vscode.json");
  const tempPath = finalPath + ".tmp-" + process.pid;
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
    fs.rmSync(tempPath, { force: true });
    process.exit(1);
  }

  fs.renameSync(tempPath, finalPath);

  console.log("Captured VS Code baseline scenarios:");
  for (const scenario of allScenarios) {
    console.log(scenario.id + ": p95=" + scenario.p95 + " ms");
  }
}

main().catch((error) => {
  console.error(String((error && error.message) || error));
  process.exit(1);
});

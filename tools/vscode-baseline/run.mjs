import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FIXTURE_VERSION } from "../../scripts/perf/perfScenarios.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "../..");
const extensionDir = path.join(repoRoot, "tools/vscode-baseline");
const largeFilesRoot = path.join(repoRoot, "perf/fixtures/large-files");
const monorepoRoot = path.join(repoRoot, "perf/fixtures/monorepo");
const EXPECTED_SCENARIO_IDS = [
  "typing-large-5k",
  "typing-large-20k",
  "typing-large-100k",
  "tab-switch-cycle",
  "completion-large-20k",
  "definition-large-20k",
  "references-large-20k",
  "rename-large-20k",
  "quickopen-monorepo",
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

async function captureRoot(label, fixtureRoot, allScenarios, failures) {
  const runId = label + "-" + Date.now();
  const tmpDir = ipcSafeTmpDir();
  const outPath = path.join(tmpDir, "codevo-vscode-baseline-out-" + runId + ".json");
  const userDataDir = path.join(tmpDir, "codevo-vscode-baseline-user-data-" + runId);
  const extensionsDir = path.join(tmpDir, "codevo-vscode-baseline-extensions-" + runId);
  seedIsolatedProfile(userDataDir);
  const result = spawnSync("code", [
    "--new-window",
    "--disable-extensions",
    `--user-data-dir=${userDataDir}`,
    `--extensions-dir=${extensionsDir}`,
    `--extensionDevelopmentPath=${extensionDir}`,
    fixtureRoot,
  ], { env: { ...process.env, CODEVO_BASELINE_OUT: outPath }, stdio: "inherit", timeout: 600000, killSignal: "SIGKILL" });
  const outputExists = await waitForOutput(outPath, 600000);
  killIsolatedProfileProcesses(userDataDir);
  if (!outputExists) {
    failures.push({
      id: label + "-root",
      error: "no output file produced by VS Code process (spawnSync status=" + result.status + ", signal=" + result.signal + ")",
    });
    return;
  }
  try {
    const captured = JSON.parse(fs.readFileSync(outPath, "utf8"));
    allScenarios.push(...captured.scenarios);
  } catch (error) {
    failures.push({ id: label + "-root", error: String(error && error.message || error) });
  }
}

async function main() {
  if (!fs.existsSync(largeFilesRoot) || !fs.existsSync(monorepoRoot)) {
    console.error("VS Code baseline fixtures are missing. Run npm run perf:fixtures first.");
    process.exit(1);
  }

  const allScenarios = [];
  const failures = [];
  await captureRoot("large-files", largeFilesRoot, allScenarios, failures);
  await captureRoot("monorepo", monorepoRoot, allScenarios, failures);

  const vscodeVersion = spawnSync("code", ["--version"], { encoding: "utf8" }).stdout.trim().split("\n")[0];
  const capturedAt = new Date().toISOString();
  const merged = { capturedAt, vscodeVersion, fixtureVersion: FIXTURE_VERSION, scenarios: allScenarios };
  const baselinesDir = path.join(repoRoot, "perf/baselines");
  const finalPath = path.join(baselinesDir, "vscode.json");
  const tempPath = finalPath + ".tmp-" + process.pid;
  fs.mkdirSync(baselinesDir, { recursive: true });
  fs.writeFileSync(tempPath, JSON.stringify(merged, null, 2) + "\n");

  const missingIds = findMissingScenarioIds(allScenarios);
  const failedEntries = [
    ...allScenarios.filter((scenario) => Object.prototype.hasOwnProperty.call(scenario, "error")),
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
  console.error(String(error && error.message || error));
  process.exit(1);
});

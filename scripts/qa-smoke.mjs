#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const activeChildren = new Set();

export const qaSmokeProfiles = {
  vitestFast: {
    description:
      "Small Vitest smoke profile for runtime lifecycle, per-project isolation guards, quick-open basics, Git diff blank/recoverable paths, runtime observability UI contracts, index progress, and JS/TS workspace filtering.",
    command: [
      "npm",
      "test",
      "--",
      "src/domain/languageServerRuntime.test.ts",
      "src/domain/languageServerRuntimeStatusCache.test.ts",
      "src/domain/runtimeObservability.test.ts",
      "src/domain/indexProgress.test.ts",
      "src/domain/javascriptTypeScriptFileReferences.test.ts",
      "src/domain/javascriptTypeScriptWatchedFiles.test.ts",
      "src/infrastructure/tauriWorkspaceRuntimeLifecycleGateway.test.ts",
      "src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts",
      "src/infrastructure/tauriRuntimeObservabilityGateway.test.ts",
      "src/infrastructure/tauriIndexProgressGateway.test.ts",
      "src/components/QuickOpen.test.tsx",
      "src/components/GitDiffPreview.test.tsx",
      "src/App.gitDiffClick.test.tsx",
      "src/App.gitDiffBoundary.test.tsx",
      "src/App.test.ts",
    ],
    files: [
      "src/domain/languageServerRuntime.test.ts",
      "src/domain/languageServerRuntimeStatusCache.test.ts",
      "src/domain/runtimeObservability.test.ts",
      "src/domain/indexProgress.test.ts",
      "src/domain/javascriptTypeScriptFileReferences.test.ts",
      "src/domain/javascriptTypeScriptWatchedFiles.test.ts",
      "src/infrastructure/tauriWorkspaceRuntimeLifecycleGateway.test.ts",
      "src/infrastructure/tauriLanguageServerRuntimeGateway.test.ts",
      "src/infrastructure/tauriRuntimeObservabilityGateway.test.ts",
      "src/infrastructure/tauriIndexProgressGateway.test.ts",
      "src/components/QuickOpen.test.tsx",
      "src/components/GitDiffPreview.test.tsx",
      "src/App.gitDiffClick.test.tsx",
      "src/App.gitDiffBoundary.test.tsx",
      "src/App.test.ts",
    ],
  },
  vitestExtended: {
    description:
      "Slower frontend regression profile for runtime observability panel behavior, the Quick Open empty-tab editor race, and broad workbench per-project isolation regressions.",
    command: [
      "npm",
      "test",
      "--",
      "src/components/RuntimeObservabilityPanel.test.tsx",
      "src/components/EditorSurface.test.tsx",
      "src/application/useWorkbenchController.preview.test.tsx",
    ],
    files: [
      "src/components/RuntimeObservabilityPanel.test.tsx",
      "src/components/EditorSurface.test.tsx",
      "src/application/useWorkbenchController.preview.test.tsx",
    ],
  },
  vitestFull: {
    description: "Full Vitest suite.",
    command: ["npm", "test"],
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  rustBackendSmoke: {
    description:
      "Backend-only coverage for PHPactor/Imagick isolation, startup-noise parsing, runtime observability, index progress, and tsserver cleanup.",
    command: [
      "cargo",
      "test",
      "--lib",
      "phpactor",
      "&&",
      "cargo",
      "test",
      "--lib",
      "skips_startup_noise_before_headers",
      "&&",
      "cargo",
      "test",
      "--lib",
      "runtime_observability",
      "&&",
      "cargo",
      "test",
      "--lib",
      "reindex_emits_incremental_progress_on_batch_boundaries",
      "&&",
      "cargo",
      "test",
      "--lib",
      "tsserver",
    ],
    cwd: "src-tauri",
    filters: [
      "phpactor",
      "skips_startup_noise_before_headers",
      "runtime_observability",
      "reindex_emits_incremental_progress_on_batch_boundaries",
      "tsserver",
    ],
  },
};

const fastSteps = [
  npmStep("TypeScript check", ["run", "check"], { timeoutMs: minutes(5) }),
  profileStep("Fast Vitest smoke", qaSmokeProfiles.vitestFast, {
    timeoutMs: minutes(5),
  }),
];

const modeSteps = {
  fast: fastSteps,
  extended: [
    profileStep("Extended Vitest regression profile", qaSmokeProfiles.vitestExtended, {
      timeoutMs: minutes(10),
    }),
  ],
  full: [
    npmStep("TypeScript check", ["run", "check"], { timeoutMs: minutes(5) }),
    profileStep("Full Vitest suite", qaSmokeProfiles.vitestFull, {
      timeoutMs: minutes(15),
    }),
    ...rustBackendSteps(qaSmokeProfiles.rustBackendSmoke),
    npmStep("Production build", ["run", "build"], { timeoutMs: minutes(10) }),
  ],
  desktop: [
    npmStep("Debug desktop boot smoke", ["run", "debug:smoke"], {
      timeoutMs: minutes(20),
    }),
  ],
};

const modeNames = Object.keys(modeSteps);

if (process.argv[1] && path.resolve(process.argv[1]) === scriptPath) {
  main().catch((error) => {
    console.error(`\nqa-smoke failed: ${error.message}`);
    cleanupActiveChildren("SIGTERM");
    process.exitCode = 1;
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  const steps = modeSteps[options.mode];
  if (!steps) {
    throw new Error(`Unknown smoke mode "${options.mode}". Expected one of: ${modeNames.join(", ")}.`);
  }

  registerSignalHandlers();
  console.log(`qa-smoke: running ${options.mode} smoke (${steps.length} steps)`);

  const startedAt = Date.now();
  for (const [index, step] of steps.entries()) {
    await runStep(step, index + 1, steps.length);
  }

  console.log(`\nqa-smoke: ${options.mode} smoke passed in ${formatDuration(Date.now() - startedAt)}`);
}

function parseArgs(args) {
  const options = {
    help: false,
    mode: "fast",
  };
  let modeWasSet = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option "${arg}".`);
    }

    if (modeWasSet) {
      throw new Error(`Unexpected extra argument "${arg}".`);
    }

    options.mode = arg;
    modeWasSet = true;
  }

  return options;
}

function printHelp() {
  console.log(`Usage: node ./scripts/qa-smoke.mjs [mode]

Modes:
  fast      TypeScript check and targeted Vitest smoke. Default.
  extended  Slower Vitest regression files for editor/workbench races.
  full      TypeScript check, full Vitest, backend smoke, and build.
  desktop   Debug Tauri build, short desktop boot, and process cleanup smoke.
`);
}

async function runStep(step, index, total) {
  const startedAt = Date.now();
  console.log(`\n[${index}/${total}] ${step.name}`);
  await step.run();
  console.log(`[${index}/${total}] passed in ${formatDuration(Date.now() - startedAt)}`);
}

function npmStep(name, args, options = {}) {
  return commandStep(name, "npm", args, options);
}

function profileStep(name, profile, options = {}) {
  const [command, ...args] = profile.command;
  return commandStep(name, command, args, {
    ...options,
    cwd: profile.cwd ? path.join(repoRoot, profile.cwd) : repoRoot,
  });
}

function rustBackendSteps(profile) {
  return profile.filters.map((filter) =>
    commandStep(`Rust backend smoke: ${filter}`, "cargo", ["test", "--lib", filter], {
      cwd: path.join(repoRoot, profile.cwd),
      timeoutMs: minutes(5),
    }),
  );
}

function commandStep(name, command, args, options = {}) {
  return {
    name,
    run: () => runCommand(resolveCommand(command), args, options),
  };
}

function resolveCommand(command) {
  if (process.platform !== "win32") {
    return command;
  }

  if (command === "npm") {
    return "npm.cmd";
  }

  if (command === "cargo") {
    return "cargo.exe";
  }

  return command;
}

async function runCommand(command, args, options) {
  const cwd = options.cwd ?? repoRoot;
  const timeoutMs = options.timeoutMs ?? minutes(5);
  console.log(`$ ${[command, ...args].join(" ")}`);

  const child = spawn(command, args, {
    cwd,
    env: process.env,
    stdio: "inherit",
  });

  activeChildren.add(child);

  try {
    await waitForCommand(child, timeoutMs);
  } finally {
    activeChildren.delete(child);
  }
}

function waitForCommand(child, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      terminateChild(child, "SIGTERM");
    }, timeoutMs);

    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });

    child.once("exit", (code, signal) => {
      clearTimeout(timeout);

      if (timedOut) {
        reject(new Error(`Command timed out after ${formatDuration(timeoutMs)}.`));
        return;
      }

      if (signal) {
        reject(new Error(`Command exited after ${signal}.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`Command exited with status ${code}.`));
        return;
      }

      resolve();
    });
  });
}

function registerSignalHandlers() {
  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
      cleanupActiveChildren(signal);
      process.kill(process.pid, signal);
    });
  }

  process.once("exit", () => cleanupActiveChildren("SIGTERM"));
}

function cleanupActiveChildren(signal) {
  for (const child of activeChildren) {
    terminateChild(child, signal);
  }
}

function terminateChild(child, signal) {
  if (!child.pid) {
    return;
  }

  const targets = processTreePids(child.pid);
  killPids(targets, signal);

  setTimeout(() => {
    killPids(processTreePids(child.pid), "SIGKILL");
  }, 750).unref();
}

function processTreePids(rootPid) {
  const processes = listProcesses();
  const descendants = descendantsOf(processes, new Set([rootPid]));
  return [...descendants, rootPid];
}

function listProcesses() {
  if (process.platform === "win32") {
    return [];
  }

  try {
    return execFileSync("ps", ["-axo", "pid=,ppid="], { encoding: "utf8" })
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)$/);
        if (!match) {
          return null;
        }

        return {
          pid: Number(match[1]),
          ppid: Number(match[2]),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function descendantsOf(processes, parentPids) {
  const descendants = new Set();
  let changed = true;

  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (!parentPids.has(processInfo.ppid) && !descendants.has(processInfo.ppid)) {
        continue;
      }

      if (descendants.has(processInfo.pid)) {
        continue;
      }

      descendants.add(processInfo.pid);
      changed = true;
    }
  }

  return descendants;
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Process may already be gone.
    }
  }
}

function minutes(value) {
  return seconds(value * 60);
}

function seconds(value) {
  return value * 1000;
}

function formatDuration(ms) {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  return `${(ms / 1000).toFixed(1)}s`;
}

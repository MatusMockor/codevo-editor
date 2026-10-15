#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const repoRoot = path.resolve(path.dirname(scriptPath), "..");
const activeChildren = new Set();
export const agentAppSuiteDirectories = ["src/application/agentApp", "src/components/agentApp"];

const vitestFastFiles = [
  "src/domain/agentWorkbenchLayout.test.ts",
  "src/domain/agentSurfaceActivation.test.ts",
  "src/infrastructure/tauriWorkspaceRuntimeLifecycleGateway.test.ts",
  "src/application/useAgentProjects.test.ts",
  "src/application/useAgentThreadStore.test.tsx",
  "src/application/useAgentTurnDispatch.test.tsx",
  "src/application/useAgentStopController.test.tsx",
  "src/application/useAgentShipFlow.test.tsx",
  "src/application/useAgentSurfaceFileTree.test.tsx",
];

const vitestExtendedFiles = [
  "src/application/useAgentThreadSessionLifecycle.test.tsx",
  "src/application/useAgentPendingInteractions.test.tsx",
  "src/application/useAgentThreads.test.tsx",
  "src/application/useAgentThreadScripts.test.tsx",
  "src/application/useAgentGitHistory.test.tsx",
  "src/application/useAgentProviderManagement.test.tsx",
  "src/application/remoteAgentProjection.test.ts",
];

export const qaSmokeProfiles = {
  vitestFast: {
    description:
      "Small Vitest smoke profile for agent layout and surfaces, workspace runtime lifecycle, projects, thread store, turn dispatch, stop, ship flow, and the Files viewer tree.",
    command: ["npm", "test", "--", ...vitestFastFiles],
    files: vitestFastFiles,
  },
  vitestExtended: {
    description:
      "Slower agent regression profile for thread session lifecycle, pending interactions, threads, scripts, Git history, providers, remote projection, and the agent app workspace and close races.",
    command: ["npm", "test", "--", ...vitestExtendedFiles, ...agentAppSuiteDirectories],
    files: [...vitestExtendedFiles, ...agentAppSuiteDirectories],
  },
  vitestFull: {
    description: "Full Vitest suite.",
    command: ["npm", "test"],
    files: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
  rustBackendSmoke: {
    description:
      "Backend-only coverage for agent turn changes and logs, agent history, terminal sessions, and Git worktrees.",
    command: [
      "cargo",
      "test",
      "--lib",
      "agent_turn_changes",
      "&&",
      "cargo",
      "test",
      "--lib",
      "agent_turn_log",
      "&&",
      "cargo",
      "test",
      "--lib",
      "agent_history_store",
      "&&",
      "cargo",
      "test",
      "--lib",
      "terminal_session",
      "&&",
      "cargo",
      "test",
      "--lib",
      "git_worktree",
    ],
    cwd: "src-tauri",
    filters: [
      "agent_turn_changes",
      "agent_turn_log",
      "agent_history_store",
      "terminal_session",
      "git_worktree",
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
    throw new Error(
      `Unknown smoke mode "${options.mode}". Expected one of: ${modeNames.join(", ")}.`,
    );
  }

  registerSignalHandlers();
  console.log(`qa-smoke: running ${options.mode} smoke (${steps.length} steps)`);

  const startedAt = Date.now();
  for (const [index, step] of steps.entries()) {
    await runStep(step, index + 1, steps.length);
  }

  console.log(
    `\nqa-smoke: ${options.mode} smoke passed in ${formatDuration(Date.now() - startedAt)}`,
  );
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
  fast      TypeScript check and targeted agent Vitest smoke. Default.
  extended  Slower agent Vitest regression files for thread and workspace races.
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

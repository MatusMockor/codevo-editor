#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

const args = process.argv.slice(2);
const smokeMode = args.includes("--smoke");
const repoRoot = process.cwd();
const debugExecutable = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "debug",
  "mockor-editor",
);
const bundledDebugExecutable = path.join(
  repoRoot,
  "src-tauri",
  "target",
  "debug",
  "bundle",
  "macos",
  "Mockor Editor.app",
  "Contents",
  "MacOS",
  "mockor-editor",
);
const devAppExecutables = [
  debugExecutable,
  bundledDebugExecutable,
];
const managedPhpactorMarker = path.join(
  "Application Support",
  "Mockor Editor",
  "tools",
  "phpactor",
);
const managedPhpactorHomeMarker = path.join(
  ".mockor-editor",
  "tools",
  "phpactor",
);
const bundledTypescriptServerMarker = path.join(
  repoRoot,
  "node_modules",
  ".bin",
  "typescript-language-server",
);
const managedTypescriptServerMarker = path.join(
  "Application Support",
  "Mockor Editor",
  "tools",
  "typescript-language-server",
);
const managedTypescriptServerHomeMarker = path.join(
  ".mockor-editor",
  "tools",
  "typescript-language-server",
);
const bundledTsserverMarker = path.join(
  repoRoot,
  "node_modules",
  "typescript",
  "lib",
  "tsserver.js",
);
const smokeRunMs = readPositiveIntegerEnv("MOCKOR_EDITOR_SMOKE_RUN_MS", 5000);
const smokeCleanupGraceMs = readPositiveIntegerEnv(
  "MOCKOR_EDITOR_SMOKE_CLEANUP_GRACE_MS",
  1500,
);
const smokeAllowExisting =
  process.env.MOCKOR_EDITOR_SMOKE_CLEAN_EXISTING === "1";

let cleanedUp = false;
let shuttingDown = false;
let smokeBaselinePids = new Set();
let smokeChild = null;
let smokeShuttingDown = false;

function readPositiveIntegerEnv(name, fallback) {
  const value = Number(process.env[name]);

  if (Number.isInteger(value) && value > 0) {
    return value;
  }

  return fallback;
}

function listProcesses() {
  try {
    return execFileSync("ps", ["-axo", "pid=,ppid=,command="], {
      encoding: "utf8",
    })
      .split("\n")
      .map((line) => {
        const match = line.trim().match(/^(\d+)\s+(\d+)\s+(.+)$/);
        if (!match) {
          return null;
        }

        return {
          command: match[3],
          pid: Number(match[1]),
          ppid: Number(match[2]),
        };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function isDevAppProcess(processInfo) {
  return devAppExecutables.some((executable) =>
    processInfo.command.includes(executable),
  );
}

function isManagedPhpactorProcess(processInfo) {
  return (
    (processInfo.command.includes(managedPhpactorMarker) ||
      processInfo.command.includes(managedPhpactorHomeMarker)) &&
    processInfo.command.includes("language-server")
  );
}

function isTypescriptLanguageServerProcess(processInfo) {
  return (
    (processInfo.command.includes(bundledTypescriptServerMarker) ||
      processInfo.command.includes(managedTypescriptServerMarker) ||
      processInfo.command.includes(managedTypescriptServerHomeMarker)) &&
    processInfo.command.includes("--stdio")
  );
}

function isTsserverProcess(processInfo) {
  return (
    (processInfo.command.includes(bundledTsserverMarker) ||
      processInfo.command.includes(managedTypescriptServerMarker) ||
      processInfo.command.includes(managedTypescriptServerHomeMarker)) &&
    processInfo.command.includes("tsserver.js")
  );
}

function isRuntimeProcess(processInfo) {
  return (
    isManagedPhpactorProcess(processInfo) ||
    isTypescriptLanguageServerProcess(processInfo) ||
    isTsserverProcess(processInfo)
  );
}

function matchingManagedProcesses(processes = listProcesses()) {
  return processes.filter(
    (processInfo) => isDevAppProcess(processInfo) || isRuntimeProcess(processInfo),
  );
}

function processKind(processInfo) {
  if (isDevAppProcess(processInfo)) {
    return "debug app";
  }

  if (isManagedPhpactorProcess(processInfo)) {
    return "phpactor";
  }

  if (isTypescriptLanguageServerProcess(processInfo)) {
    return "typescript-language-server";
  }

  if (isTsserverProcess(processInfo)) {
    return "tsserver";
  }

  return "unknown";
}

function describeProcesses(processes) {
  return processes
    .map(
      (processInfo) =>
        `  ${processInfo.pid} (${processKind(processInfo)}): ${processInfo.command}`,
    )
    .join("\n");
}

function descendantsOf(processes, parentPids) {
  const descendants = new Set();
  let changed = true;

  while (changed) {
    changed = false;
    for (const processInfo of processes) {
      if (
        (parentPids.has(processInfo.ppid) || descendants.has(processInfo.ppid)) &&
        !descendants.has(processInfo.pid)
      ) {
        descendants.add(processInfo.pid);
        changed = true;
      }
    }
  }

  return descendants;
}

function killPids(pids, signal) {
  for (const pid of pids) {
    try {
      process.kill(pid, signal);
    } catch {
      // Process may have exited naturally while cleanup was running.
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function pidsStillRunning(pids) {
  const pidsToCheck = new Set(pids);

  return listProcesses()
    .filter((processInfo) => pidsToCheck.has(processInfo.pid))
    .map((processInfo) => processInfo.pid);
}

function cleanupDevAppProcesses() {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;

  killDevAppProcesses();
  killRuntimeProcesses();
}

function killDevAppProcesses() {
  const processes = listProcesses();
  const appPids = new Set(
    processes
      .filter((processInfo) => isDevAppProcess(processInfo))
      .map((processInfo) => processInfo.pid),
  );

  if (appPids.size === 0) {
    return;
  }

  const childPids = descendantsOf(processes, appPids);
  const targets = [...childPids, ...appPids];

  killPids(targets, "SIGTERM");
  setTimeout(() => {
    const survivors = new Set(
      listProcesses()
        .filter((processInfo) => targets.includes(processInfo.pid))
        .map((processInfo) => processInfo.pid),
    );
    killPids(survivors, "SIGKILL");
  }, 750).unref();
}

function killRuntimeProcesses() {
  const processes = listProcesses();
  const runtimePids = processes
    .filter((processInfo) => isRuntimeProcess(processInfo))
    .map((processInfo) => processInfo.pid);

  if (runtimePids.length === 0) {
    return;
  }

  killPids(runtimePids, "SIGTERM");
  setTimeout(() => {
    const survivors = new Set(
      listProcesses()
        .filter((processInfo) => runtimePids.includes(processInfo.pid))
        .map((processInfo) => processInfo.pid),
    );
    killPids(survivors, "SIGKILL");
  }, 750).unref();
}

function spawnDebugApp() {
  return spawn(bundledDebugExecutable, {
    stdio: "inherit",
  });
}

async function cleanupAndVerifySmoke(baselinePids) {
  const processes = listProcesses();
  const appPids = new Set(
    processes
      .filter(
        (processInfo) =>
          isDevAppProcess(processInfo) && !baselinePids.has(processInfo.pid),
      )
      .map((processInfo) => processInfo.pid),
  );
  const childPids = descendantsOf(processes, appPids);
  const runtimePids = processes
    .filter(
      (processInfo) =>
        isRuntimeProcess(processInfo) && !baselinePids.has(processInfo.pid),
    )
    .map((processInfo) => processInfo.pid);
  const targets = [...new Set([...childPids, ...appPids, ...runtimePids])];

  killPids(targets, "SIGTERM");
  await sleep(smokeCleanupGraceMs);
  killPids(pidsStillRunning(targets), "SIGKILL");
  await sleep(250);

  const survivors = matchingManagedProcesses().filter(
    (processInfo) => !baselinePids.has(processInfo.pid),
  );

  if (survivors.length > 0) {
    throw new Error(
      `Smoke cleanup left matching process(es):\n${describeProcesses(survivors)}`,
    );
  }
}

async function shutdownSmoke(signal) {
  if (smokeShuttingDown) {
    return;
  }
  smokeShuttingDown = true;

  if (smokeChild && !smokeChild.killed) {
    smokeChild.kill(signal);
  }

  try {
    await cleanupAndVerifySmoke(smokeBaselinePids);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
  } finally {
    process.exit(signal === "SIGINT" ? 130 : 143);
  }
}

async function runSmoke() {
  const existingMatches = matchingManagedProcesses();

  if (existingMatches.length > 0 && !smokeAllowExisting) {
    throw new Error(
      "Refusing to run smoke while matching debug/runtime process(es) already exist.\n" +
        "Close them first, or set MOCKOR_EDITOR_SMOKE_CLEAN_EXISTING=1 to let this script clean them.\n" +
        describeProcesses(existingMatches),
    );
  }

  smokeBaselinePids = smokeAllowExisting
    ? new Set()
    : new Set(existingMatches.map((processInfo) => processInfo.pid));

  process.on("SIGINT", () => {
    void shutdownSmoke("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdownSmoke("SIGTERM");
  });

  if (smokeAllowExisting) {
    killDevAppProcesses();
    killRuntimeProcesses();
    await sleep(smokeCleanupGraceMs);
  }

  execFileSync("npm", ["run", "debug:build"], {
    stdio: "inherit",
  });

  console.log(`Starting debug app for ${smokeRunMs}ms...`);
  const tauri = spawnDebugApp();
  smokeChild = tauri;
  let exited = false;
  let exitCode = null;
  let exitSignal = null;
  tauri.on("exit", (code, signal) => {
    exited = true;
    exitCode = code;
    exitSignal = signal;
  });

  try {
    await sleep(smokeRunMs);

    if (exited) {
      throw new Error(
        `Debug app exited before smoke timeout (code=${exitCode}, signal=${exitSignal}).`,
      );
    }
  } finally {
    if (!exited) {
      tauri.kill("SIGTERM");
    }
    await cleanupAndVerifySmoke(smokeBaselinePids);
  }

  console.log("Debug app boot smoke passed: no matching dev/runtime processes remain.");
}

function runDebug() {
  killDevAppProcesses();
  killRuntimeProcesses();

  execFileSync("npm", ["run", "debug:build"], {
    stdio: "inherit",
  });

  const tauri = spawnDebugApp();

  function shutdown(signal) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;

    if (!tauri.killed) {
      tauri.kill(signal);
    }
    cleanupDevAppProcesses();
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("exit", cleanupDevAppProcesses);

  tauri.on("exit", (code, signal) => {
    cleanupDevAppProcesses();
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exit(code ?? 0);
  });
}

if (smokeMode) {
  runSmoke().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
} else {
  runDebug();
}

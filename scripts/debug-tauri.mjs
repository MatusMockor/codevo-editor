#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import path from "node:path";

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

let cleanedUp = false;
let shuttingDown = false;

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

function cleanupDevAppProcesses() {
  if (cleanedUp) {
    return;
  }
  cleanedUp = true;

  killDevAppProcesses();
}

function killDevAppProcesses() {
  const processes = listProcesses();
  const appPids = new Set(
    processes
      .filter((processInfo) =>
        devAppExecutables.some((executable) =>
          processInfo.command.includes(executable),
        ),
      )
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

killDevAppProcesses();

execFileSync("npm", ["run", "debug:build"], {
  stdio: "inherit",
});

const tauri = spawn(bundledDebugExecutable, {
  stdio: "inherit",
});

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

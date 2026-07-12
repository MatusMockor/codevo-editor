import { spawn } from "node:child_process";
import { debugAppLaunchExecutable } from "./debug-tauri-processes.mjs";

export function spawnDebugApp(repoRoot, spawnProcess = spawn) {
  return spawnProcess(debugAppLaunchExecutable(repoRoot), {
    stdio: "inherit",
  });
}

import { execFileSync } from "node:child_process";
import path from "node:path";

const DEFAULT_CLEAN_THRESHOLD_GB = 12;
const BYTES_PER_GIB = 1024 ** 3;

export function parseDuKilobytes(output) {
  const match = /^(\d+)\s/.exec(String(output).trim());
  if (!match) {
    return null;
  }
  return Number(match[1]) * 1024;
}

export function targetCleanThresholdBytes(env) {
  const value = String(env.CODEVO_EDITOR_TARGET_CLEAN_GB ?? "").trim();
  if (value === "") {
    return DEFAULT_CLEAN_THRESHOLD_GB * BYTES_PER_GIB;
  }
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw < 0) {
    return DEFAULT_CLEAN_THRESHOLD_GB * BYTES_PER_GIB;
  }
  return raw * BYTES_PER_GIB;
}

export function shouldCleanTarget({ forced, sizeBytes, thresholdBytes }) {
  if (forced) {
    return true;
  }
  if (sizeBytes === null) {
    return false;
  }
  return sizeBytes > thresholdBytes;
}

export function cleanTargetIfOversized({
  env = process.env,
  forced = false,
  repoRoot,
  run = execFileSync,
}) {
  const targetDirectory = path.join(repoRoot, "src-tauri", "target");
  let sizeBytes = null;
  try {
    sizeBytes = parseDuKilobytes(run("du", ["-sk", targetDirectory], { encoding: "utf8" }));
  } catch {
    sizeBytes = null;
  }
  const thresholdBytes = targetCleanThresholdBytes(env);
  if (!shouldCleanTarget({ forced, sizeBytes, thresholdBytes })) {
    return { cleaned: false, sizeBytes };
  }
  run("cargo", ["clean", "--target-dir", targetDirectory], {
    cwd: path.join(repoRoot, "src-tauri"),
    stdio: "inherit",
  });
  return { cleaned: true, sizeBytes };
}

export function describeTargetClean(result) {
  if (!result.cleaned) {
    return null;
  }
  if (result.sizeBytes === null) {
    return "Cleaned src-tauri/target before the debug build.";
  }
  const gib = (result.sizeBytes / BYTES_PER_GIB).toFixed(1);
  return `Cleaned src-tauri/target (${gib} GiB) before the debug build.`;
}

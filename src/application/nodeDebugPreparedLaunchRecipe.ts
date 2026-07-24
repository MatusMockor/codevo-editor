import { validateNodeDebugPostTask } from "../domain/nodeDebugPostTask";
import { validateNodeDebugPreLaunchTask } from "../domain/nodeDebugPreLaunchTask";
import {
  cloneVscodeNodeServerReadyActionRecipe,
  type VscodeNodeServerReadyActionRecipe,
} from "../domain/vscodeNodeLaunchConfiguration";
import { cloneNodeLaunchTarget } from "./debugRestartCoordinator";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";
import { cloneNativeNodeWatchLaunchIntent } from "../domain/nativeNodeWatchLaunchIntent";

/** Defensively clones the complete private recipe retained for a safe replay. */
export function clonePreparedNodeDebugLaunch(
  prepared: PreparedNodeDebugLaunch,
): PreparedNodeDebugLaunch | null {
  const launch = cloneNodeLaunchTarget(prepared.launch);
  const preTask = validateNodeDebugPreLaunchTask(prepared.preLaunchTask?.label);
  const postTask = validateNodeDebugPostTask(prepared.postDebugTask?.label);
  const serverReadyAction = cloneServerReadyAction(prepared.serverReadyAction);
  const nativeWatch = prepared.nativeWatch
    ? cloneNativeNodeWatchLaunchIntent(prepared.nativeWatch)
    : null;
  const envFile = cloneEnvFile(prepared.envFile);
  const rawLaunchEnvFile = (
    prepared.launch as PreparedNodeDebugLaunch["launch"] & { readonly envFile?: unknown }
  ).envFile;
  const launchEnvFile = cloneEnvFile(rawLaunchEnvFile);
  const rawRuntime = (
    prepared.launch as PreparedNodeDebugLaunch["launch"] & { readonly runtime?: unknown }
  ).runtime;
  const runtime = cloneRuntime(rawRuntime);
  if (
    !launch ||
    preTask.kind === "invalid" ||
    postTask.kind === "invalid" ||
    (postTask.kind !== "valid" && !serverReadyAction) ||
    (prepared.serverReadyAction !== undefined && !serverReadyAction) ||
    (prepared.nativeWatch !== undefined && nativeWatch?.kind !== "ok") ||
    (prepared.envFile !== undefined && !envFile) ||
    (rawLaunchEnvFile !== undefined && !launchEnvFile) ||
    (rawRuntime !== undefined && !runtime) ||
    (launchEnvFile !== envFile && (launchEnvFile !== null || envFile !== null)) ||
    ((envFile !== null || runtime !== null) && launch.kind !== "node-configured-script")
  ) {
    return null;
  }
  const launchWithMetadata =
    launch.kind === "node-configured-script" && (envFile || runtime)
      ? Object.freeze({
          ...launch,
          ...(envFile ? { envFile } : {}),
          ...(runtime ? { runtime } : {}),
        })
      : launch;
  return Object.freeze({
    ...(envFile ? { envFile } : {}),
    launch: launchWithMetadata,
    ...(nativeWatch?.kind === "ok" ? { nativeWatch: nativeWatch.intent } : {}),
    preLaunchTask: preTask.kind === "valid" ? preTask.task : null,
    ...(postTask.kind === "valid" ? { postDebugTask: postTask.task } : {}),
    ...(serverReadyAction ? { serverReadyAction } : {}),
  });
}

function cloneRuntime(value: unknown): "tsx" | "ts-node" | null {
  return value === "tsx" || value === "ts-node" ? value : null;
}

function cloneEnvFile(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    new TextEncoder().encode(value).length > 4 * 1024 ||
    value.includes("\\") ||
    value.includes("${") ||
    value.startsWith("/") ||
    /^[A-Za-z]:\//u.test(value) ||
    value.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
  ) {
    return null;
  }
  return value;
}

function cloneServerReadyAction(
  recipe: VscodeNodeServerReadyActionRecipe | undefined,
): VscodeNodeServerReadyActionRecipe | null {
  if (recipe === undefined) return null;
  return cloneVscodeNodeServerReadyActionRecipe(recipe);
}

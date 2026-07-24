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
  if (
    !launch ||
    preTask.kind === "invalid" ||
    postTask.kind === "invalid" ||
    (postTask.kind !== "valid" && !serverReadyAction) ||
    (prepared.serverReadyAction !== undefined && !serverReadyAction) ||
    (prepared.nativeWatch !== undefined && nativeWatch?.kind !== "ok")
  ) {
    return null;
  }
  return Object.freeze({
    launch,
    ...(nativeWatch?.kind === "ok" ? { nativeWatch: nativeWatch.intent } : {}),
    preLaunchTask: preTask.kind === "valid" ? preTask.task : null,
    ...(postTask.kind === "valid" ? { postDebugTask: postTask.task } : {}),
    ...(serverReadyAction ? { serverReadyAction } : {}),
  });
}

function cloneServerReadyAction(
  recipe: VscodeNodeServerReadyActionRecipe | undefined,
): VscodeNodeServerReadyActionRecipe | null {
  if (recipe === undefined) return null;
  return cloneVscodeNodeServerReadyActionRecipe(recipe);
}

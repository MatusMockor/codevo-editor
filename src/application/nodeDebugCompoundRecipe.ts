import type { DebugCompoundLaunchTarget, DebugLaunchTarget } from "../domain/debug";
import {
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  MIN_NODE_DEBUG_COMPOUND_MEMBERS,
} from "./nodeDebugCompoundSessionCoordinator";
import { cloneNodeLaunchTarget, type NodeDebugLaunchTarget } from "./debugRestartCoordinator";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";

export interface NodeDebugCompoundMemberRecipe {
  readonly launch: DebugCompoundLaunchTarget & { readonly stopOnEntry?: boolean };
}

/**
 * Defensively owns the task-free launch recipes for one exact Node compound.
 * The returned collection contains only launch kinds supported by the native
 * compound gateway and is deeply frozen by `cloneNodeLaunchTarget`.
 */
export function cloneNodeDebugCompoundMembers(
  members: readonly PreparedNodeDebugLaunch[],
): readonly NodeDebugCompoundMemberRecipe[] | null {
  if (
    !Array.isArray(members) ||
    members.length < MIN_NODE_DEBUG_COMPOUND_MEMBERS ||
    members.length > MAX_NODE_DEBUG_COMPOUND_MEMBERS
  ) {
    return null;
  }
  const cloned: NodeDebugCompoundMemberRecipe[] = [];
  for (const member of members) {
    if (
      !isRecord(member) ||
      unknownKey(member, ["launch", "preLaunchTask", "postDebugTask"]) ||
      member.preLaunchTask !== null ||
      (member.postDebugTask !== undefined && member.postDebugTask !== null)
    ) {
      return null;
    }
    const launch = cloneNodeLaunchTarget(member.launch as DebugLaunchTarget);
    if (!launch || !isCompoundLaunch(launch)) return null;
    cloned.push(Object.freeze({ launch }));
  }
  return Object.freeze(cloned);
}

function isCompoundLaunch(
  launch: ReturnType<typeof cloneNodeLaunchTarget>,
): launch is Extract<
  NodeDebugLaunchTarget,
  { kind: "node-script" | "node-configured-script" | "node-npm-script" }
> {
  return (
    launch?.kind === "node-script" ||
    launch?.kind === "node-configured-script" ||
    launch?.kind === "node-npm-script"
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unknownKey(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).some((key) => !allowed.includes(key));
}

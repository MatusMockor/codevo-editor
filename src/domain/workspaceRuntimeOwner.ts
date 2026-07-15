import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

declare const workspaceRuntimeOwnerKeyBrand: unique symbol;

export type WorkspaceRuntimeOwnerKey = string & {
  readonly [workspaceRuntimeOwnerKeyBrand]: "WorkspaceRuntimeOwnerKey";
};

/** Stable runtime identity paired with the path selected for execution. */
export interface WorkspaceRuntimeOwner {
  readonly ownerKey: WorkspaceRuntimeOwnerKey;
  readonly executionRoot: string;
}

/** Creates an owner for a workspace that passed identity admission. */
export function createWorkspaceRuntimeOwner(
  workspaceId: string,
  executionRoot: string,
): WorkspaceRuntimeOwner {
  requireValue(workspaceId, "Workspace runtime owner ID");
  requireValue(executionRoot, "Workspace runtime execution root");

  return runtimeOwner(workspaceId, executionRoot);
}

/** Creates a path-owned runtime for callers that predate identity admission. */
export function createLegacyWorkspaceRuntimeOwner(
  executionRoot: string,
): WorkspaceRuntimeOwner {
  requireValue(executionRoot, "Workspace runtime execution root");

  return runtimeOwner(normalizedWorkspaceRootKey(executionRoot), executionRoot);
}

/** Selects a new execution path without changing the stable runtime owner. */
export function transferWorkspaceRuntimeOwner(
  owner: WorkspaceRuntimeOwner,
  executionRoot: string,
): WorkspaceRuntimeOwner {
  requireValue(executionRoot, "Workspace runtime execution root");

  if (owner.executionRoot === executionRoot) {
    return owner;
  }

  return runtimeOwner(owner.ownerKey, executionRoot);
}

function runtimeOwner(
  ownerKey: string,
  executionRoot: string,
): WorkspaceRuntimeOwner {
  return Object.freeze({
    ownerKey: ownerKey as WorkspaceRuntimeOwnerKey,
    executionRoot,
  });
}

function requireValue(value: string, name: string): void {
  if (value.trim()) {
    return;
  }

  throw new TypeError(`${name} must be non-empty`);
}

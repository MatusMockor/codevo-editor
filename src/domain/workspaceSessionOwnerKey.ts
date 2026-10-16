import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

declare const workspaceSessionOwnerKeyBrand: unique symbol;

export type WorkspaceSessionOwnerKey = string & {
  readonly [workspaceSessionOwnerKeyBrand]: "WorkspaceSessionOwnerKey";
};

export function createWorkspaceSessionOwnerKey(
  workspaceId: string,
  canonicalRoot: string,
): WorkspaceSessionOwnerKey {
  requireValue(workspaceId, "Editor session workspace ID");
  requireValue(canonicalRoot, "Editor session canonical root");

  return `editor-session:${JSON.stringify([
    workspaceId,
    normalizedWorkspaceRootKey(canonicalRoot),
  ])}` as WorkspaceSessionOwnerKey;
}

export function createLegacyWorkspaceSessionOwnerKey(rootPath: string): WorkspaceSessionOwnerKey {
  requireValue(rootPath, "Editor session root");

  return normalizedWorkspaceRootKey(rootPath) as WorkspaceSessionOwnerKey;
}

export function resolveWorkspaceSessionOwnerKey(
  rootPath: string,
  descriptor?: {
    canonicalRoot?: string;
    workspaceId?: string;
  } | null,
): WorkspaceSessionOwnerKey {
  if (
    typeof descriptor?.workspaceId === "string" &&
    descriptor.workspaceId.trim() &&
    typeof descriptor.canonicalRoot === "string" &&
    descriptor.canonicalRoot.trim()
  ) {
    return createWorkspaceSessionOwnerKey(descriptor.workspaceId, descriptor.canonicalRoot);
  }

  return createLegacyWorkspaceSessionOwnerKey(rootPath);
}

function requireValue(value: string, name: string): void {
  if (value.trim()) {
    return;
  }

  throw new TypeError(`${name} must be non-empty`);
}

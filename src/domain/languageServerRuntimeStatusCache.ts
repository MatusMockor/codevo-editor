import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import {
  createLegacyWorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwner,
  type WorkspaceRuntimeOwnerKey,
} from "./workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";
export { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export type LanguageServerRuntimeStatusByOwner = Record<
  WorkspaceRuntimeOwnerKey,
  LanguageServerRuntimeStatus
>;

/** Compatibility name for root-keyed callers that have not adopted owners. */
export type LanguageServerRuntimeStatusByRoot = Record<
  string,
  LanguageServerRuntimeStatus
>;

export function languageServerRuntimeStatusWithRoot(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  if (
    status.rootPath &&
    normalizedWorkspaceRootKey(status.rootPath) ===
      normalizedWorkspaceRootKey(rootPath)
  ) {
    return status;
  }

  return {
    ...status,
    rootPath,
  };
}

export function cacheLanguageServerRuntimeStatus(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string,
  status: LanguageServerRuntimeStatus,
): LanguageServerRuntimeStatus {
  return cacheLanguageServerRuntimeStatusForOwner(
    cache,
    createLegacyWorkspaceRuntimeOwner(rootPath),
    status,
  );
}

export function cacheLanguageServerRuntimeStatusForOwner(
  cache: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner,
  status: LanguageServerRuntimeStatus,
): LanguageServerRuntimeStatus {
  const rootedStatus = languageServerRuntimeStatusWithRoot(
    status,
    owner.executionRoot,
  );
  cache[owner.ownerKey] = rootedStatus;

  return rootedStatus;
}

export function cachedLanguageServerRuntimeStatusForRoot(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string | null,
): LanguageServerRuntimeStatus | null {
  if (!rootPath) {
    return null;
  }

  return cachedLanguageServerRuntimeStatusForOwner(
    cache,
    createLegacyWorkspaceRuntimeOwner(rootPath),
  );
}

export function cachedLanguageServerRuntimeStatusForOwner(
  cache: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner,
): LanguageServerRuntimeStatus | null {
  const status = cache[owner.ownerKey];

  if (!status) {
    return null;
  }

  const transferredStatus = languageServerRuntimeStatusWithRoot(
    status,
    owner.executionRoot,
  );
  cache[owner.ownerKey] = transferredStatus;

  return transferredStatus;
}

export function removeCachedLanguageServerRuntimeStatus(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string,
): void {
  forgetCachedLanguageServerRuntimeStatus(
    cache,
    createLegacyWorkspaceRuntimeOwner(rootPath),
  );
}

export function forgetCachedLanguageServerRuntimeStatus(
  cache: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner,
): void {
  delete cache[owner.ownerKey];
}

export function clearCachedLanguageServerRuntimeStatuses(
  cache: LanguageServerRuntimeStatusByOwner,
): void {
  for (const ownerKey of Object.keys(cache) as WorkspaceRuntimeOwnerKey[]) {
    delete cache[ownerKey];
  }
}

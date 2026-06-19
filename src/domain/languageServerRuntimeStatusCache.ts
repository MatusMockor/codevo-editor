import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import { normalizedWorkspaceRootKey } from "./workspaceRootKey";
export { normalizedWorkspaceRootKey } from "./workspaceRootKey";

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
  const rootedStatus = languageServerRuntimeStatusWithRoot(status, rootPath);
  cache[normalizedWorkspaceRootKey(rootPath)] = rootedStatus;

  return rootedStatus;
}

export function cachedLanguageServerRuntimeStatusForRoot(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string | null,
): LanguageServerRuntimeStatus | null {
  if (!rootPath) {
    return null;
  }

  return cache[normalizedWorkspaceRootKey(rootPath)] ?? null;
}

export function removeCachedLanguageServerRuntimeStatus(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string,
): void {
  delete cache[normalizedWorkspaceRootKey(rootPath)];
}

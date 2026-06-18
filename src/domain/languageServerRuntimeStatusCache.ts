import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";

export type LanguageServerRuntimeStatusByRoot = Record<
  string,
  LanguageServerRuntimeStatus
>;

export function languageServerRuntimeStatusWithRoot(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  if (status.rootPath === rootPath) {
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
  cache[rootPath] = rootedStatus;

  return rootedStatus;
}

export function cachedLanguageServerRuntimeStatusForRoot(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string | null,
): LanguageServerRuntimeStatus | null {
  if (!rootPath) {
    return null;
  }

  return cache[rootPath] ?? null;
}

export function removeCachedLanguageServerRuntimeStatus(
  cache: LanguageServerRuntimeStatusByRoot,
  rootPath: string,
): void {
  delete cache[rootPath];
}

import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";

export type LanguageServerRuntimeStatusByRoot = Record<
  string,
  LanguageServerRuntimeStatus
>;

export function normalizedWorkspaceRootKey(
  root: string | null | undefined,
): string {
  if (!root) {
    return "";
  }

  const minimumLength = minimumWorkspaceRootKeyLength(root);
  let end = root.length;

  while (end > minimumLength && isWorkspaceRootSeparator(root[end - 1])) {
    end -= 1;
  }

  return root.slice(0, end);
}

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

function minimumWorkspaceRootKeyLength(root: string): number {
  if (/^[A-Za-z]:[\\/]/.test(root)) {
    return 3;
  }

  if (root.startsWith("/") || root.startsWith("\\")) {
    return 1;
  }

  return 0;
}

function isWorkspaceRootSeparator(character: string | undefined): boolean {
  return character === "/" || character === "\\";
}

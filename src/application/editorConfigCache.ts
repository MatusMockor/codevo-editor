import type { EditorConfigFile } from "../domain/editorConfig";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export type EditorConfigCache = Record<
  string,
  Record<string, EditorConfigFile | null>
>;

export function editorConfigCacheKey(
  rootPath: string,
  owner?: WorkspaceRuntimeOwner,
): string {
  if (!owner) {
    return rootPath;
  }

  return JSON.stringify([rootPath, owner.ownerKey, owner.executionRoot]);
}

export function invalidateEditorConfigCacheForRoot(
  cache: EditorConfigCache,
  rootPath: string,
): void {
  for (const cacheKey of Object.keys(cache)) {
    if (workspaceRootKeysEqual(cacheKey, rootPath)) {
      delete cache[cacheKey];
      continue;
    }

    const ownerKey = parseOwnerCacheKey(cacheKey);
    if (!ownerKey) {
      continue;
    }

    if (
      !workspaceRootKeysEqual(ownerKey.rootPath, rootPath) &&
      !workspaceRootKeysEqual(ownerKey.executionRoot, rootPath)
    ) {
      continue;
    }

    delete cache[cacheKey];
  }
}

interface OwnerCacheKey {
  readonly executionRoot: string;
  readonly rootPath: string;
}

function parseOwnerCacheKey(cacheKey: string): OwnerCacheKey | null {
  let parts: unknown;
  try {
    parts = JSON.parse(cacheKey);
  } catch {
    return null;
  }

  if (!Array.isArray(parts) || parts.length !== 3) {
    return null;
  }

  const [rootPath, ownerKey, executionRoot] = parts;
  if (
    typeof rootPath !== "string" ||
    typeof ownerKey !== "string" ||
    typeof executionRoot !== "string"
  ) {
    return null;
  }

  return { executionRoot, rootPath };
}

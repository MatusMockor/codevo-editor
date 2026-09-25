import { normalizedWorkspaceRootKey } from "./workspaceRootKey";

export const MAX_RECENT_WORKSPACE_OPENED_AT = 25;
const MAX_PATH_CHARS = 4096;

export function normalizeLastCloneParentPath(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (!isBoundedAbsolutePath(value)) return null;
  return normalizedWorkspaceRootKey(value);
}

export function normalizeRecentWorkspaceOpenedAt(value: unknown): Readonly<Record<string, number>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(
      (entry): entry is [string, number] =>
        isBoundedAbsolutePath(entry[0]) &&
        typeof entry[1] === "number" &&
        Number.isSafeInteger(entry[1]) &&
        entry[1] > 0,
    )
    .sort((left, right) => right[1] - left[1])
    .slice(0, MAX_RECENT_WORKSPACE_OPENED_AT);
  return Object.fromEntries(entries);
}

export function recordRecentWorkspaceOpenedAt(
  previous: Readonly<Record<string, number>> | undefined,
  recentPaths: readonly string[],
  openedPath: string,
  nowMs: number,
): Readonly<Record<string, number>> {
  const retained = new Set(recentPaths.map((path) => normalizedWorkspaceRootKey(path)));
  const openedKey = normalizedWorkspaceRootKey(openedPath);
  const next: Record<string, number> = { [openedKey]: nowMs };
  for (const [path, openedAt] of Object.entries(previous ?? {})) {
    const key = normalizedWorkspaceRootKey(path);
    if (key === openedKey || !retained.has(key)) continue;
    next[key] = openedAt;
  }
  return normalizeRecentWorkspaceOpenedAt(next);
}

function isBoundedAbsolutePath(value: string): boolean {
  return value.startsWith("/") && value.length <= MAX_PATH_CHARS && !value.includes("\u0000");
}

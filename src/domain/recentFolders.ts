import { normalizedWorkspaceRootKey, workspaceDisplayName } from "./workspaceRootKey";

export type RecentFolderEntry = Readonly<{
  path: string;
  label: string;
  openedAtMs: number | null;
}>;
export const MAX_RECENT_FOLDER_ENTRIES = 5;

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

export function recentFolderEntries(
  input: Readonly<{
    recentPaths: readonly string[];
    openedAt: Readonly<Record<string, number>>;
    excludeRoots: readonly string[];
  }>,
): readonly RecentFolderEntry[] {
  const excluded = new Set(input.excludeRoots.map((root) => normalizedWorkspaceRootKey(root)));
  return input.recentPaths
    .filter((path) => !excluded.has(normalizedWorkspaceRootKey(path)))
    .slice(0, MAX_RECENT_FOLDER_ENTRIES)
    .map((path) => ({
      path,
      label: workspaceDisplayName(path),
      openedAtMs: input.openedAt[normalizedWorkspaceRootKey(path)] ?? null,
    }));
}

export function recentFolderAge(openedAtMs: number | null, nowMs: number): string | null {
  if (openedAtMs === null) return null;
  const elapsed = Math.max(0, nowMs - openedAtMs);
  if (elapsed < MINUTE) return "now";
  if (elapsed < HOUR) return `${Math.floor(elapsed / MINUTE)}m`;
  if (elapsed < DAY) return `${Math.floor(elapsed / HOUR)}h`;
  if (elapsed < WEEK) return `${Math.floor(elapsed / DAY)}d`;
  return `${Math.floor(elapsed / WEEK)}w`;
}

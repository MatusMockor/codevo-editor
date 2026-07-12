import type { WorkspaceSessionViewState } from "./settings";
import { workspaceRootKeysEqual } from "./workspaceRootKey";

export interface RecentlyClosedTab {
  path: string;
  viewState?: WorkspaceSessionViewState;
}

export type RecentlyClosedTabs = Record<string, RecentlyClosedTab[]>;

export interface RecentlyClosedTabPop {
  entry: RecentlyClosedTab | null;
  tabs: RecentlyClosedTabs;
}

const RECENTLY_CLOSED_TAB_LIMIT = 10;

export function emptyRecentlyClosedTabs(): RecentlyClosedTabs {
  return {};
}

export function hasRecentlyClosedTabs(
  tabs: RecentlyClosedTabs,
  rootPath: string,
): boolean {
  return (tabs[rootPath]?.length ?? 0) > 0;
}

export function pushRecentlyClosedTab(
  tabs: RecentlyClosedTabs,
  rootPath: string,
  entry: RecentlyClosedTab,
): RecentlyClosedTabs {
  const current = tabs[rootPath] ?? [];
  const next = [
    entry,
    ...current.filter((candidate) => candidate.path !== entry.path),
  ].slice(0, RECENTLY_CLOSED_TAB_LIMIT);

  return { ...tabs, [rootPath]: next };
}

export function popRecentlyClosedTab(
  tabs: RecentlyClosedTabs,
  rootPath: string,
): RecentlyClosedTabPop {
  const current = tabs[rootPath] ?? [];
  const entry = current[0] ?? null;

  if (!entry) {
    return { entry: null, tabs };
  }

  const next = current.slice(1);

  if (next.length > 0) {
    return { entry, tabs: { ...tabs, [rootPath]: next } };
  }

  return { entry, tabs: clearRecentlyClosedTabs(tabs, rootPath) };
}

export function clearRecentlyClosedTabs(
  tabs: RecentlyClosedTabs,
  rootPath: string,
): RecentlyClosedTabs {
  const matchingRootPath = Object.keys(tabs).find((candidate) =>
    workspaceRootKeysEqual(candidate, rootPath),
  );

  if (!matchingRootPath) {
    return tabs;
  }

  const next = { ...tabs };
  delete next[matchingRootPath];
  return next;
}

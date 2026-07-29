import { isPersistableEditorDocumentPath } from "./editorDocumentSchemes";
import {
  createInitialEditorGroupsState,
  editorGroupVisiblePaths,
  type EditorGroupsState,
} from "./editorGroups";

import type { MarkdownPreviewTab } from "./markdownPreview";
import { visibleEditorPaths, type EditorDocument, type ImageTab } from "./workspace";
import {
  truncateWorkspaceSessionSnippet,
  WORKSPACE_SESSION_NAME_MAX_BYTES,
  WORKSPACE_SESSION_NAVIGATION_MAX_BYTES,
  WORKSPACE_SESSION_PATH_MAX_BYTES,
  WORKSPACE_SESSION_POSITION_MAX,
  type WorkspaceSessionNavigation,
  type WorkspaceSessionState,
} from "./settings";
import { createNavigationHistory, MAX_STACK_DEPTH, type NavigationHistory } from "./navigation";
import { RECENT_FILES_LIMIT, type RecentFileEntry } from "./recentFiles";
import { RECENT_LOCATIONS_LIMIT, type RecentLocation } from "./recentLocations";
import { workspaceRelativePath } from "./pathDerivation";

export { isPersistableEditorDocumentPath };
const textEncoder = new TextEncoder();

export interface EditorSurfaceSnapshot {
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  editorGroups?: EditorGroupsState;
  imageTabs: Record<string, ImageTab>;
  markdownPreviewTabs: Record<string, MarkdownPreviewTab>;
  openPaths: string[];
  previewPath: string | null;
}

export interface EditorSurfaceSnapshotInputs {
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  editorGroups: EditorGroupsState;
  imageTabs: Record<string, ImageTab>;
  markdownPreviewTabs: Record<string, MarkdownPreviewTab>;
  openPaths: string[];
  previewPath: string | null;
}

export interface EditorSurfaceRestore {
  activePath: string | null;
  documents: Record<string, EditorDocument>;
  editorGroups: EditorGroupsState;
  imageTabs: Record<string, ImageTab>;
  markdownPreviewTabs: Record<string, MarkdownPreviewTab>;
  openPaths: string[];
  previewPath: string | null;
}

export interface WorkspaceNavigationSnapshotInputs {
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
  rootPath: string;
}

export interface WorkspaceNavigationRestore {
  navigationHistory: NavigationHistory;
  recentFiles: RecentFileEntry[];
  recentLocations: RecentLocation[];
}

export function buildWorkspaceNavigationSnapshot(
  inputs: WorkspaceNavigationSnapshotInputs,
): WorkspaceSessionNavigation {
  const candidate: WorkspaceSessionNavigation = {
    backStack: inputs.navigationHistory.backStack
      .slice(-MAX_STACK_DEPTH)
      .flatMap((entry) => persistedNavigationLocation(inputs.rootPath, entry)),
    forwardStack: inputs.navigationHistory.forwardStack
      .slice(0, MAX_STACK_DEPTH)
      .flatMap((entry) => persistedNavigationLocation(inputs.rootPath, entry)),
    recentFiles: inputs.recentFiles
      .slice(0, RECENT_FILES_LIMIT)
      .flatMap((entry) => persistedRecentFile(inputs.rootPath, entry)),
    recentLocations: inputs.recentLocations
      .slice(0, RECENT_LOCATIONS_LIMIT)
      .flatMap((entry) => persistedRecentLocation(inputs.rootPath, entry)),
  };
  let byteLength = navigationByteLength(candidate);

  while (byteLength > WORKSPACE_SESSION_NAVIGATION_MAX_BYTES) {
    if (candidate.forwardStack.length > 0) {
      byteLength -= removedArrayEntryBytes(candidate.forwardStack);
      continue;
    }

    if (candidate.backStack.length > 0) {
      byteLength -= removedArrayEntryBytes(candidate.backStack, "head");
      continue;
    }

    if (candidate.recentLocations.length > 0) {
      byteLength -= removedArrayEntryBytes(candidate.recentLocations);
      continue;
    }

    if (candidate.recentFiles.length > 0) {
      byteLength -= removedArrayEntryBytes(candidate.recentFiles);
      continue;
    }

    break;
  }

  return candidate;
}

function persistedNavigationLocation(
  rootPath: string,
  entry: NavigationHistory["backStack"][number],
): NavigationHistory["backStack"] {
  const path = workspaceRelativePath(rootPath, entry.path);
  if (
    path === null ||
    !isBoundedString(path, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
    !isBoundedPosition(entry.position.column) ||
    !isBoundedPosition(entry.position.lineNumber)
  ) {
    return [];
  }

  return [{ path, position: { ...entry.position } }];
}

function persistedRecentFile(rootPath: string, entry: RecentFileEntry): RecentFileEntry[] {
  const path = workspaceRelativePath(rootPath, entry.path);
  if (
    path === null ||
    !isBoundedString(path, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
    !isBoundedString(entry.name, WORKSPACE_SESSION_NAME_MAX_BYTES, false)
  ) {
    return [];
  }

  return [{ name: entry.name, path }];
}

function persistedRecentLocation(rootPath: string, entry: RecentLocation): RecentLocation[] {
  const path = workspaceRelativePath(rootPath, entry.path);
  if (
    path === null ||
    !isBoundedString(path, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
    !isBoundedString(entry.name, WORKSPACE_SESSION_NAME_MAX_BYTES, false) ||
    !isBoundedString(entry.relativePath, WORKSPACE_SESSION_PATH_MAX_BYTES, false) ||
    !isBoundedPosition(entry.column) ||
    !isBoundedPosition(entry.line)
  ) {
    return [];
  }

  return [
    {
      ...entry,
      path,
      snippet: truncateWorkspaceSessionSnippet(entry.snippet),
    },
  ];
}

function isBoundedString(value: string, maxBytes: number, allowEmpty: boolean): boolean {
  if (!allowEmpty && value.length === 0) {
    return false;
  }

  if (value.length > maxBytes) {
    return false;
  }

  return textEncoder.encode(value).byteLength <= maxBytes;
}

function isBoundedPosition(value: number): boolean {
  return Number.isInteger(value) && value > 0 && value <= WORKSPACE_SESSION_POSITION_MAX;
}

function navigationByteLength(value: WorkspaceSessionNavigation): number {
  return textEncoder.encode(JSON.stringify(value)).byteLength;
}

function removedArrayEntryBytes<T>(entries: T[], end: "head" | "tail" = "tail"): number {
  const previousLength = entries.length;
  const removed = end === "head" ? entries.shift() : entries.pop();

  if (removed === undefined) {
    return 0;
  }

  return textEncoder.encode(JSON.stringify(removed)).byteLength + (previousLength > 1 ? 1 : 0);
}

export function selectWorkspaceNavigationRestore(
  session: WorkspaceSessionState,
  rootPath: string,
): WorkspaceNavigationRestore {
  const navigation = session.navigation;

  if (!navigation) {
    return {
      navigationHistory: createNavigationHistory(),
      recentFiles: [],
      recentLocations: [],
    };
  }

  return {
    navigationHistory: {
      backStack: navigation.backStack.flatMap((entry) =>
        restoredNavigationLocation(rootPath, entry),
      ),
      forwardStack: navigation.forwardStack.flatMap((entry) =>
        restoredNavigationLocation(rootPath, entry),
      ),
    },
    recentFiles: navigation.recentFiles.flatMap((entry) => {
      const path = restoredWorkspacePath(rootPath, entry.path);
      return path ? [{ ...entry, path }] : [];
    }),
    recentLocations: navigation.recentLocations.flatMap((entry) => {
      const path = restoredWorkspacePath(rootPath, entry.path);
      return path ? [{ ...entry, path }] : [];
    }),
  };
}

function restoredNavigationLocation(
  rootPath: string,
  entry: NavigationHistory["backStack"][number],
): NavigationHistory["backStack"] {
  const path = restoredWorkspacePath(rootPath, entry.path);
  return path ? [{ ...entry, path }] : [];
}

function restoredWorkspacePath(rootPath: string, path: string): string | null {
  if (workspaceRelativePath(rootPath, path) !== null) {
    return path;
  }

  if (path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path)) {
    return null;
  }

  if (path.split(/[\\/]/).some((part) => part === "..")) {
    return null;
  }

  const root = rootPath.replace(/[\\/]+$/, "");
  if (!root || !path) {
    return null;
  }

  return `${root}/${path.replace(/\\/g, "/")}`;
}

export function workspaceSessionSnapshotsEqual(
  left: WorkspaceSessionState,
  right: WorkspaceSessionState,
  baseEqual: (left: WorkspaceSessionState, right: WorkspaceSessionState) => boolean,
): boolean {
  return (
    baseEqual(left, right) && workspaceNavigationSnapshotsEqual(left.navigation, right.navigation)
  );
}

function workspaceNavigationSnapshotsEqual(
  left: WorkspaceSessionNavigation | undefined,
  right: WorkspaceSessionNavigation | undefined,
): boolean {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  if (
    left.backStack.length !== right.backStack.length ||
    left.forwardStack.length !== right.forwardStack.length ||
    left.recentFiles.length !== right.recentFiles.length ||
    left.recentLocations.length !== right.recentLocations.length
  ) {
    return false;
  }

  for (let index = 0; index < left.backStack.length; index += 1) {
    const leftEntry = left.backStack[index];
    const rightEntry = right.backStack[index];
    if (
      leftEntry?.path !== rightEntry?.path ||
      leftEntry?.position.column !== rightEntry?.position.column ||
      leftEntry?.position.lineNumber !== rightEntry?.position.lineNumber
    ) {
      return false;
    }
  }

  for (let index = 0; index < left.forwardStack.length; index += 1) {
    const leftEntry = left.forwardStack[index];
    const rightEntry = right.forwardStack[index];
    if (
      leftEntry?.path !== rightEntry?.path ||
      leftEntry?.position.column !== rightEntry?.position.column ||
      leftEntry?.position.lineNumber !== rightEntry?.position.lineNumber
    ) {
      return false;
    }
  }

  for (let index = 0; index < left.recentFiles.length; index += 1) {
    const leftEntry = left.recentFiles[index];
    const rightEntry = right.recentFiles[index];
    if (leftEntry?.name !== rightEntry?.name || leftEntry?.path !== rightEntry?.path) {
      return false;
    }
  }

  for (let index = 0; index < left.recentLocations.length; index += 1) {
    const leftEntry = left.recentLocations[index];
    const rightEntry = right.recentLocations[index];
    if (
      leftEntry?.column !== rightEntry?.column ||
      leftEntry?.line !== rightEntry?.line ||
      leftEntry?.name !== rightEntry?.name ||
      leftEntry?.path !== rightEntry?.path ||
      leftEntry?.relativePath !== rightEntry?.relativePath ||
      leftEntry?.snippet !== rightEntry?.snippet
    ) {
      return false;
    }
  }

  return true;
}

export function hasWorkspaceNavigationSnapshotEntries(
  navigation: WorkspaceSessionNavigation,
): boolean {
  return (
    navigation.backStack.length > 0 ||
    navigation.forwardStack.length > 0 ||
    navigation.recentFiles.length > 0 ||
    navigation.recentLocations.length > 0
  );
}

export function buildWorkspaceSessionSnapshot(
  session: WorkspaceSessionState,
  previousNavigation: WorkspaceSessionNavigation | undefined,
  navigation: WorkspaceSessionNavigation,
): WorkspaceSessionState {
  if (!hasWorkspaceNavigationSnapshotEntries(navigation)) {
    if (!previousNavigation) {
      return session;
    }

    const { navigation: _navigation, ...withoutNavigation } = session;
    return withoutNavigation;
  }

  if (previousNavigation === navigation) {
    return session;
  }

  return { ...session, navigation };
}

export function restoredActivePath(
  activePath: string | null,
  restoredPaths: string[],
): string | null {
  if (activePath && restoredPaths.includes(activePath)) {
    return activePath;
  }

  return restoredPaths[0] || null;
}

export function buildEditorSurfaceSnapshot(
  inputs: EditorSurfaceSnapshotInputs,
): EditorSurfaceSnapshot {
  const {
    activePath,
    documents,
    editorGroups,
    imageTabs,
    markdownPreviewTabs,
    openPaths,
    previewPath,
  } = inputs;
  const cacheableDocuments = Object.fromEntries(
    Object.entries(documents).filter(([path]) => isPersistableEditorDocumentPath(path)),
  );
  const cacheableOpenPaths = openPaths.filter(
    (path) =>
      (isPersistableEditorDocumentPath(path) && Boolean(documents[path])) ||
      Boolean(imageTabs[path]) ||
      Boolean(markdownPreviewTabs[path]),
  );
  const cacheablePreviewPath =
    previewPath &&
    ((isPersistableEditorDocumentPath(previewPath) && documents[previewPath]) ||
      imageTabs[previewPath] ||
      markdownPreviewTabs[previewPath])
      ? previewPath
      : null;
  const cacheableActivePath =
    activePath &&
    ((isPersistableEditorDocumentPath(activePath) && documents[activePath]) ||
      imageTabs[activePath] ||
      markdownPreviewTabs[activePath])
      ? activePath
      : null;

  return {
    activePath: cacheableActivePath,
    documents: cacheableDocuments,
    editorGroups,
    imageTabs,
    markdownPreviewTabs,
    openPaths: cacheableOpenPaths,
    previewPath: cacheablePreviewPath,
  };
}

export function selectEditorSurfaceRestore(snapshot: EditorSurfaceSnapshot): EditorSurfaceRestore {
  const restoredDocuments = Object.fromEntries(
    Object.entries(snapshot.documents).filter(([path]) => isPersistableEditorDocumentPath(path)),
  );
  const restoredImageTabs = snapshot.imageTabs;
  const restoredMarkdownPreviewTabs = snapshot.markdownPreviewTabs ?? {};
  const restoredOpenPaths = snapshot.openPaths.filter((path) =>
    Boolean(
      restoredDocuments[path] || restoredImageTabs[path] || restoredMarkdownPreviewTabs[path],
    ),
  );
  const restoredPreviewPath =
    snapshot.previewPath &&
    (restoredDocuments[snapshot.previewPath] ||
      restoredImageTabs[snapshot.previewPath] ||
      restoredMarkdownPreviewTabs[snapshot.previewPath])
      ? snapshot.previewPath
      : null;
  const cacheableActivePath =
    snapshot.activePath &&
    (restoredDocuments[snapshot.activePath] ||
      restoredImageTabs[snapshot.activePath] ||
      restoredMarkdownPreviewTabs[snapshot.activePath])
      ? snapshot.activePath
      : null;
  const nextActivePath = restoredActivePath(
    cacheableActivePath,
    visibleEditorPaths(restoredOpenPaths, restoredPreviewPath),
  );
  const cachedEditorGroups =
    snapshot.editorGroups ??
    createInitialEditorGroupsState("editor-main", {
      activePath: nextActivePath,
      openPaths: restoredOpenPaths,
      previewPath: restoredPreviewPath,
    });
  const availablePaths = new Set([
    ...Object.keys(restoredDocuments),
    ...Object.keys(restoredImageTabs),
    ...Object.keys(restoredMarkdownPreviewTabs),
  ]);
  const groups = Object.fromEntries(
    Object.entries(cachedEditorGroups.groups).map(([groupId, group]) => {
      const visiblePaths = editorGroupVisiblePaths(group).filter((path) =>
        availablePaths.has(path),
      );
      const previewPath =
        group.previewPath && availablePaths.has(group.previewPath) ? group.previewPath : null;
      return [
        groupId,
        {
          activePath: restoredActivePath(group.activePath, visiblePaths),
          openPaths: visiblePaths.filter((path) => path !== previewPath),
          previewPath,
        },
      ];
    }),
  );

  return {
    activePath: nextActivePath,
    documents: restoredDocuments,
    editorGroups: { ...cachedEditorGroups, groups },
    imageTabs: restoredImageTabs,
    markdownPreviewTabs: restoredMarkdownPreviewTabs,
    openPaths: restoredOpenPaths,
    previewPath: restoredPreviewPath,
  };
}

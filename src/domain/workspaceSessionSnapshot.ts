import {
  createInitialEditorGroupsState,
  editorGroupVisiblePaths,
  type EditorGroupsState,
} from "./editorGroups";
import type { MarkdownPreviewTab } from "./markdownPreview";
import {
  visibleEditorPaths,
  type EditorDocument,
  type ImageTab,
} from "./workspace";

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

export function isPersistableEditorDocumentPath(path: string): boolean {
  return (
    !path.startsWith("mockor-git-diff:") &&
    !path.startsWith("mockor-git-history-diff:") &&
    !path.startsWith("mockor-markdown-preview:")
  );
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
    Object.entries(documents).filter(([path]) =>
      isPersistableEditorDocumentPath(path),
    ),
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

export function selectEditorSurfaceRestore(
  snapshot: EditorSurfaceSnapshot,
): EditorSurfaceRestore {
  const restoredDocuments = Object.fromEntries(
    Object.entries(snapshot.documents).filter(([path]) =>
      isPersistableEditorDocumentPath(path),
    ),
  );
  const restoredImageTabs = snapshot.imageTabs;
  const restoredMarkdownPreviewTabs = snapshot.markdownPreviewTabs ?? {};
  const restoredOpenPaths = snapshot.openPaths.filter(
    (path) =>
      Boolean(
        restoredDocuments[path] ||
          restoredImageTabs[path] ||
          restoredMarkdownPreviewTabs[path],
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
  const cachedEditorGroups = snapshot.editorGroups ??
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
      const previewPath = group.previewPath && availablePaths.has(group.previewPath)
        ? group.previewPath
        : null;
      return [groupId, {
        activePath: restoredActivePath(group.activePath, visiblePaths),
        openPaths: visiblePaths.filter((path) => path !== previewPath),
        previewPath,
      }];
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

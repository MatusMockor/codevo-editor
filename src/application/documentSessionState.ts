import type {
  WorkspaceSessionBottomPanelView,
  WorkspaceSessionSidebarView,
  WorkspaceSessionState,
} from "../domain/settings";

export interface DocumentSessionDocument {
  content: string;
  path: string;
  savedContent: string;
}

export interface DocumentSessionPathTransition {
  nextActivePath: string;
  nextOpenPaths: string[];
  nextPreviewPath: string | null;
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

export function isPersistableEditorDocumentPath(path: string): boolean {
  return (
    !path.startsWith("mockor-git-diff:") &&
    !path.startsWith("mockor-git-history-diff:")
  );
}

export function pinDocumentSessionPath(
  openPaths: string[],
  previewPath: string | null,
  path: string,
): Omit<DocumentSessionPathTransition, "nextActivePath"> {
  return {
    nextOpenPaths: openPaths.includes(path) ? openPaths : [...openPaths, path],
    nextPreviewPath: previewPath === path ? null : previewPath,
  };
}

export function documentSessionPathTransitionForOpenedPath({
  openPaths,
  path,
  pin,
  replacedPath,
}: {
  openPaths: string[];
  path: string;
  pin: boolean;
  replacedPath: string | null;
}): DocumentSessionPathTransition {
  if (!pin) {
    return {
      nextActivePath: path,
      nextOpenPaths: openPaths.filter((openPath) => openPath !== replacedPath),
      nextPreviewPath: path,
    };
  }

  if (!replacedPath) {
    return {
      nextActivePath: path,
      nextOpenPaths: openPaths.includes(path) ? openPaths : [...openPaths, path],
      nextPreviewPath: null,
    };
  }

  const mappedOpenPaths = openPaths.map((openPath) =>
    openPath === replacedPath ? path : openPath,
  );

  return {
    nextActivePath: path,
    nextOpenPaths: mappedOpenPaths.includes(path)
      ? mappedOpenPaths
      : [...mappedOpenPaths, path],
    nextPreviewPath: null,
  };
}

export function replaceableDocumentSessionPreview<
  Document extends DocumentSessionDocument,
>(
  activeDocument: Document | null,
  documents: Record<string, Document>,
  openPaths: string[],
  previewPath: string | null,
): Document | null {
  if (
    activeDocument &&
    !isDirtySessionDocument(activeDocument) &&
    !openPaths.includes(activeDocument.path)
  ) {
    return activeDocument;
  }

  if (!previewPath) {
    return null;
  }

  if (openPaths.includes(previewPath)) {
    return null;
  }

  const previewDocument = documents[previewPath] ?? null;

  if (!previewDocument || isDirtySessionDocument(previewDocument)) {
    return null;
  }

  return previewDocument;
}

export function currentWorkspaceSession(
  rootPath: string,
  openPaths: string[],
  activePath: string | null,
  sidebarView: WorkspaceSessionSidebarView,
  bottomPanelView: WorkspaceSessionBottomPanelView,
): WorkspaceSessionState {
  const sessionPaths = openPaths.filter(
    (path) =>
      isPersistableEditorDocumentPath(path) &&
      isSessionPathInWorkspace(rootPath, path),
  );

  return {
    activePath:
      activePath && sessionPaths.includes(activePath) ? activePath : null,
    bottomPanelView: persistedBottomPanelView(bottomPanelView),
    openPaths: sessionPaths,
    sidebarView,
  };
}

export function restoredBottomPanelView(
  view: WorkspaceSessionState["bottomPanelView"],
): WorkspaceSessionState["bottomPanelView"] {
  if (view === "terminal") {
    return "problems";
  }

  return view;
}

export function persistedBottomPanelView(
  view: WorkspaceSessionState["bottomPanelView"],
): WorkspaceSessionState["bottomPanelView"] {
  if (view === "terminal") {
    return "problems";
  }

  return view;
}

export function workspaceSessionsEqual(
  left: WorkspaceSessionState,
  right: WorkspaceSessionState,
): boolean {
  return (
    left.activePath === right.activePath &&
    left.bottomPanelView === right.bottomPanelView &&
    left.sidebarView === right.sidebarView &&
    left.openPaths.length === right.openPaths.length &&
    left.openPaths.every((path, index) => path === right.openPaths[index])
  );
}

export function isSessionPathInWorkspace(
  rootPath: string,
  path: string,
): boolean {
  const root = normalizedSessionPath(rootPath);
  const candidate = normalizedSessionPath(path);

  if (candidate === root) {
    return true;
  }

  return candidate.startsWith(`${root}/`);
}

function normalizedSessionPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

function isDirtySessionDocument(document: DocumentSessionDocument): boolean {
  return document.content !== document.savedContent;
}

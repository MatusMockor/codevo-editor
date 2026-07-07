import type {
  WorkspaceSessionBottomPanelView,
  WorkspaceSessionSidebarView,
  WorkspaceSessionState,
} from "../domain/settings";

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

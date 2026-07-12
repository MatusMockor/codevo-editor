import type {
  WorkspaceSessionBottomPanelView,
  WorkspaceSessionSidebarView,
  WorkspaceSessionState,
  WorkspaceSessionViewState,
} from "../domain/settings";
import {
  editorGroupVisiblePaths,
  normalizeEditorGroupsState,
  type EditorGroupsState,
} from "../domain/editorGroups";
import {
  DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  WORKSPACE_SESSION_VERSION,
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
    !path.startsWith("mockor-git-history-diff:") &&
    !path.startsWith("mockor-markdown-preview:")
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
  previewPath: string | null = null,
  viewStates: Record<string, WorkspaceSessionViewState> = {},
): WorkspaceSessionState {
  return currentWorkspaceSessionForEditorGroups(
    rootPath,
    normalizeEditorGroupsState(
      { activePath, openPaths, previewPath },
      DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
    ),
    sidebarView,
    bottomPanelView,
    { [DEFAULT_WORKSPACE_EDITOR_GROUP_ID]: viewStates },
  );
}

export function currentWorkspaceSessionForEditorGroups(
  rootPath: string,
  editor: EditorGroupsState,
  sidebarView: WorkspaceSessionSidebarView,
  bottomPanelView: WorkspaceSessionBottomPanelView,
  viewStates: Record<string, Record<string, WorkspaceSessionViewState>> = {},
  restorablePaths?: ReadonlySet<string>,
): WorkspaceSessionState {
  const groups = Object.fromEntries(
    Object.entries(editor.groups).map(([groupId, group]) => {
      const visiblePaths = editorGroupVisiblePaths(group).filter(
        (path) => isPersistableEditorDocumentPath(path) &&
          isSessionPathInWorkspace(rootPath, path) &&
          (!restorablePaths || restorablePaths.has(path)),
      );
      const previewPath = group.previewPath && visiblePaths.includes(group.previewPath)
        ? group.previewPath
        : null;
      const openPaths = visiblePaths.filter((path) => path !== previewPath);
      const activePath = group.activePath && visiblePaths.includes(group.activePath)
        ? group.activePath
        : null;

      return [groupId, { activePath, openPaths, previewPath }];
    }),
  );
  const normalizedEditor = normalizeEditorGroupsState(
    { ...editor, groups },
    DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  );
  const persistedViewStates = Object.fromEntries(
    Object.entries(normalizedEditor.groups).flatMap(([groupId, group]) => {
      const groupViewStates = Object.fromEntries(
        editorGroupVisiblePaths(group).flatMap((path) => {
          const viewState = viewStates[groupId]?.[path];
          return viewState ? [[path, viewState]] : [];
        }),
      );
      return Object.keys(groupViewStates).length > 0
        ? [[groupId, groupViewStates]]
        : [];
    }),
  );
  const session: WorkspaceSessionState = {
    bottomPanelView: persistedBottomPanelView(bottomPanelView),
    editor: normalizedEditor,
    sidebarView,
    version: WORKSPACE_SESSION_VERSION,
  };

  if (Object.keys(persistedViewStates).length > 0) {
    session.viewStates = persistedViewStates;
  }

  return session;
}

export interface RestoredWorkspaceSession<Document> {
  documents: Record<string, Document>;
  editor: EditorGroupsState;
  failedPaths: string[];
  viewStates: Record<string, Record<string, WorkspaceSessionViewState>>;
}

export async function restoreWorkspaceSession<Document>(
  rootPath: string,
  session: WorkspaceSessionState,
  readDocument: (path: string) => Promise<Document>,
): Promise<RestoredWorkspaceSession<Document>> {
  const editor = normalizeEditorGroupsState(
    session.editor,
    DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  );
  const eligiblePaths = Array.from(new Set(
    Object.values(editor.groups)
      .flatMap(editorGroupVisiblePaths)
      .filter((path) => isPersistableEditorDocumentPath(path) &&
        isSessionPathInWorkspace(rootPath, path)),
  ));
  const readResults = await Promise.all(eligiblePaths.map(async (path) => {
    try {
      return { document: await readDocument(path), path, restored: true as const };
    } catch {
      return { path, restored: false as const };
    }
  }));
  const documents = Object.fromEntries(
    readResults.flatMap((result) =>
      result.restored ? [[result.path, result.document]] : [],
    ),
  );
  const failedPaths = readResults.flatMap((result) =>
    result.restored ? [] : [result.path],
  );

  const restoredPaths = new Set(Object.keys(documents));
  const groups = Object.fromEntries(
    Object.entries(editor.groups).map(([groupId, group]) => {
      const originalVisiblePaths = editorGroupVisiblePaths(group);
      const visiblePaths = originalVisiblePaths.filter((path) => restoredPaths.has(path));
      const previewPath = group.previewPath && restoredPaths.has(group.previewPath)
        ? group.previewPath
        : null;
      const openPaths = visiblePaths.filter((path) => path !== previewPath);
      const activePath = restoredActivePath(group.activePath, visiblePaths);
      return [groupId, { activePath, openPaths, previewPath }];
    }),
  );
  const restoredEditor = normalizeEditorGroupsState(
    { ...editor, groups },
    DEFAULT_WORKSPACE_EDITOR_GROUP_ID,
  );
  const viewStates = Object.fromEntries(
    Object.entries(restoredEditor.groups).flatMap(([groupId, group]) => {
      const restoredGroupViewStates = Object.fromEntries(
        editorGroupVisiblePaths(group).flatMap((path) => {
          const viewState = session.viewStates?.[groupId]?.[path];
          return viewState ? [[path, viewState]] : [];
        }),
      );
      return Object.keys(restoredGroupViewStates).length > 0
        ? [[groupId, restoredGroupViewStates]]
        : [];
    }),
  );

  return { documents, editor: restoredEditor, failedPaths, viewStates };
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
    left.bottomPanelView === right.bottomPanelView &&
    left.sidebarView === right.sidebarView &&
    workspaceSessionEditorsEqual(left.editor, right.editor) &&
    workspaceSessionGroupViewStatesEqual(left.viewStates, right.viewStates)
  );
}

function workspaceSessionEditorsEqual(
  left: EditorGroupsState,
  right: EditorGroupsState,
): boolean {
  const leftGroupIds = Object.keys(left.groups);
  const rightGroupIds = Object.keys(right.groups);
  if (
    left.activeGroupId !== right.activeGroupId ||
    leftGroupIds.length !== rightGroupIds.length ||
    JSON.stringify(left.layout) !== JSON.stringify(right.layout)
  ) {
    return false;
  }

  return leftGroupIds.every((groupId) => {
    const leftGroup = left.groups[groupId];
    const rightGroup = right.groups[groupId];
    return Boolean(rightGroup) &&
      leftGroup.activePath === rightGroup.activePath &&
      leftGroup.previewPath === rightGroup.previewPath &&
      leftGroup.openPaths.length === rightGroup.openPaths.length &&
      leftGroup.openPaths.every((path, index) =>
        path === rightGroup.openPaths[index]
      );
  });
}

function workspaceSessionGroupViewStatesEqual(
  left: WorkspaceSessionState["viewStates"],
  right: WorkspaceSessionState["viewStates"],
): boolean {
  const leftEntries = Object.entries(left ?? {});
  const rightEntries = Object.entries(right ?? {});

  if (leftEntries.length !== rightEntries.length) {
    return false;
  }

  return leftEntries.every(([groupId, viewStates]) =>
    workspaceSessionViewStatesEqual(viewStates, right?.[groupId]),
  );
}

function workspaceSessionViewStatesEqual(
  left: Record<string, WorkspaceSessionViewState>,
  right?: Record<string, WorkspaceSessionViewState>,
): boolean {
  const leftEntries = Object.entries(left);
  if (leftEntries.length !== Object.keys(right ?? {}).length) {
    return false;
  }
  return leftEntries.every(([path, viewState]) => {
    const other = right?.[path];
    return other?.line === viewState.line &&
      other.column === viewState.column &&
      other.scrollTop === viewState.scrollTop &&
      numberListsEqual(other.foldedLines, viewState.foldedLines);
  });
}

function numberListsEqual(left?: number[], right?: number[]): boolean {
  const normalizedLeft = left ?? [];
  const normalizedRight = right ?? [];

  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => value === normalizedRight[index])
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

  if (root === "/") {
    return candidate.startsWith("/");
  }

  if (root.endsWith("/")) {
    return candidate.startsWith(root);
  }

  return candidate.startsWith(`${root}/`);
}

function normalizedSessionPath(path: string): string {
  const slashPath = path.trim().split("\\").join("/");
  const driveMatch = /^([A-Za-z]:)(?:\/+|$)/.exec(slashPath);
  const prefix = driveMatch
    ? `${driveMatch[1].toUpperCase()}/`
    : slashPath.startsWith("//")
      ? "//"
      : slashPath.startsWith("/")
        ? "/"
        : "";
  const remainder = driveMatch
    ? slashPath.slice(driveMatch[0].length)
    : slashPath.replace(/^\/+/, "");
  const segments: string[] = [];
  const protectedSegmentCount = prefix === "//" ? 2 : 0;

  for (const segment of remainder.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment !== "..") {
      segments.push(segment);
      continue;
    }
    if (
      segments.length > protectedSegmentCount &&
      segments[segments.length - 1] !== ".."
    ) {
      segments.pop();
      continue;
    }
    if (!prefix) {
      segments.push(segment);
    }
  }

  return `${prefix}${segments.join("/")}` || ".";
}

function isDirtySessionDocument(document: DocumentSessionDocument): boolean {
  return document.content !== document.savedContent;
}

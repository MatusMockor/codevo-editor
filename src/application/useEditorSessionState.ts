import {
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import {
  activateEditorGroupPath,
  createEditorGroup,
  createInitialEditorGroupsState,
  editorGroupVisiblePaths,
  updateEditorGroupOpenPaths,
  updateEditorGroupPreviewPath,
  type EditorGroupsState,
} from "../domain/editorGroups";
import { isPersistableEditorDocumentPath } from "../domain/editorDocumentSchemes";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  buildEditorSurfaceSnapshot,
  restoredActivePath,
  selectEditorSurfaceRestore,
  type EditorSurfaceSnapshot,
} from "../domain/workspaceSessionSnapshot";
import type {
  EditorDocument,
  ImageTab,
} from "../domain/workspace";
import { isSessionPathInWorkspace } from "./documentSessionState";

type Documents = Record<string, EditorDocument>;
type ImageTabs = Record<string, ImageTab>;
type MarkdownPreviewTabs = Record<string, MarkdownPreviewTab>;

export interface EditorSessionState {
  activeDocument: EditorDocument | null;
  activeDocumentRef: MutableRefObject<EditorDocument | null>;
  activeGroupId: string;
  activeImage: ImageTab | null;
  activeMarkdownPreview: MarkdownPreviewTab | null;
  activePath: string | null;
  documents: Documents;
  documentsRef: MutableRefObject<Documents>;
  editorGroups: EditorGroupsState;
  editorGroupsRef: MutableRefObject<EditorGroupsState>;
  imageTabs: ImageTabs;
  imageTabsRef: MutableRefObject<ImageTabs>;
  markdownPreviewTabs: MarkdownPreviewTabs;
  markdownPreviewTabsRef: MutableRefObject<MarkdownPreviewTabs>;
  nextEditorGroupIdRef: MutableRefObject<number>;
  openPaths: string[];
  openPathsRef: MutableRefObject<string[]>;
  previewPath: string | null;
  previewPathRef: MutableRefObject<string | null>;
  resetEditorSurfaceState: () => void;
  restoreEditorSurface: (
    rootPath: string,
    snapshot: EditorSurfaceSnapshot,
  ) => void;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setDocuments: Dispatch<SetStateAction<Documents>>;
  setImageTabs: Dispatch<SetStateAction<ImageTabs>>;
  setMarkdownPreviewTabs: Dispatch<SetStateAction<MarkdownPreviewTabs>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  snapshotEditorSurface: (rootPath: string) => EditorSurfaceSnapshot;
  updateEditorGroups: (
    update: (current: EditorGroupsState) => EditorGroupsState,
  ) => void;
}

export function useEditorSessionState(): EditorSessionState {
  const [documents, setDocumentsState] = useState<Documents>({});
  const [imageTabs, setImageTabsState] = useState<ImageTabs>({});
  const [markdownPreviewTabs, setMarkdownPreviewTabsState] =
    useState<MarkdownPreviewTabs>({});
  const [editorGroups, setEditorGroupsState] = useState<EditorGroupsState>(() =>
    createInitialEditorGroupsState("editor-main"),
  );
  const documentsRef = useRef<Documents>({});
  const imageTabsRef = useRef<ImageTabs>({});
  const markdownPreviewTabsRef = useRef<MarkdownPreviewTabs>({});
  const editorGroupsRef = useRef(editorGroups);
  const nextEditorGroupIdRef = useRef(1);
  const activeDocumentRef = useRef<EditorDocument | null>(null);
  const openPathsRef = useRef<string[]>([]);
  const previewPathRef = useRef<string | null>(null);

  const synchronizeActiveGroupRefs = useCallback((next: EditorGroupsState) => {
    const group = next.groups[next.activeGroupId] ?? createEditorGroup();
    openPathsRef.current = group.openPaths;
    previewPathRef.current = group.previewPath;
    activeDocumentRef.current = group.activePath
      ? documentsRef.current[group.activePath] ?? null
      : null;
  }, []);

  const setDocuments = useCallback<Dispatch<SetStateAction<Documents>>>(
    (update) => {
      const next = resolveStateUpdate(documentsRef.current, update);
      documentsRef.current = next;
      synchronizeActiveGroupRefs(editorGroupsRef.current);
      setDocumentsState(next);
    },
    [synchronizeActiveGroupRefs],
  );

  const setImageTabs = useCallback<Dispatch<SetStateAction<ImageTabs>>>(
    (update) => {
      const next = resolveStateUpdate(imageTabsRef.current, update);
      imageTabsRef.current = next;
      setImageTabsState(next);
    },
    [],
  );

  const setMarkdownPreviewTabs = useCallback<
    Dispatch<SetStateAction<MarkdownPreviewTabs>>
  >((update) => {
    const next = resolveStateUpdate(markdownPreviewTabsRef.current, update);
    markdownPreviewTabsRef.current = next;
    setMarkdownPreviewTabsState(next);
  }, []);

  const updateEditorGroups = useCallback(
    (update: (current: EditorGroupsState) => EditorGroupsState) => {
      const next = update(editorGroupsRef.current);
      editorGroupsRef.current = next;
      synchronizeActiveGroupRefs(next);
      setEditorGroupsState(next);
    },
    [synchronizeActiveGroupRefs],
  );

  const activeGroupId = editorGroups.activeGroupId;
  const activeGroup = editorGroups.groups[activeGroupId] ?? createEditorGroup();
  const { activePath, openPaths, previewPath } = activeGroup;
  const activeDocument = activePath ? documents[activePath] ?? null : null;
  const activeImage = activePath ? imageTabs[activePath] ?? null : null;
  const activeMarkdownPreview = activePath
    ? markdownPreviewTabs[activePath] ?? null
    : null;

  const setActivePath = useCallback<Dispatch<SetStateAction<string | null>>>(
    (update) => {
      updateEditorGroups((current) => {
        const group = current.groups[current.activeGroupId];
        if (!group) {
          return current;
        }

        return {
          ...current,
          groups: {
            ...current.groups,
            [current.activeGroupId]: activateEditorGroupPath(
              group,
              resolveStateUpdate(group.activePath, update),
            ),
          },
        };
      });
    },
    [updateEditorGroups],
  );

  const setOpenPaths = useCallback<Dispatch<SetStateAction<string[]>>>(
    (update) => {
      updateEditorGroups((current) => {
        const group = current.groups[current.activeGroupId];
        if (!group) {
          return current;
        }

        return {
          ...current,
          groups: {
            ...current.groups,
            [current.activeGroupId]: updateEditorGroupOpenPaths(group, update),
          },
        };
      });
    },
    [updateEditorGroups],
  );

  const setPreviewPath = useCallback<Dispatch<SetStateAction<string | null>>>(
    (update) => {
      updateEditorGroups((current) => {
        const group = current.groups[current.activeGroupId];
        if (!group) {
          return current;
        }

        return {
          ...current,
          groups: {
            ...current.groups,
            [current.activeGroupId]: updateEditorGroupPreviewPath(group, update),
          },
        };
      });
    },
    [updateEditorGroups],
  );

  const resetEditorSurfaceState = useCallback(() => {
    const nextEditorGroups = createInitialEditorGroupsState("editor-main");
    documentsRef.current = {};
    imageTabsRef.current = {};
    markdownPreviewTabsRef.current = {};
    editorGroupsRef.current = nextEditorGroups;
    nextEditorGroupIdRef.current = 1;
    synchronizeActiveGroupRefs(nextEditorGroups);
    setDocumentsState({});
    setImageTabsState({});
    setMarkdownPreviewTabsState({});
    setEditorGroupsState(nextEditorGroups);
  }, [synchronizeActiveGroupRefs]);

  const snapshotEditorSurface = useCallback(
    (rootPath: string) => {
      const current = editorGroupsRef.current;
      const group = current.groups[current.activeGroupId] ?? createEditorGroup();

      return scopeEditorSurfaceSnapshot(
        rootPath,
        buildEditorSurfaceSnapshot({
          activePath: group.activePath,
          documents: documentsRef.current,
          editorGroups: current,
          imageTabs: imageTabsRef.current,
          markdownPreviewTabs: markdownPreviewTabsRef.current,
          openPaths: group.openPaths,
          previewPath: group.previewPath,
        }),
      );
    },
    [],
  );

  const restoreEditorSurface = useCallback(
    (rootPath: string, snapshot: EditorSurfaceSnapshot) => {
      const restored = selectEditorSurfaceRestore(
        scopeEditorSurfaceSnapshot(rootPath, snapshot),
      );
      setDocuments(restored.documents);
      setImageTabs(restored.imageTabs);
      setMarkdownPreviewTabs(restored.markdownPreviewTabs);
      updateEditorGroups(() => restored.editorGroups);
    },
    [setDocuments, setImageTabs, setMarkdownPreviewTabs, updateEditorGroups],
  );

  return {
    activeDocument,
    activeDocumentRef,
    activeGroupId,
    activeImage,
    activeMarkdownPreview,
    activePath,
    documents,
    documentsRef,
    editorGroups,
    editorGroupsRef,
    imageTabs,
    imageTabsRef,
    markdownPreviewTabs,
    markdownPreviewTabsRef,
    nextEditorGroupIdRef,
    openPaths,
    openPathsRef,
    previewPath,
    previewPathRef,
    resetEditorSurfaceState,
    restoreEditorSurface,
    setActivePath,
    setDocuments,
    setImageTabs,
    setMarkdownPreviewTabs,
    setOpenPaths,
    setPreviewPath,
    snapshotEditorSurface,
    updateEditorGroups,
  };
}

function scopeEditorSurfaceSnapshot(
  rootPath: string,
  snapshot: EditorSurfaceSnapshot,
): EditorSurfaceSnapshot {
  const documents = filterPathRecord(snapshot.documents, (path) =>
    isPersistableWorkspacePath(rootPath, path),
  );
  const imageTabs = filterPathRecord(snapshot.imageTabs, (path) =>
    isPersistableWorkspacePath(rootPath, path),
  );
  const markdownPreviewTabs = filterPathRecord(
    snapshot.markdownPreviewTabs ?? {},
    (_path, preview) =>
      isPersistableWorkspacePath(rootPath, preview.sourcePath),
  );
  const availablePaths = new Set([
    ...Object.keys(documents),
    ...Object.keys(imageTabs),
    ...Object.keys(markdownPreviewTabs),
  ]);
  const snapshotEditorGroups =
    snapshot.editorGroups ??
    createInitialEditorGroupsState("editor-main", {
      activePath: snapshot.activePath,
      openPaths: snapshot.openPaths,
      previewPath: snapshot.previewPath,
    });
  const editorGroups = scopeEditorGroupsToAvailablePaths(
    snapshotEditorGroups,
    availablePaths,
  );
  const activeGroup =
    editorGroups.groups[editorGroups.activeGroupId] ?? createEditorGroup();

  return {
    activePath: activeGroup.activePath,
    documents,
    editorGroups,
    imageTabs,
    markdownPreviewTabs,
    openPaths: activeGroup.openPaths,
    previewPath: activeGroup.previewPath,
  };
}

function scopeEditorGroupsToAvailablePaths(
  editorGroups: EditorGroupsState,
  availablePaths: ReadonlySet<string>,
): EditorGroupsState {
  const groups = Object.fromEntries(
    Object.entries(editorGroups.groups).map(([groupId, group]) => {
      const visiblePaths = editorGroupVisiblePaths(group).filter((path) =>
        availablePaths.has(path),
      );
      const previewPath =
        group.previewPath && availablePaths.has(group.previewPath)
          ? group.previewPath
          : null;

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

  return { ...editorGroups, groups };
}

function filterPathRecord<Value>(
  record: Record<string, Value>,
  include: (path: string, value: Value) => boolean,
): Record<string, Value> {
  return Object.fromEntries(
    Object.entries(record).filter(([path, value]) => include(path, value)),
  );
}

function isPersistableWorkspacePath(rootPath: string, path: string): boolean {
  return (
    isPersistableEditorDocumentPath(path) &&
    isSessionPathInWorkspace(rootPath, path)
  );
}

function resolveStateUpdate<Value>(
  current: Value,
  update: SetStateAction<Value>,
): Value {
  if (typeof update === "function") {
    return (update as (value: Value) => Value)(current);
  }

  return update;
}

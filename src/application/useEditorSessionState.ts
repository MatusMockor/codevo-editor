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
  updateEditorGroupOpenPaths,
  updateEditorGroupPreviewPath,
  type EditorGroupsState,
} from "../domain/editorGroups";
import type { MarkdownPreviewTab } from "../domain/markdownPreview";
import {
  buildEditorSurfaceSnapshot,
  selectEditorSurfaceRestore,
  type EditorSurfaceSnapshot,
} from "../domain/workspaceSessionSnapshot";
import type {
  EditorDocument,
  ImageTab,
} from "../domain/workspace";

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
  restoreEditorSurface: (snapshot: EditorSurfaceSnapshot) => void;
  setActivePath: Dispatch<SetStateAction<string | null>>;
  setDocuments: Dispatch<SetStateAction<Documents>>;
  setImageTabs: Dispatch<SetStateAction<ImageTabs>>;
  setMarkdownPreviewTabs: Dispatch<SetStateAction<MarkdownPreviewTabs>>;
  setOpenPaths: Dispatch<SetStateAction<string[]>>;
  setPreviewPath: Dispatch<SetStateAction<string | null>>;
  snapshotEditorSurface: () => EditorSurfaceSnapshot;
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
    () => {
      const current = editorGroupsRef.current;
      const group = current.groups[current.activeGroupId] ?? createEditorGroup();

      return buildEditorSurfaceSnapshot({
        activePath: group.activePath,
        documents: documentsRef.current,
        editorGroups: current,
        imageTabs: imageTabsRef.current,
        markdownPreviewTabs: markdownPreviewTabsRef.current,
        openPaths: group.openPaths,
        previewPath: group.previewPath,
      });
    },
    [],
  );

  const restoreEditorSurface = useCallback(
    (snapshot: EditorSurfaceSnapshot) => {
      const restored = selectEditorSurfaceRestore(snapshot);
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

function resolveStateUpdate<Value>(
  current: Value,
  update: SetStateAction<Value>,
): Value {
  if (typeof update === "function") {
    return (update as (value: Value) => Value)(current);
  }

  return update;
}

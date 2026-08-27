import { useCallback, useMemo, useRef, type MutableRefObject } from "react";
import type { EslintDiagnosticsGateway } from "../../domain/eslintDiagnostics";
import type { EditorGroupsState } from "../../domain/editorGroups";
import type { PrettierFormattingGateway } from "../../domain/prettierFormatting";
import type { WorkspaceSessionViewState } from "../../domain/settings";
import { getFileName, type FileEntry } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { RunWithDocumentSaveExclusion } from "../documentSaveCoordinator";
import {
  createEslintFixOnSaveParticipant,
  orderedDocumentSaveParticipants,
} from "../documentSaveParticipants";
import { createPrettierSaveParticipant } from "../prettierSaveParticipant";
import { useDocumentLifecycle } from "../useDocumentLifecycle";
import { useWorkbenchEditorGroupCloseLifecycle } from "../useWorkbenchEditorGroupCloseLifecycle";

type DocumentLifecycleDependencies = Parameters<typeof useDocumentLifecycle>[0];
type DocumentLifecycle = ReturnType<typeof useDocumentLifecycle>;
type EditorGroupCloseDependencies = Parameters<typeof useWorkbenchEditorGroupCloseLifecycle>[0];
type EditorGroupCloseLifecycle = ReturnType<typeof useWorkbenchEditorGroupCloseLifecycle>;

interface RecentlyClosedDocumentDependencies {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly editorGroupsRef: MutableRefObject<EditorGroupsState>;
  readonly editorSessionOwnerKeyForRoot: (rootPath: string) => string;
  readonly openPinnedFile: (entry: FileEntry, shouldCommit?: () => boolean) => Promise<boolean>;
  readonly setEditorRevealTarget: (target: {
    readonly path: string;
    readonly position: { readonly column: number; readonly lineNumber: number };
  }) => void;
  readonly setRestoredEditorViewStateRevision: (update: (revision: number) => number) => void;
  readonly setRecentlyClosedTabsVersion: (update: (version: number) => number) => void;
  readonly workspaceEditorViewStatesRef: MutableRefObject<
    Record<string, Record<string, Record<string, WorkspaceSessionViewState>>>
  >;
}

export interface WorkbenchDocumentLifecycleCoordinatorDependencies {
  readonly closeLifecycle: Omit<
    EditorGroupCloseDependencies,
    "closeTextDocument" | "closeTextSurface" | "runWithIssuedWriteDrain" | "saveDocument"
  >;
  readonly eslintDiagnostics: Pick<EslintDiagnosticsGateway, "analyseDocument">;
  readonly lifecycle: Omit<
    DocumentLifecycleDependencies,
    | "onRecentlyClosedTabsChange"
    | "openRecentlyClosedDocument"
    | "recentlyClosedDocumentViewState"
    | "restoreRecentlyClosedDocumentViewState"
    | "saveParticipants"
  >;
  readonly prettierFormatting: PrettierFormattingGateway;
  readonly recentlyClosedDocuments: RecentlyClosedDocumentDependencies;
  readonly requestOwnerDocumentSaveRef: MutableRefObject<
    DocumentLifecycle["requestOwnerDocumentSave"]
  >;
  readonly runWithDocumentSaveExclusionRef: MutableRefObject<RunWithDocumentSaveExclusion>;
  readonly runWithIssuedWriteDrainRef: MutableRefObject<RunWithDocumentSaveExclusion>;
  readonly workspaceTrusted: boolean;
}

export interface WorkbenchDocumentLifecycleCoordinator {
  readonly canReopenClosedDocument: DocumentLifecycle["canReopenClosedDocument"];
  readonly captureLocalHistorySnapshot: DocumentLifecycle["captureLocalHistorySnapshot"];
  readonly closeActiveEditorGroup: EditorGroupCloseLifecycle["closeActiveEditorGroup"];
  readonly closeDocument: EditorGroupCloseLifecycle["closeDocument"];
  readonly closeDocumentInEditorGroup: EditorGroupCloseLifecycle["closeDocumentInEditorGroup"];
  readonly isWorkspaceTrusted: () => boolean;
  readonly onActiveLiveDocumentSaveBindingChange: DocumentLifecycle["onActiveLiveDocumentSaveBindingChange"];
  readonly reopenClosedDocument: DocumentLifecycle["reopenClosedDocument"];
  readonly requestOwnerDocumentSave: DocumentLifecycle["requestOwnerDocumentSave"];
  readonly runCloseActiveEditorGroup: () => Promise<void>;
  readonly runCloseActiveEditorGroupSurface: () => Promise<void>;
  readonly runCloseDocument: (
    path: string,
  ) => ReturnType<EditorGroupCloseLifecycle["closeDocument"]>;
  readonly runWithDocumentSaveExclusion: DocumentLifecycle["runWithDocumentSaveExclusion"];
  readonly saveActiveDocument: DocumentLifecycle["saveActiveDocument"];
  readonly workspaceTrustedRef: MutableRefObject<boolean>;
}

export interface StableWorkbenchDocumentCloseCommands {
  readonly runCloseActiveEditorGroup: () => Promise<void>;
  readonly runCloseActiveEditorGroupSurface: () => Promise<void>;
  readonly runCloseDocument: (
    path: string,
  ) => ReturnType<EditorGroupCloseLifecycle["closeDocument"]>;
}

export function useStableWorkbenchDocumentCloseCommands(
  closeDocument: EditorGroupCloseLifecycle["closeDocument"],
  closeActiveEditorGroup: EditorGroupCloseLifecycle["closeActiveEditorGroup"],
  closeActiveEditorGroupSurface: EditorGroupCloseLifecycle["closeActiveEditorGroupSurface"],
): StableWorkbenchDocumentCloseCommands {
  const closeDocumentForCommandsRef = useRef(closeDocument);
  const closeActiveEditorGroupForCommandsRef = useRef(closeActiveEditorGroup);
  const closeActiveEditorGroupSurfaceForCommandsRef = useRef(closeActiveEditorGroupSurface);
  closeDocumentForCommandsRef.current = closeDocument;
  closeActiveEditorGroupForCommandsRef.current = closeActiveEditorGroup;
  closeActiveEditorGroupSurfaceForCommandsRef.current = closeActiveEditorGroupSurface;
  const runCloseDocument = useCallback(
    (path: string) => closeDocumentForCommandsRef.current(path),
    [],
  );
  const runCloseActiveEditorGroup = useCallback(async () => {
    await closeActiveEditorGroupForCommandsRef.current();
  }, []);
  const runCloseActiveEditorGroupSurface = useCallback(async () => {
    await closeActiveEditorGroupSurfaceForCommandsRef.current();
  }, []);

  return {
    runCloseActiveEditorGroup,
    runCloseActiveEditorGroupSurface,
    runCloseDocument,
  };
}

export function useWorkbenchDocumentLifecycleCoordinator({
  closeLifecycle,
  eslintDiagnostics,
  lifecycle,
  prettierFormatting,
  recentlyClosedDocuments,
  requestOwnerDocumentSaveRef,
  runWithDocumentSaveExclusionRef,
  runWithIssuedWriteDrainRef,
  workspaceTrusted,
}: WorkbenchDocumentLifecycleCoordinatorDependencies): WorkbenchDocumentLifecycleCoordinator {
  const {
    currentWorkspaceRootRef,
    editorGroupsRef,
    editorSessionOwnerKeyForRoot,
    openPinnedFile,
    setEditorRevealTarget,
    setRecentlyClosedTabsVersion,
    setRestoredEditorViewStateRevision,
    workspaceEditorViewStatesRef,
  } = recentlyClosedDocuments;
  const recentlyClosedDocumentViewState = useCallback(
    (rootPath: string, path: string) =>
      workspaceEditorViewStatesRef.current[editorSessionOwnerKeyForRoot(rootPath)]?.[
        editorGroupsRef.current.activeGroupId
      ]?.[path],
    [editorGroupsRef, editorSessionOwnerKeyForRoot, workspaceEditorViewStatesRef],
  );

  const onRecentlyClosedTabsChange = useCallback(() => {
    setRecentlyClosedTabsVersion((current) => current + 1);
  }, [setRecentlyClosedTabsVersion]);

  const openRecentlyClosedDocument = useCallback(
    async (rootPath: string, path: string, shouldCommit?: () => boolean) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return false;
      }
      if (shouldCommit?.() === false) {
        return false;
      }

      return openPinnedFile(
        {
          kind: "file",
          name: getFileName(path),
          path,
        },
        shouldCommit,
      );
    },
    [currentWorkspaceRootRef, openPinnedFile],
  );

  const restoreRecentlyClosedDocumentViewState = useCallback(
    (rootPath: string, path: string, viewState: WorkspaceSessionViewState) => {
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return;
      }

      const ownerKey = editorSessionOwnerKeyForRoot(rootPath);
      const current = workspaceEditorViewStatesRef.current[ownerKey] ?? {};
      const groupId = editorGroupsRef.current.activeGroupId;
      current[groupId] = { ...(current[groupId] ?? {}), [path]: viewState };
      workspaceEditorViewStatesRef.current[ownerKey] = current;
      setRestoredEditorViewStateRevision((revision) => revision + 1);
      setEditorRevealTarget({
        path,
        position: { column: viewState.column, lineNumber: viewState.line },
      });
    },
    [
      currentWorkspaceRootRef,
      editorGroupsRef,
      editorSessionOwnerKeyForRoot,
      setEditorRevealTarget,
      setRestoredEditorViewStateRevision,
      workspaceEditorViewStatesRef,
    ],
  );

  const workspaceTrustedRef = useRef(workspaceTrusted);
  workspaceTrustedRef.current = workspaceTrusted;
  const isWorkspaceTrusted = useCallback(() => workspaceTrustedRef.current, []);
  const saveParticipants = useMemo(
    () =>
      orderedDocumentSaveParticipants({
        eslintFixOnSave: createEslintFixOnSaveParticipant({
          analyseDocument: (rootPath, path, content, binaryPath) =>
            eslintDiagnostics.analyseDocument(rootPath, path, content, binaryPath),
          isWorkspaceTrusted,
        }),
        prettierFormatOnSave: createPrettierSaveParticipant({
          prettierFormatting,
          isWorkspaceTrusted,
        }),
      }),
    [eslintDiagnostics, isWorkspaceTrusted, prettierFormatting],
  );

  const {
    captureLocalHistorySnapshot,
    requestOwnerDocumentSave,
    saveDocument,
    saveActiveDocument,
    onActiveLiveDocumentSaveBindingChange,
    runWithDocumentSaveExclusion,
    runWithIssuedWriteDrain,
    closeDocument: closeTextDocument,
    closeActiveSurface: closeTextSurface,
    reopenClosedDocument,
    canReopenClosedDocument,
  } = useDocumentLifecycle({
    ...lifecycle,
    saveParticipants,
    recentlyClosedDocumentViewState,
    openRecentlyClosedDocument,
    restoreRecentlyClosedDocumentViewState,
    onRecentlyClosedTabsChange,
  });
  requestOwnerDocumentSaveRef.current = requestOwnerDocumentSave;
  runWithDocumentSaveExclusionRef.current = runWithDocumentSaveExclusion;
  runWithIssuedWriteDrainRef.current = runWithIssuedWriteDrain;

  const {
    closeDocument,
    closeDocumentInEditorGroup,
    closeActiveEditorGroup,
    closeActiveEditorGroupSurface,
  } = useWorkbenchEditorGroupCloseLifecycle({
    ...closeLifecycle,
    closeTextDocument,
    closeTextSurface,
    saveDocument,
    runWithIssuedWriteDrain,
  });
  const { runCloseDocument, runCloseActiveEditorGroup, runCloseActiveEditorGroupSurface } =
    useStableWorkbenchDocumentCloseCommands(
      closeDocument,
      closeActiveEditorGroup,
      closeActiveEditorGroupSurface,
    );

  return {
    canReopenClosedDocument,
    captureLocalHistorySnapshot,
    closeActiveEditorGroup,
    closeDocument,
    closeDocumentInEditorGroup,
    isWorkspaceTrusted,
    onActiveLiveDocumentSaveBindingChange,
    reopenClosedDocument,
    requestOwnerDocumentSave,
    runCloseActiveEditorGroup,
    runCloseActiveEditorGroupSurface,
    runCloseDocument,
    runWithDocumentSaveExclusion,
    saveActiveDocument,
    workspaceTrustedRef,
  };
}

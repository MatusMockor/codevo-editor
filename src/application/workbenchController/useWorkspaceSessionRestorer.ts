import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import type {
  WorkspaceSessionSidebarView,
  WorkspaceSessionViewState,
  WorkspaceSessionState,
} from "../../domain/settings";
import {
  detectLanguage,
  getFileName,
  readWorkspaceTextFileSnapshot,
  type EditorDocument,
  type WorkspaceFileGateway,
} from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { localPhpDiagnosticsFromSource } from "../diagnosticNotices";
import { restoreWorkspaceSession, restoredBottomPanelView } from "../documentSessionState";
import { createWorkbenchNotice, type WorkbenchNotice } from "../workbenchNotice";
import type { BottomPanelView } from "../../domain/bottomPanel";
import { editorGroupsUniquePaths, type EditorGroupsState } from "../../domain/editorGroups";

interface WorkspaceSessionRestorerOptions {
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly editorSessionOwnerKeyForRoot: (rootPath: string) => string;
  readonly openFileRequestTokenRef: MutableRefObject<number>;
  readonly setBottomPanelView: Dispatch<SetStateAction<BottomPanelView>>;
  readonly setDocuments: Dispatch<SetStateAction<Record<string, EditorDocument>>>;
  readonly setNotices: Dispatch<SetStateAction<WorkbenchNotice[]>>;
  readonly setSidebarView: Dispatch<SetStateAction<WorkspaceSessionSidebarView>>;
  readonly updateEditorGroups: (update: (current: EditorGroupsState) => EditorGroupsState) => void;
  readonly updateLocalPhpDiagnostics: (
    path: string,
    diagnostics: ReturnType<typeof localPhpDiagnosticsFromSource>,
  ) => void;
  readonly viewStatesRef: MutableRefObject<
    Record<string, Record<string, Record<string, WorkspaceSessionViewState>>>
  >;
  readonly workspaceFiles: WorkspaceFileGateway;
}

export function useWorkspaceSessionRestorer({
  currentWorkspaceRootRef,
  editorSessionOwnerKeyForRoot,
  openFileRequestTokenRef,
  setBottomPanelView,
  setDocuments,
  setNotices,
  setSidebarView,
  updateEditorGroups,
  updateLocalPhpDiagnostics,
  viewStatesRef,
  workspaceFiles,
}: WorkspaceSessionRestorerOptions) {
  return useCallback(
    async (
      rootPath: string,
      session: WorkspaceSessionState,
      isMutationOwnerCurrent?: () => boolean,
    ) => {
      const isCurrent = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
        (!isMutationOwnerCurrent || isMutationOwnerCurrent());

      if (editorGroupsUniquePaths(session.editor).length === 0) {
        if (!isCurrent()) {
          return;
        }
        viewStatesRef.current[editorSessionOwnerKeyForRoot(rootPath)] = session.viewStates ?? {};
        setSidebarView(session.sidebarView);
        setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));
        return;
      }

      const openFileRequestToken = openFileRequestTokenRef.current;
      const restored = await restoreWorkspaceSession(
        rootPath,
        session,
        async (path): Promise<EditorDocument> => {
          const snapshot = await readWorkspaceTextFileSnapshot(workspaceFiles, path);
          return {
            content: snapshot.content,
            language: detectLanguage(path),
            name: getFileName(path),
            path,
            revision: snapshot.revision,
            savedContent: snapshot.content,
          };
        },
      );

      if (!isCurrent() || openFileRequestTokenRef.current !== openFileRequestToken) {
        return;
      }
      viewStatesRef.current[editorSessionOwnerKeyForRoot(rootPath)] = restored.viewStates;
      setDocuments(restored.documents);
      updateEditorGroups(() => restored.editor);
      setSidebarView(session.sidebarView);
      setBottomPanelView(restoredBottomPanelView(session.bottomPanelView));

      const restoredActivePath = restored.editor.groups[restored.editor.activeGroupId]?.activePath;
      const restoredActiveDocument = restoredActivePath
        ? restored.documents[restoredActivePath]
        : null;
      if (restoredActiveDocument?.language === "php") {
        updateLocalPhpDiagnostics(
          restoredActiveDocument.path,
          localPhpDiagnosticsFromSource(restoredActiveDocument.content, []),
        );
      }

      if (restored.failedPaths.length > 0) {
        setNotices((current) => [
          createWorkbenchNotice(
            "warning",
            "Session",
            `Could not restore ${restored.failedPaths.length} tab${restored.failedPaths.length === 1 ? "" : "s"}.`,
          ),
          ...current,
        ]);
      }
    },
    [
      currentWorkspaceRootRef,
      editorSessionOwnerKeyForRoot,
      openFileRequestTokenRef,
      setBottomPanelView,
      setDocuments,
      setNotices,
      setSidebarView,
      updateEditorGroups,
      updateLocalPhpDiagnostics,
      viewStatesRef,
      workspaceFiles,
    ],
  );
}

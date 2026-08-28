import { useCallback, useEffect, useMemo, type RefObject } from "react";
import { sortBookmarks, type Bookmark } from "../../domain/bookmarks";
import type { EditorGroupId } from "../../domain/editorGroups";
import type { IndexProgressState } from "../../domain/indexProgress";
import { shouldStartLanguageServer } from "../../domain/intelligence";
import type { IntelligenceMode } from "../../domain/workspace";
import { canUseLanguageServerFeature } from "../../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import { recentFilesForSwitcher, type RecentFileEntry } from "../../domain/recentFiles";
import type { WorkspaceSessionViewState } from "../../domain/settings";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkbenchNotice } from "../workbenchNotice";
import { isRunningLanguageServerForWorkspace } from "./languageServerStatusPolicy";
import { useWorkbenchLanguageRuntimeProjectionRefBridge } from "./useWorkbenchLanguageRuntimeProjection";
import {
  EMPTY_EDITOR_VIEW_STATES,
  EMPTY_EDITOR_VIEW_STATES_BY_GROUP,
} from "../workbenchEmptyProjections";

interface WorkbenchControllerRuntimePresentationDependencies {
  readonly bumpPhpIdeReadinessVersion: () => void;
  readonly emptyDocumentRefreshTimeoutsRef: RefObject<Set<number>>;
  readonly hasPhpWorkspace: boolean;
  readonly indexProgress: IndexProgressState;
  readonly intelligenceMode: IntelligenceMode;
  readonly intelligenceModeRef: RefObject<IntelligenceMode>;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRef: RefObject<LanguageServerRuntimeStatus | null>;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  readonly javaScriptTypeScriptLanguageServerRuntimeStatusRootRef: RefObject<string | null>;
  readonly languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  readonly languageServerRuntimeStatusRef: RefObject<LanguageServerRuntimeStatus | null>;
  readonly languageServerRuntimeStatusRoot: string | null;
  readonly languageServerRuntimeStatusRootRef: RefObject<string | null>;
  readonly lastPhpIdeReadinessSignatureRef: RefObject<string | null>;
  readonly phpFrameworkProviderSignature: string;
  readonly workspaceRoot: string | null;
  readonly workspaceTrusted: boolean;
}

export function useWorkbenchControllerRuntimePresentation(
  dependencies: WorkbenchControllerRuntimePresentationDependencies,
): void {
  const {
    bumpPhpIdeReadinessVersion,
    emptyDocumentRefreshTimeoutsRef,
    hasPhpWorkspace,
    indexProgress,
    intelligenceMode,
    intelligenceModeRef,
    javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRootRef,
    lastPhpIdeReadinessSignatureRef,
    phpFrameworkProviderSignature,
    workspaceRoot,
    workspaceTrusted,
  } = dependencies;
  const phpIdeReadinessSignature = useMemo(() => {
    if (!workspaceRoot || !hasPhpWorkspace) return null;

    if (!shouldStartLanguageServer(intelligenceMode)) return null;

    if (!workspaceTrusted) return null;

    if (
      !isRunningLanguageServerForWorkspace(
        languageServerRuntimeStatus,
        languageServerRuntimeStatusRoot,
        workspaceRoot,
      )
    ) {
      return null;
    }

    if (!canUseLanguageServerFeature(languageServerRuntimeStatus.capabilities, "completion")) {
      return null;
    }

    if (
      indexProgress.status === "scanning" &&
      (!indexProgress.rootPath || workspaceRootKeysEqual(indexProgress.rootPath, workspaceRoot))
    ) {
      return null;
    }

    return [
      workspaceRoot,
      languageServerRuntimeStatus.sessionId ?? "managed",
      phpFrameworkProviderSignature,
      indexProgress.rootPath ?? "no-index-root",
      indexProgress.status,
      indexProgress.indexedFiles,
    ].join(":");
  }, [
    hasPhpWorkspace,
    indexProgress.indexedFiles,
    indexProgress.rootPath,
    indexProgress.status,
    intelligenceMode,
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    phpFrameworkProviderSignature,
    workspaceRoot,
    workspaceTrusted,
  ]);

  useEffect(() => {
    if (!phpIdeReadinessSignature) return;

    if (lastPhpIdeReadinessSignatureRef.current === phpIdeReadinessSignature) return;

    lastPhpIdeReadinessSignatureRef.current = phpIdeReadinessSignature;
    bumpPhpIdeReadinessVersion();
  }, [bumpPhpIdeReadinessVersion, lastPhpIdeReadinessSignatureRef, phpIdeReadinessSignature]);

  useEffect(
    () => () => {
      for (const timeoutId of emptyDocumentRefreshTimeoutsRef.current) {
        window.clearTimeout(timeoutId);
      }

      emptyDocumentRefreshTimeoutsRef.current.clear();
    },
    [emptyDocumentRefreshTimeoutsRef],
  );

  useWorkbenchLanguageRuntimeProjectionRefBridge({
    javaScriptTypeScriptLanguageServerRuntimeStatus:
      javaScriptTypeScriptLanguageServerRuntimeStatus,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef:
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRoot:
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef:
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    languageServerRuntimeStatus: languageServerRuntimeStatus,
    languageServerRuntimeStatusRef: languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRoot: languageServerRuntimeStatusRoot,
    languageServerRuntimeStatusRootRef: languageServerRuntimeStatusRootRef,
  });

  useEffect(() => {
    intelligenceModeRef.current = intelligenceMode;
  }, [intelligenceMode, intelligenceModeRef]);
}

interface WorkbenchControllerPresentationDependencies {
  readonly activeGroupId: EditorGroupId;
  readonly activePath: string | null;
  readonly bookmarks: readonly Bookmark[];
  readonly clearLanguageServerDiagnosticsForPath: (
    rootPath: string | null,
    path: string,
    owner?: WorkspaceRuntimeOwner,
  ) => void;
  readonly editorSessionOwnerKeyForRoot: (rootPath: string) => EditorSessionOwnerKey;
  readonly focusAdjacentEditorGroup: (direction: -1 | 1) => void;
  readonly moveActiveTabToAdjacentGroup: (direction: -1 | 1) => void;
  readonly recentFiles: readonly RecentFileEntry[];
  readonly reportErrorForActiveWorkspaceRoot: (
    rootPath: string | null | undefined,
    source: string,
    error: unknown,
  ) => void;
  readonly setCallHierarchyView: (value: null) => void;
  readonly setImplementationChooser: (value: null) => void;
  readonly setNotices: (
    value: WorkbenchNotice[] | ((current: WorkbenchNotice[]) => WorkbenchNotice[]),
  ) => void;
  readonly setReferencesView: (value: null) => void;
  readonly setTypeHierarchyView: (value: null) => void;
  readonly workspaceEditorViewStatesRef: RefObject<
    Record<string, Record<EditorGroupId, Record<string, WorkspaceSessionViewState>>>
  >;
  readonly workspaceRoot: string | null;
  readonly workspaceRuntimeOwner: WorkspaceRuntimeOwner | null;
}

export function useWorkbenchControllerPresentation(
  dependencies: WorkbenchControllerPresentationDependencies,
) {
  const {
    activeGroupId,
    activePath,
    bookmarks,
    clearLanguageServerDiagnosticsForPath,
    editorSessionOwnerKeyForRoot,
    focusAdjacentEditorGroup,
    moveActiveTabToAdjacentGroup,
    recentFiles,
    reportErrorForActiveWorkspaceRoot,
    setCallHierarchyView,
    setImplementationChooser,
    setNotices,
    setReferencesView,
    setTypeHierarchyView,
    workspaceEditorViewStatesRef,
    workspaceRoot,
    workspaceRuntimeOwner,
  } = dependencies;
  const reportCommandError = useCallback(
    (error: unknown) => reportErrorForActiveWorkspaceRoot(workspaceRoot, "Command", error),
    [reportErrorForActiveWorkspaceRoot, workspaceRoot],
  );
  const restoredEditorViewStatesByGroup = workspaceRoot
    ? (workspaceEditorViewStatesRef.current[editorSessionOwnerKeyForRoot(workspaceRoot)] ??
      EMPTY_EDITOR_VIEW_STATES_BY_GROUP)
    : EMPTY_EDITOR_VIEW_STATES_BY_GROUP;
  const restoredEditorViewStates =
    restoredEditorViewStatesByGroup[activeGroupId] ?? EMPTY_EDITOR_VIEW_STATES;
  const recentFilesSwitcherEntries = useMemo(
    () => recentFilesForSwitcher(recentFiles, activePath),
    [activePath, recentFiles],
  );
  const sortedBookmarks = useMemo(() => sortBookmarks(bookmarks), [bookmarks]);
  const closeImplementationChooser = useCallback(
    () => setImplementationChooser(null),
    [setImplementationChooser],
  );
  const closeCallHierarchy = useCallback(() => setCallHierarchyView(null), [setCallHierarchyView]);
  const closeTypeHierarchy = useCallback(() => setTypeHierarchyView(null), [setTypeHierarchyView]);
  const closeReferencesPanel = useCallback(() => setReferencesView(null), [setReferencesView]);
  const focusNextEditorGroup = useCallback(
    () => focusAdjacentEditorGroup(1),
    [focusAdjacentEditorGroup],
  );
  const focusPreviousEditorGroup = useCallback(
    () => focusAdjacentEditorGroup(-1),
    [focusAdjacentEditorGroup],
  );
  const moveActiveTabToNextGroup = useCallback(
    () => moveActiveTabToAdjacentGroup(1),
    [moveActiveTabToAdjacentGroup],
  );
  const moveActiveTabToPreviousGroup = useCallback(
    () => moveActiveTabToAdjacentGroup(-1),
    [moveActiveTabToAdjacentGroup],
  );
  const clearNotices = useCallback(() => setNotices([]), [setNotices]);
  const clearLanguageServerDiagnosticsForActivePath = useCallback(
    (path: string) =>
      clearLanguageServerDiagnosticsForPath(
        workspaceRoot,
        path,
        workspaceRuntimeOwner ?? undefined,
      ),
    [clearLanguageServerDiagnosticsForPath, workspaceRoot, workspaceRuntimeOwner],
  );

  return {
    clearLanguageServerDiagnosticsForActivePath,
    clearNotices,
    closeCallHierarchy,
    closeImplementationChooser,
    closeReferencesPanel,
    closeTypeHierarchy,
    focusNextEditorGroup,
    focusPreviousEditorGroup,
    moveActiveTabToNextGroup,
    moveActiveTabToPreviousGroup,
    recentFilesSwitcherEntries,
    reportCommandError,
    restoredEditorViewStates,
    restoredEditorViewStatesByGroup,
    sortedBookmarks,
  };
}

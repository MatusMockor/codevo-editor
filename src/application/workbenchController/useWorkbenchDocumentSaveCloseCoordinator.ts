import { useCallback, useRef } from "react";
import { restoreRuntimeStatusCacheEntry } from "../../domain/languageServerRuntimeStatusCache";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import type { RunWithDocumentSaveExclusion } from "../documentSaveCoordinator";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import {
  useRegisteredWorkspaceClosePorts,
  useWorkbenchCloseLifecycle,
  useWorkspaceCloseSessionPort,
  type WorkspaceCloseOwnership,
} from "../useWorkbenchCloseLifecycle";
import {
  releaseWorkspaceRetainedResources,
  useWorkspaceTabRetainedStateCleanupPort,
} from "./workspaceRetainedStateCleanup";
import { useWorkbenchDocumentLifecycleCoordinator } from "./useWorkbenchDocumentLifecycleCoordinator";
import { useWorkbenchDocumentSaveAuthorityCoordinator } from "./useWorkbenchDocumentSaveAuthorityCoordinator";
import { useWorkbenchEditorGroupCoordinator } from "./useWorkbenchEditorGroupCoordinator";
import type { useWorkbenchLanguageRuntimeOwnershipCoordinator } from "./useWorkbenchLanguageServerRuntimeCoordinator";

type SaveAuthorityDependencies = Parameters<typeof useWorkbenchDocumentSaveAuthorityCoordinator>[0];
type CloseLifecycleDependencies = Parameters<typeof useWorkbenchCloseLifecycle>[0];
type DocumentLifecycleDependencies = Parameters<typeof useWorkbenchDocumentLifecycleCoordinator>[0];
type EditorGroupDependencies = Parameters<typeof useWorkbenchEditorGroupCoordinator>[0];
type LanguageRuntimeOwnership = ReturnType<typeof useWorkbenchLanguageRuntimeOwnershipCoordinator>;

type GeneratedCloseLifecycleDependency =
  | "captureDirtyCloseTargets"
  | "clearExternalFileConflictsForRoot"
  | "commitWorkspaceClose"
  | "dirtyCount"
  | "disposeRegisteredWorkspace"
  | "closeRegisteredWorkspaceAgents"
  | "forgetLanguageServerRuntimeStatuses"
  | "invalidateWorkspaceResourceCachesForRoot"
  | "isWorkspaceRuntimeOwnerCurrent"
  | "ownerDocumentSaveRepository"
  | "ownerResolvingDocumentSaveService"
  | "prepareWorkspaceTabRetainedStateCleanup"
  | "requestOwnerDocumentSave"
  | "runWithDocumentSaveExclusion"
  | "stopProjectRuntimes"
  | "workspaceCloseSession"
  | "workspaceHasExternalFileConflicts";

type SaveAuthorityFacet = Pick<
  SaveAuthorityDependencies,
  | "clearExternalFileConflictsForRootRef"
  | "openDocuments"
  | "workspaceHasExternalFileConflictsRef"
  | "workspaceRoot"
> &
  SaveAuthorityDependencies["externalFileConflicts"] &
  SaveAuthorityDependencies["ownerAdapters"] &
  SaveAuthorityDependencies["ownerContext"] &
  SaveAuthorityDependencies["pipeline"] &
  Omit<
    SaveAuthorityDependencies["service"],
    | "filePrefetchCacheRef"
    | "resolveEditorConfigForFile"
    | "syncSavedDocumentForRoot"
    | "syncSavedJavaScriptTypeScriptDocumentForRoot"
  > & {
    readonly filePrefetchCacheRef: DocumentLifecycleDependencies["lifecycle"]["filePrefetchCacheRef"];
    readonly resolveEditorConfigForFile: DocumentLifecycleDependencies["lifecycle"]["resolveEditorConfigForFile"];
    readonly syncSavedDocumentForRoot: DocumentLifecycleDependencies["lifecycle"]["syncSavedDocument"];
    readonly syncSavedJavaScriptTypeScriptDocumentForRoot: DocumentLifecycleDependencies["lifecycle"]["syncSavedJavaScriptTypeScriptDocument"];
  };

type WorkspaceCloseFacet = Omit<
  CloseLifecycleDependencies,
  | GeneratedCloseLifecycleDependency
  | "workspaceIdentityByRootRef"
  | "workspaceRoot"
  | "workspaceStateCacheRef"
>;

type DocumentLifecycleFacet = Omit<
  DocumentLifecycleDependencies["closeLifecycle"],
  | "activeDocumentRef"
  | "currentWorkspaceRootRef"
  | "documentsRef"
  | "dirtyCloseDecisionPort"
  | "editorGroupsRef"
  | "hasExternalFileConflict"
  | "openPathsRef"
  | "prompter"
  | "resolveDocumentSaveOwnership"
  | "resolveWorkspaceRuntimeOwner"
  | "workspaceRoot"
> &
  Omit<
    DocumentLifecycleDependencies["lifecycle"],
    | "activeDocumentRef"
    | "activePath"
    | "beginDocumentSelfWrite"
    | "beginRegisteredDocumentSelfWrite"
    | "clearExternalFileConflict"
    | "closeEmptyWorkbenchSurface"
    | "currentWorkspaceRootRef"
    | "currentEditorSessionOwnerKeyRef"
    | "detectSaveConflict"
    | "documentsRef"
    | "dirtyCloseDecisionPort"
    | "externallyRemovedDocumentRootByPathRef"
    | "filePrefetchCacheRef"
    | "formattedContentForSave"
    | "hasExternalFileConflict"
    | "localHistoryGateway"
    | "openPathsRef"
    | "optimizedImportsContentForSave"
    | "onDidSaveDocument"
    | "organizedImportsContentForSave"
    | "prompter"
    | "resolveDocumentSaveOwnership"
    | "resolveEditorConfigForFile"
    | "setActivePath"
    | "setDocuments"
    | "setOpenPaths"
    | "syncSavedDocument"
    | "syncSavedJavaScriptTypeScriptDocument"
    | "workspaceFiles"
    | "workspaceRequestTokenRef"
    | "workspaceRoot"
  > &
  Omit<
    DocumentLifecycleDependencies["recentlyClosedDocuments"],
    "currentWorkspaceRootRef" | "editorGroupsRef"
  > &
  Pick<
    DocumentLifecycleDependencies,
    "eslintDiagnostics" | "prettierFormatting" | "runWithIssuedWriteDrainRef" | "workspaceTrusted"
  > & {
    readonly activeLiveDocumentSaveCoordinator: DocumentLifecycleDependencies["lifecycle"]["activeLiveDocumentSaveCoordinator"];
    readonly refreshEditorConfigAfterSave: NonNullable<
      DocumentLifecycleDependencies["lifecycle"]["onDidSaveDocument"]
    >;
  };

type EditorGroupsFacet = Omit<
  EditorGroupDependencies,
  | "currentWorkspaceRootRef"
  | "editorGroupsRef"
  | "editorSessionOwnerKeyForRoot"
  | "isGitDiffDocumentPath"
  | "loadGitDiffDocument"
  | "updateEditorGroups"
  | "workspaceEditorViewStatesRef"
>;

interface RuntimeWorkspaceCloseFacet {
  readonly agentProjects: Parameters<typeof useRegisteredWorkspaceClosePorts>[1];
  readonly beginWorkspaceClose: (
    rootPath: string,
    identity: WorkspaceIdentityDescriptor | null,
  ) => WorkspaceCloseOwnership;
  readonly documentSessionAuthorityLifecycle: {
    deactivateActiveClose: (
      rootPath: string,
      identity: WorkspaceIdentityDescriptor | null,
      currentRootPath: string | null,
      editorSessionOwnerKey: EditorSessionOwnerKey | null,
    ) => void;
  };
  readonly currentEditorSessionOwnerKeyRef: {
    readonly current: EditorSessionOwnerKey | null;
  };
  readonly externallyRemovedDocumentRootByPathRef: {
    readonly current: Record<string, string>;
  };
  readonly forgetLanguageServerRuntimeStatuses: LanguageRuntimeOwnership["forgetLanguageServerRuntimeStatuses"];
  readonly forgetWorkspaceSettings: Parameters<
    typeof useWorkspaceTabRetainedStateCleanupPort
  >[0]["forgetWorkspaceSettings"];
  readonly invalidateEditorConfigRoot: (rootPath: string) => void;
  readonly releaseWorkspaceTrustOwner: (ownerKey: string) => void;
  readonly resolveCurrentWorkspaceRuntimeOwner: () => ReturnType<
    SaveAuthorityDependencies["ownerContext"]["resolveWorkspaceRuntimeOwner"]
  >;
  readonly retireWorkspaceRuntimeOwnerClaim: (
    ownerKey: string,
    expectedGeneration?: number | null,
  ) => void;
  readonly setJavaScriptTypeScriptLanguageServerRuntimeStatus: CloseLifecycleRuntimeStatusSetter;
  readonly setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot: (
    rootPath: string | null,
  ) => void;
  readonly setLanguageServerRuntimeStatus: CloseLifecycleRuntimeStatusSetter;
  readonly setLanguageServerRuntimeStatusRoot: (rootPath: string | null) => void;
  readonly setPackageScriptsByRoot: Parameters<
    typeof useWorkspaceTabRetainedStateCleanupPort
  >[0]["setPackageScriptsByRoot"];
  readonly stopProjectRuntimes: LanguageRuntimeOwnership["stopProjectRuntimes"];
  readonly workspaceFileChangeGateway: Parameters<typeof releaseWorkspaceRetainedResources>[0];
  readonly workspaceRuntimeLifecycleGateway: Parameters<typeof useRegisteredWorkspaceClosePorts>[0];
  readonly workspaceRuntimeOwnerByTabRef: {
    current: Record<
      string,
      NonNullable<
        ReturnType<SaveAuthorityDependencies["ownerContext"]["resolveWorkspaceRuntimeOwner"]>
      >
    >;
  };
  readonly workspaceRuntimeOwnerClaimsRef: {
    readonly current: {
      generationFor: (ownerKey: string) => number | null | undefined;
    };
  };
  readonly workspaceRuntimeOwnerFor: (
    rootPath: string,
    identity: WorkspaceIdentityDescriptor | null,
  ) => NonNullable<
    ReturnType<SaveAuthorityDependencies["ownerContext"]["resolveWorkspaceRuntimeOwner"]>
  >;
  readonly workspaceRuntimeRootByTabRef: {
    readonly current: Record<string, string>;
  };
}

interface WorkbenchDocumentSaveCloseCoordinatorDependencies {
  readonly documentLifecycle: DocumentLifecycleFacet;
  readonly editorGroups: EditorGroupsFacet;
  readonly runtimeClose: RuntimeWorkspaceCloseFacet;
  readonly saveAuthority: SaveAuthorityFacet;
  readonly workspaceClose: WorkspaceCloseFacet;
}

type CloseLifecycleRuntimeStatusSetter = (status: LanguageServerRuntimeStatus | null) => void;

export function useWorkbenchDocumentSaveCloseCoordinator(
  dependencies: WorkbenchDocumentSaveCloseCoordinatorDependencies,
) {
  const {
    documentLifecycle: documentLifecycleFacet,
    editorGroups: editorGroupsFacet,
    runtimeClose,
    saveAuthority,
    workspaceClose,
  } = dependencies;
  const {
    beginWorkspaceClose,
    currentEditorSessionOwnerKeyRef,
    documentSessionAuthorityLifecycle,
    externallyRemovedDocumentRootByPathRef,
    forgetLanguageServerRuntimeStatuses,
    invalidateEditorConfigRoot,
    retireWorkspaceRuntimeOwnerClaim,
    setJavaScriptTypeScriptLanguageServerRuntimeStatus,
    setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
    setLanguageServerRuntimeStatus,
    setLanguageServerRuntimeStatusRoot,
    stopProjectRuntimes,
    workspaceFileChangeGateway,
    workspaceRuntimeOwnerByTabRef,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerFor,
    workspaceRuntimeRootByTabRef,
  } = runtimeClose;
  const {
    clearExternalFileConflictsForRootRef,
    currentWorkspaceRootRef,
    documentSelfWrites,
    javaScriptTypeScriptLanguageServerRuntimeStatusRef,
    javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
    javaScriptTypeScriptRuntimeStatusByRootRef,
    languageServerRuntimeStatusByRootRef,
    languageServerRuntimeStatusRef,
    languageServerRuntimeStatusRootRef,
    workspaceIdentityByRootRef,
  } = saveAuthority;
  const saveAuthorityCoordinator = useWorkbenchDocumentSaveAuthorityCoordinator({
    clearExternalFileConflictsForRootRef,
    externalFileConflicts: saveAuthority,
    openDocuments: saveAuthority.openDocuments,
    ownerAdapters: saveAuthority,
    ownerContext: saveAuthority,
    pipeline: saveAuthority,
    service: saveAuthority,
    workspaceHasExternalFileConflictsRef: saveAuthority.workspaceHasExternalFileConflictsRef,
    workspaceRoot: saveAuthority.workspaceRoot,
  });
  const stopProjectRuntimesForWorkspaceClose = useCallback(
    async (rootPath?: string, ownership?: WorkspaceCloseOwnership) => {
      if (ownership && !ownership.isCurrent()) {
        return "stale" as const;
      }

      if (!rootPath) {
        return stopProjectRuntimes(rootPath);
      }

      const identityDescriptor = workspaceIdentityByRootRef.current[rootPath];
      const runtimeRootPath =
        workspaceRuntimeRootByTabRef.current[rootPath] ??
        identityDescriptor?.selectedPath ??
        rootPath;
      const runtimeOwner =
        workspaceRuntimeOwnerByTabRef.current[rootPath] ??
        workspaceRuntimeOwnerFor(runtimeRootPath, identityDescriptor ?? null);
      const runtimeRootKey = runtimeOwner.ownerKey;
      const previousPhpStatus = languageServerRuntimeStatusByRootRef.current[runtimeRootKey];
      const previousJavaScriptTypeScriptStatus =
        javaScriptTypeScriptRuntimeStatusByRootRef.current[runtimeRootKey];
      const previousActivePhpStatus = languageServerRuntimeStatusRef.current;
      const previousActivePhpStatusRoot = languageServerRuntimeStatusRootRef.current;
      const previousActiveJavaScriptTypeScriptStatus =
        javaScriptTypeScriptLanguageServerRuntimeStatusRef.current;
      const previousActiveJavaScriptTypeScriptStatusRoot =
        javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current;

      const stopResult = await stopProjectRuntimes(runtimeRootPath, runtimeOwner);
      if (!ownership || ownership.isCurrent()) {
        return stopResult;
      }

      restoreRuntimeStatusCacheEntry(
        languageServerRuntimeStatusByRootRef.current,
        runtimeRootKey,
        previousPhpStatus,
      );
      restoreRuntimeStatusCacheEntry(
        javaScriptTypeScriptRuntimeStatusByRootRef.current,
        runtimeRootKey,
        previousJavaScriptTypeScriptStatus,
      );
      if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath)) {
        return "stale" as const;
      }

      languageServerRuntimeStatusRef.current = previousActivePhpStatus;
      languageServerRuntimeStatusRootRef.current = previousActivePhpStatusRoot;
      javaScriptTypeScriptLanguageServerRuntimeStatusRef.current =
        previousActiveJavaScriptTypeScriptStatus;
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef.current =
        previousActiveJavaScriptTypeScriptStatusRoot;
      setLanguageServerRuntimeStatus(previousActivePhpStatus);
      setLanguageServerRuntimeStatusRoot(previousActivePhpStatusRoot);
      setJavaScriptTypeScriptLanguageServerRuntimeStatus(previousActiveJavaScriptTypeScriptStatus);
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot(
        previousActiveJavaScriptTypeScriptStatusRoot,
      );
      return "stale" as const;
    },
    [
      setJavaScriptTypeScriptLanguageServerRuntimeStatus,
      setJavaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      setLanguageServerRuntimeStatus,
      setLanguageServerRuntimeStatusRoot,
      javaScriptTypeScriptLanguageServerRuntimeStatusRef,
      javaScriptTypeScriptLanguageServerRuntimeStatusRootRef,
      javaScriptTypeScriptRuntimeStatusByRootRef,
      languageServerRuntimeStatusByRootRef,
      languageServerRuntimeStatusRef,
      languageServerRuntimeStatusRootRef,
      stopProjectRuntimes,
      currentWorkspaceRootRef,
      workspaceIdentityByRootRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerFor,
      workspaceRuntimeRootByTabRef,
    ],
  );
  const forgetLanguageServerRuntimeStatusesForWorkspaceClose = useCallback(
    (rootPath: string) => {
      const runtimeOwner = workspaceRuntimeOwnerByTabRef.current[rootPath];
      const claimGeneration = runtimeOwner
        ? workspaceRuntimeOwnerClaimsRef.current.generationFor(runtimeOwner.ownerKey)
        : undefined;
      forgetLanguageServerRuntimeStatuses(rootPath, runtimeOwner);
      if (runtimeOwner) {
        retireWorkspaceRuntimeOwnerClaim(runtimeOwner.ownerKey, claimGeneration);
      }
      delete workspaceRuntimeOwnerByTabRef.current[rootPath];
    },
    [
      forgetLanguageServerRuntimeStatuses,
      retireWorkspaceRuntimeOwnerClaim,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeOwnerClaimsRef,
    ],
  );
  const clearWorkspaceResourceCachesForRoot = useCallback(
    (rootPath: string) => {
      invalidateEditorConfigRoot(rootPath);
      documentSelfWrites.clearRoot(rootPath);
      releaseWorkspaceRetainedResources(
        workspaceFileChangeGateway,
        externallyRemovedDocumentRootByPathRef.current,
        rootPath,
      );
    },
    [
      documentSelfWrites,
      externallyRemovedDocumentRootByPathRef,
      invalidateEditorConfigRoot,
      workspaceFileChangeGateway,
    ],
  );
  const clearExternalFileConflictsForWorkspaceClose = useCallback(
    (rootPath: string) => clearExternalFileConflictsForRootRef.current(rootPath),
    [clearExternalFileConflictsForRootRef],
  );
  const runWithDocumentSaveExclusionRef = useRef<RunWithDocumentSaveExclusion>(
    async (_scope, operation) => operation(),
  );
  const runWithDocumentSaveExclusionDelegate = useCallback<RunWithDocumentSaveExclusion>(
    (scope, operation) => runWithDocumentSaveExclusionRef.current(scope, operation),
    [],
  );
  const commitWorkspaceClose = useCallback(
    (rootPath: string, identity: WorkspaceIdentityDescriptor | null) => {
      const ownership = beginWorkspaceClose(rootPath, identity);
      documentSessionAuthorityLifecycle.deactivateActiveClose(
        rootPath,
        identity,
        currentWorkspaceRootRef.current,
        currentEditorSessionOwnerKeyRef.current,
      );
      return ownership;
    },
    [
      beginWorkspaceClose,
      currentEditorSessionOwnerKeyRef,
      currentWorkspaceRootRef,
      documentSessionAuthorityLifecycle,
    ],
  );
  const workspaceCloseSession = useWorkspaceCloseSessionPort(
    saveAuthority.currentWorkspaceRootRef,
    saveAuthority.documentsRef,
    saveAuthority.editorGroupsRef,
    saveAuthority.workspaceHasExternalFileConflictsRef,
  );
  const registeredWorkspaceClosePorts = useRegisteredWorkspaceClosePorts(
    runtimeClose.workspaceRuntimeLifecycleGateway,
    runtimeClose.agentProjects,
  );
  const prepareWorkspaceTabRetainedCleanup = useWorkspaceTabRetainedStateCleanupPort({
    appSettingsRef: workspaceClose.appSettingsRef,
    workspaceIdentityByRootRef: saveAuthority.workspaceIdentityByRootRef,
    currentWorkspaceRootRef: saveAuthority.currentWorkspaceRootRef,
    workspaceRuntimeRootByTabRef: runtimeClose.workspaceRuntimeRootByTabRef,
    workspaceRuntimeOwnerByTabRef: runtimeClose.workspaceRuntimeOwnerByTabRef,
    resolveCurrentWorkspaceRuntimeOwner: runtimeClose.resolveCurrentWorkspaceRuntimeOwner,
    setPackageScriptsByRoot: runtimeClose.setPackageScriptsByRoot,
    forgetWorkspaceSettings: runtimeClose.forgetWorkspaceSettings,
    hasPhpWorkspaceByOwnerRef: saveAuthority.hasPhpWorkspaceByOwnerRef,
    releaseWorkspaceTrustOwner: runtimeClose.releaseWorkspaceTrustOwner,
    recentlyClosedTabsRef: documentLifecycleFacet.recentlyClosedTabsRef,
    workspaceEditorViewStatesRef: documentLifecycleFacet.workspaceEditorViewStatesRef,
  });
  const closeLifecycle = useWorkbenchCloseLifecycle({
    ...workspaceClose,
    captureDirtyCloseTargets: saveAuthorityCoordinator.captureDirtyCloseTargets,
    closeRegisteredWorkspaceAgents: registeredWorkspaceClosePorts[1],
    clearExternalFileConflictsForRoot: clearExternalFileConflictsForWorkspaceClose,
    commitWorkspaceClose,
    dirtyCount: saveAuthorityCoordinator.dirtyCount,
    disposeRegisteredWorkspace: registeredWorkspaceClosePorts[0],
    forgetLanguageServerRuntimeStatuses: forgetLanguageServerRuntimeStatusesForWorkspaceClose,
    invalidateWorkspaceResourceCachesForRoot: clearWorkspaceResourceCachesForRoot,
    isWorkspaceRuntimeOwnerCurrent: saveAuthorityCoordinator.isWorkspaceRuntimeOwnerCurrent,
    ownerDocumentSaveRepository: saveAuthorityCoordinator.ownerDocumentSaveAdapters.repository,
    ownerResolvingDocumentSaveService: saveAuthorityCoordinator.ownerResolvingDocumentSaveService,
    prepareWorkspaceTabRetainedStateCleanup: prepareWorkspaceTabRetainedCleanup,
    requestOwnerDocumentSave: saveAuthorityCoordinator.requestOwnerDocumentSave,
    runWithDocumentSaveExclusion: runWithDocumentSaveExclusionDelegate,
    stopProjectRuntimes: stopProjectRuntimesForWorkspaceClose,
    workspaceIdentityByRootRef: saveAuthority.workspaceIdentityByRootRef,
    workspaceCloseSession,
    workspaceHasExternalFileConflicts: (rootPath) =>
      saveAuthority.workspaceHasExternalFileConflictsRef.current(rootPath),
    workspaceRoot: saveAuthority.workspaceRoot,
    workspaceStateCacheRef: saveAuthority.workspaceStateCacheRef,
  });
  const documentLifecycleCoordinator = useWorkbenchDocumentLifecycleCoordinator({
    closeLifecycle: {
      ...documentLifecycleFacet,
      activeDocumentRef: saveAuthority.activeDocumentRef,
      currentWorkspaceRootRef: saveAuthority.currentWorkspaceRootRef,
      dirtyCloseDecisionPort: workspaceClose.dirtyCloseDecisionPort,
      documentsRef: saveAuthority.documentsRef,
      editorGroupsRef: saveAuthority.editorGroupsRef,
      hasExternalFileConflict: saveAuthorityCoordinator.hasExternalFileConflict,
      openPathsRef: saveAuthority.openPathsRef,
      prompter: workspaceClose.prompter,
      resolveDocumentSaveOwnership: saveAuthority.resolveDocumentSaveOwnership,
      resolveWorkspaceRuntimeOwner: saveAuthority.resolveWorkspaceRuntimeOwner,
      workspaceRoot: saveAuthority.workspaceRoot,
    },
    eslintDiagnostics: documentLifecycleFacet.eslintDiagnostics,
    lifecycle: {
      ...documentLifecycleFacet,
      activeDocument: documentLifecycleFacet.activeDocument,
      activeDocumentRef: saveAuthority.activeDocumentRef,
      activePath: saveAuthority.activePath,
      beginDocumentSelfWrite: (rootPath, path, content) => {
        const ownership = saveAuthority.resolveDocumentSaveOwnership(rootPath, path);
        return ownership ? saveAuthority.documentSelfWrites.begin(ownership, content) : null;
      },
      beginRegisteredDocumentSelfWrite: saveAuthority.documentSelfWrites.begin.bind(
        saveAuthority.documentSelfWrites,
      ),
      clearExternalFileConflict: saveAuthorityCoordinator.externalFileConflicts.clearConflict,
      closeEmptyWorkbenchSurface: closeLifecycle.closeApplicationWindow,
      currentEditorSessionOwnerKeyRef: runtimeClose.currentEditorSessionOwnerKeyRef,
      currentWorkspaceRootRef: saveAuthority.currentWorkspaceRootRef,
      detectSaveConflict: saveAuthorityCoordinator.externalFileConflicts.detectSaveConflict,
      documents: documentLifecycleFacet.documents,
      documentsRef: saveAuthority.documentsRef,
      externallyRemovedDocumentRootByPathRef: runtimeClose.externallyRemovedDocumentRootByPathRef,
      filePrefetchCacheRef: saveAuthority.filePrefetchCacheRef,
      formattedContentForSave: saveAuthorityCoordinator.formattedContentForSave,
      hasExternalFileConflict: saveAuthorityCoordinator.hasExternalFileConflict,
      localHistoryGateway: saveAuthority.localHistoryGateway,
      openPathsRef: saveAuthority.openPathsRef,
      onDidSaveDocument: documentLifecycleFacet.refreshEditorConfigAfterSave,
      optimizedImportsContentForSave: saveAuthorityCoordinator.optimizedImportsContentForSave,
      organizedImportsContentForSave: saveAuthorityCoordinator.organizedImportsContentForSave,
      prompter: workspaceClose.prompter,
      resolveDocumentSaveOwnership: saveAuthority.resolveDocumentSaveOwnership,
      resolveEditorConfigForFile: saveAuthority.resolveEditorConfigForFile,
      setActivePath: saveAuthority.setActivePath,
      setDocuments: saveAuthority.setDocuments,
      setOpenPaths: saveAuthority.setOpenPaths,
      syncSavedDocument: saveAuthority.syncSavedDocumentForRoot,
      syncSavedJavaScriptTypeScriptDocument:
        saveAuthority.syncSavedJavaScriptTypeScriptDocumentForRoot,
      workspaceFiles: saveAuthority.workspaceFiles,
      workspaceRequestTokenRef: workspaceClose.openWorkspaceRequestTokenRef,
      workspaceRoot: saveAuthority.workspaceRoot,
    },
    prettierFormatting: documentLifecycleFacet.prettierFormatting,
    recentlyClosedDocuments: {
      ...documentLifecycleFacet,
      currentWorkspaceRootRef: saveAuthority.currentWorkspaceRootRef,
      editorGroupsRef: saveAuthority.editorGroupsRef,
    },
    requestOwnerDocumentSaveRef: saveAuthorityCoordinator.requestOwnerDocumentSaveRef,
    runWithDocumentSaveExclusionRef,
    runWithIssuedWriteDrainRef: documentLifecycleFacet.runWithIssuedWriteDrainRef,
    workspaceTrusted: documentLifecycleFacet.workspaceTrusted,
  });
  const editorGroupsCoordinator = useWorkbenchEditorGroupCoordinator({
    ...editorGroupsFacet,
    currentWorkspaceRootRef: saveAuthority.currentWorkspaceRootRef,
    editorGroupsRef: saveAuthority.editorGroupsRef,
    editorSessionOwnerKeyForRoot: documentLifecycleFacet.editorSessionOwnerKeyForRoot,
    isGitDiffDocumentPath: documentLifecycleFacet.isGitDiffDocumentPath,
    loadGitDiffDocument: documentLifecycleFacet.loadGitDiffDocument,
    updateEditorGroups: documentLifecycleFacet.updateEditorGroups,
    workspaceEditorViewStatesRef: documentLifecycleFacet.workspaceEditorViewStatesRef,
  });

  return {
    closeLifecycle,
    documentLifecycle: documentLifecycleCoordinator,
    editorGroups: editorGroupsCoordinator,
    saveAuthority: saveAuthorityCoordinator,
  };
}

import { invoke, isTauri } from "@tauri-apps/api/core";
import {
  listen,
  type UnlistenFn as TauriUnlistenFn,
} from "@tauri-apps/api/event";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type MutableRefObject,
} from "react";
import type { EditorConfigFile } from "../domain/editorConfig";
import type { AppSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import type { ProjectRuntimeStopResult } from "../domain/workspaceRuntimeLifecycle";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import { isDirty } from "../domain/workspace";
import type { CloseCompletion } from "../domain/dirtyClose";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import { CloseCoordinator } from "./closeCoordinator";
import type {
  DocumentSaveLease,
  RunWithDocumentSaveExclusion,
} from "./documentSaveCoordinator";
import {
  createDirtyCloseDocumentDescriptor,
  type DirtyCloseDecisionPort,
} from "./dirtyCloseDecisionPort";
import {
  DirtyCloseSaveTransaction,
  type CapturedDirtyCloseTarget,
  type DirtyCloseSaveBlockedResult,
} from "./dirtyCloseSaveTransaction";
import type { DocumentSaveOwnership } from "./documentSaveIdentity";
import type { DocumentSaveResult } from "./documentSaveService";
import {
  type CapturedOwnerDocumentSaveTarget,
  OwnerDocumentSaveRepository,
} from "./ownerDocumentSaveRepository";
import { OwnerResolvingDocumentSaveService } from "./ownerResolvingDocumentSaveService";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  workspaceIdentityStateCacheKey,
  type WorkspaceStateCache,
} from "./useWorkspaceStateCache";

interface CachedWorkspaceDirtyState {
  editorSurface: {
    documents: Record<string, EditorDocument>;
  };
  workspaceIdentityDescriptor?: WorkspaceIdentityDescriptor | null;
}

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

interface ClearActiveWorkspaceOptions {
  ownership?: WorkspaceCloseOwnership;
  runtimeAlreadyStopped?: boolean;
}

export interface WorkbenchDirtyCloseIdentity {
  readonly ownership: DocumentSaveOwnership;
  readonly saveTarget: CapturedOwnerDocumentSaveTarget;
}

export type WorkbenchDirtyCloseTarget =
  CapturedDirtyCloseTarget<WorkbenchDirtyCloseIdentity>;

export interface WorkspaceCloseSessionPort {
  current: () => {
    activeRoot: string | null;
    needsAttention: boolean;
  };
}

export interface WorkspaceCloseOwnership {
  isCurrent: () => boolean;
}

export type WorkspaceIdentityReleaseOutcome = "deferred" | "released";

export interface WorkbenchCloseLifecycleDependencies {
  workspaceRoot: string | null;
  dirtyCount: number;

  appSettingsRef: MutableRefObject<AppSettings>;
  workspaceStateCacheRef: MutableRefObject<
    Record<string, CachedWorkspaceDirtyState>
  >;
  resolveCachedWorkspaceState?: WorkspaceStateCache["resolveCachedWorkspaceState"];
  forgetCachedWorkspaceState?: WorkspaceStateCache["forgetCachedWorkspaceState"];
  workspaceIdentityByRootRef: MutableRefObject<
    Record<string, WorkspaceIdentityDescriptor>
  >;
  editorConfigCacheRef: MutableRefObject<
    Record<string, Record<string, EditorConfigFile | null>>
  >;
  openWorkspaceRequestPathRef: MutableRefObject<string | null>;
  openWorkspaceRequestTokenRef: MutableRefObject<number>;
  openFileRequestTokenRef: MutableRefObject<number>;
  gitDiffRequestTokenRef: MutableRefObject<number>;
  editorGitBaselineRequestTokenRef: MutableRefObject<number>;

  prompter: WorkbenchPrompter;
  dirtyCloseDecisionPort: DirtyCloseDecisionPort;
  captureDirtyCloseTargets: (
    rootPath: string | null,
  ) => readonly WorkbenchDirtyCloseTarget[] | null;
  isWorkspaceRuntimeOwnerCurrent: (owner: WorkspaceRuntimeOwner) => boolean;
  ownerDocumentSaveRepository: OwnerDocumentSaveRepository;
  ownerResolvingDocumentSaveService: OwnerResolvingDocumentSaveService;
  requestOwnerDocumentSave: (
    ownership: DocumentSaveOwnership,
    operation: (lease: DocumentSaveLease) => Promise<DocumentSaveResult>,
  ) => Promise<DocumentSaveResult>;
  workspaceCloseSession: WorkspaceCloseSessionPort;
  commitWorkspaceClose: (
    rootPath: string,
    identity: WorkspaceIdentityDescriptor | null,
  ) => WorkspaceCloseOwnership | void;
  runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion;
  persistAppSettings: (nextSettings: AppSettings) => Promise<void>;
  closeSyncedLanguageServerDocumentsForRoot: (
    rootPath: string,
  ) => Promise<void>;
  closeSyncedJavaScriptTypeScriptDocumentsForRoot: (
    rootPath: string,
  ) => Promise<void>;
  stopProjectRuntimes: (
    rootPath?: string,
    ownership?: WorkspaceCloseOwnership,
  ) => Promise<ProjectRuntimeStopResult>;
  forgetLanguageServerRuntimeStatuses: (rootPath: string) => void;
  forgetLatencyTrackerForRoot: (rootPath: string) => void;
  unregisterWorkspace: (
    workspaceId: string,
  ) => Promise<WorkspaceIdentityReleaseOutcome | void>;
  clearExternalFileConflictsForRoot: (rootPath: string) => void;
  invalidateWorkspaceResourceCachesForRoot: (rootPath: string) => void;
  workspaceHasExternalFileConflicts: (rootPath: string) => boolean;
  openWorkspacePath: (
    path: string,
    options?: OpenWorkspacePathOptions,
  ) => Promise<void>;
  clearActiveWorkspace: (
    options?: ClearActiveWorkspaceOptions,
  ) => Promise<void>;
  persistWorkspaceSession?: (rootPath: string) => Promise<void>;
  reportError: (source: string, error: unknown) => void;
}

export interface WorkbenchCloseLifecycle {
  closeWorkspaceTab: (path: string) => Promise<void>;
  closeApplicationWindow: () => void;
  quitApplication: () => void;
}

const NATIVE_CLOSE_REQUEST_EVENT = "mockor-native-close-requested";

type NativeCloseKind = "close" | "quit";
type CloseScopeGuard = () => boolean;
type CloseCommit = (scopeIsCurrent: CloseScopeGuard) => Promise<boolean>;
type WorkspaceDisposalResult =
  | "disposed"
  | "identity-release-deferred"
  | "identity-release-failed"
  | "runtime-stop-incomplete"
  | "stale";

const alwaysCurrentWorkspaceCloseOwnership: WorkspaceCloseOwnership = {
  isCurrent: () => true,
};

function isNativeCloseKind(payload: unknown): payload is NativeCloseKind {
  return payload === "close" || payload === "quit";
}

export function useWorkbenchCloseLifecycle(
  dependencies: WorkbenchCloseLifecycleDependencies,
): WorkbenchCloseLifecycle {
  const {
    workspaceRoot,
    appSettingsRef,
    workspaceStateCacheRef,
    resolveCachedWorkspaceState = (rootPath, identity) =>
      resolveCachedWorkspaceStateFallback(
        workspaceStateCacheRef.current,
        rootPath,
        identity,
      ),
    forgetCachedWorkspaceState = (rootPath, identity) =>
      forgetCachedWorkspaceStateFallback(
        workspaceStateCacheRef.current,
        rootPath,
        identity,
      ),
    workspaceIdentityByRootRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    openFileRequestTokenRef,
    gitDiffRequestTokenRef,
    editorGitBaselineRequestTokenRef,
    dirtyCloseDecisionPort,
    captureDirtyCloseTargets,
    isWorkspaceRuntimeOwnerCurrent,
    ownerDocumentSaveRepository,
    ownerResolvingDocumentSaveService,
    requestOwnerDocumentSave,
    workspaceCloseSession,
    commitWorkspaceClose,
    runWithDocumentSaveExclusion,
    persistAppSettings,
    closeSyncedLanguageServerDocumentsForRoot,
    closeSyncedJavaScriptTypeScriptDocumentsForRoot,
    stopProjectRuntimes,
    forgetLanguageServerRuntimeStatuses,
    forgetLatencyTrackerForRoot,
    unregisterWorkspace,
    clearExternalFileConflictsForRoot,
    invalidateWorkspaceResourceCachesForRoot,
    workspaceHasExternalFileConflicts,
    openWorkspacePath,
    clearActiveWorkspace,
    persistWorkspaceSession = async () => undefined,
    reportError,
  } = dependencies;
  const closeCoordinator = useMemo(() => new CloseCoordinator(), []);
  const nativeCloseInFlightRef = useRef(false);
  const workspaceCloseInFlightRef = useRef(
    new Map<string, Promise<void>>(),
  );
  const nativeCloseRequestRef = useRef<(payload: unknown) => void>(
    () => undefined,
  );

  const persistCurrentWorkspaceSession = useCallback(async () => {
    if (!workspaceRoot) {
      return;
    }

    try {
      await persistWorkspaceSession(workspaceRoot);
    } catch (error) {
      reportError("Session", error);
    }
  }, [persistWorkspaceSession, reportError, workspaceRoot]);

  const confirmNativeShutdown = useCallback(
    async (
      kind: NativeCloseKind,
      scopeIsCurrent: CloseScopeGuard,
    ): Promise<boolean> => {
      await persistCurrentWorkspaceSession();
      if (!scopeIsCurrent()) {
        return false;
      }

      await invoke("confirm_native_shutdown", { kind });
      return true;
    },
    [persistCurrentWorkspaceSession],
  );

  const targetIsCurrent = useCallback((
    target: WorkbenchDirtyCloseTarget,
    expectedDocument: EditorDocument,
  ) => {
    if (!isWorkspaceRuntimeOwnerCurrent(target.owner)) {
      return false;
    }

    const repository = ownerDocumentSaveRepository.resolve({
      ...target.identity.saveTarget,
      document: expectedDocument,
    });
    return repository?.isCurrent() === true;
  }, [isWorkspaceRuntimeOwnerCurrent, ownerDocumentSaveRepository]);

  const executeDirtyClose = useCallback(async (
    captureTargets: () => readonly WorkbenchDirtyCloseTarget[] | null,
    roots: readonly string[],
    scope: "workspace" | "quit",
    commit: CloseCommit,
  ): Promise<CloseCompletion> => {
    const targets = captureTargets();
    if (!targets) {
      return "blocked";
    }

    const capturedTargets = new Map(
      targets.map((target) => [target.targetId, target]),
    );
    const expectedDocuments = new Map<string, EditorDocument>();
    const closeScopeIsCurrent = (requireClean: boolean): boolean => {
      const currentTargets = captureTargets();
      if (!currentTargets) {
        return false;
      }

      for (const currentTarget of currentTargets) {
        const capturedTarget = capturedTargets.get(currentTarget.targetId);
        if (!capturedTarget) {
          return false;
        }

        const expected = expectedDocuments.get(currentTarget.targetId) ??
          capturedTarget.identity.saveTarget.document;
        if (currentTarget.identity.saveTarget.document !== expected) {
          return false;
        }
      }

      for (const target of targets) {
        const expected = expectedDocuments.get(target.targetId) ??
          target.identity.saveTarget.document;
        if (!targetIsCurrent(target, expected)) {
          return false;
        }
        if (requireClean && isDirty(expected)) {
          return false;
        }
      }

      return true;
    };
    const commitConditionally = async (
      requireClean: boolean,
    ): Promise<CloseCompletion> => runWithWorkspaceSaveExclusions(
      uniqueNormalizedWorkspaceRoots([...roots]),
      runWithDocumentSaveExclusion,
      async () => {
        if (!closeScopeIsCurrent(requireClean)) {
          return "stale";
        }

        const committed = await commit(
          () => closeScopeIsCurrent(requireClean),
        );
        return committed ? "closed" : "stale";
      },
    );

    if (targets.length === 0) {
      return commitConditionally(false);
    }

    let decision;
    try {
      decision = await dirtyCloseDecisionPort.decideDirtyClose({
        scope,
        documents: targets.map(workbenchDirtyCloseDocumentDescriptor),
        documentNames: targets.map(
          (target) => target.identity.saveTarget.document.name,
        ),
      });
    } catch (error) {
      reportError("Application", error);
      return "blocked";
    }
    if (decision === "cancel") {
      return "cancelled";
    }
    if (decision === "discard") {
      return commitConditionally(false);
    }

    const transaction = new DirtyCloseSaveTransaction<
      WorkbenchDirtyCloseIdentity,
      void
    >({
      saveTarget: async (target) => {
        const repository = ownerDocumentSaveRepository.resolve(
          target.identity.saveTarget,
        );
        if (!repository) {
          return { status: "stale" };
        }
        const result = await requestOwnerDocumentSave(
          target.identity.ownership,
          (lease) => ownerResolvingDocumentSaveService.saveDocument({
            target: target.identity.saveTarget,
            lease,
          }),
        );
        if (result.status === "saved") {
          const acknowledgedDocument = repository.currentDocument();
          if (!acknowledgedDocument) {
            return { status: "stale" };
          }
          expectedDocuments.set(target.targetId, acknowledgedDocument);
        }
        return result;
      },
      isOwnerCurrent: isWorkspaceRuntimeOwnerCurrent,
      revalidateTarget: (target) => {
        const expected = expectedDocuments.get(target.targetId) ??
          target.identity.saveTarget.document;
        if (!targetIsCurrent(target, expected)) {
          return { status: "stale" };
        }

        return { status: "current", clean: !isDirty(expected) };
      },
      commitCloseConditionally: async () => {
        const completion = await commitConditionally(true);
        if (completion === "closed") {
          return { status: "committed", result: undefined };
        }

        const target = targets[0];
        if (!target) {
          throw new Error("Dirty close target disappeared before commit");
        }
        return { status: "stale", target, reason: "target-replaced" };
      },
    });
    const result = await transaction.execute({ targets });
    if (result.status === "blocked") {
      reportDirtyCloseSaveFailure(result, targets.length, reportError);
    }
    return result.status === "closed" ? "closed" : result.status;
  }, [
    dirtyCloseDecisionPort,
    isWorkspaceRuntimeOwnerCurrent,
    ownerResolvingDocumentSaveService,
    ownerDocumentSaveRepository,
    reportError,
    requestOwnerDocumentSave,
    runWithDocumentSaveExclusion,
    targetIsCurrent,
  ]);

  const requestApplicationShutdown = useCallback(
    (shutdown: CloseCommit, errorSource: string) => {
      if (nativeCloseInFlightRef.current) {
        return;
      }

      nativeCloseInFlightRef.current = true;
      const roots = uniqueNormalizedWorkspaceRoots([
        ...appSettingsRef.current.workspaceTabs,
        workspaceRoot,
      ]);
      void executeDirtyClose(
        () => captureDirtyCloseTargets(null),
        roots,
        "quit",
        shutdown,
      ).then((completion) => {
        if (completion !== "closed") {
          nativeCloseInFlightRef.current = false;
        }
      }).catch((error) => {
          nativeCloseInFlightRef.current = false;
          reportError(errorSource, error);
        });
    },
    [
      appSettingsRef,
      captureDirtyCloseTargets,
      executeDirtyClose,
      reportError,
      workspaceRoot,
    ],
  );

  nativeCloseRequestRef.current = (payload) => {
    if (!isNativeCloseKind(payload)) {
      reportError("Application", new Error("Invalid native close request"));
      return;
    }

    requestApplicationShutdown(
      (scopeIsCurrent) => confirmNativeShutdown(payload, scopeIsCurrent),
      "Application",
    );
  };

  useEffect(() => {
    if (!isTauri()) {
      return;
    }

    let active = true;
    let unlisten: TauriUnlistenFn | null = null;
    listen<unknown>(NATIVE_CLOSE_REQUEST_EVENT, (event) => {
      nativeCloseRequestRef.current(event.payload);
    })
      .then(async (dispose) => {
        if (!active) {
          dispose();
          return;
        }

        unlisten = dispose;
        try {
          await invoke("set_native_close_listener_ready", { ready: true });
          if (!active) {
            await invoke("set_native_close_listener_ready", { ready: false });
          }
        } catch (error) {
          dispose();
          unlisten = null;
          throw error;
        }
      })
      .catch((error) => reportError("Application", error));

    return () => {
      active = false;
      unlisten?.();
      if (!unlisten) {
        return;
      }
      void invoke("set_native_close_listener_ready", { ready: false }).catch(
        (error) => reportError("Application", error),
      );
    };
  }, [reportError]);

  const disposeWorkspaceTabResources = useCallback(
    async (
      tabPath: string,
      targetRootPath: string,
      identityDescriptor: WorkspaceIdentityDescriptor | null,
      ownership: WorkspaceCloseOwnership,
      scopeIsCurrent: CloseScopeGuard,
    ): Promise<WorkspaceDisposalResult> => {
      if (!ownership.isCurrent() || !scopeIsCurrent()) {
        return "stale";
      }

      if (identityDescriptor) {
        try {
          const releaseOutcome = await unregisterWorkspace(
            identityDescriptor.workspaceId,
          );
          if (releaseOutcome === "deferred") {
            return "identity-release-deferred";
          }
        } catch (error) {
          reportError("Workspace", error);
          return "identity-release-failed";
        }

        if (!ownership.isCurrent() || !scopeIsCurrent()) {
          return "stale";
        }
      }

      const runtimeStop = {
        result: "stopped" as ProjectRuntimeStopResult,
      };
      await closeCoordinator.close({
        closeDocuments: [
          () =>
            ownership.isCurrent() && scopeIsCurrent()
              ? closeSyncedLanguageServerDocumentsForRoot(targetRootPath)
              : Promise.resolve(),
          () =>
            ownership.isCurrent() && scopeIsCurrent()
              ? closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath)
              : Promise.resolve(),
        ],
        disposeRuntime: async () => {
          if (!ownership.isCurrent() || !scopeIsCurrent()) {
            return;
          }

          try {
            runtimeStop.result = await stopRuntimeForOwnedClose(
              stopProjectRuntimes,
              targetRootPath,
              ownership,
            );
          } catch (error) {
            runtimeStop.result = "incomplete";
            reportError("Runtime cleanup", error);
          }
        },
      });

      if (runtimeStop.result === "incomplete") {
        return "runtime-stop-incomplete";
      }

      if (runtimeStop.result === "stale") {
        return "stale";
      }

      if (!ownership.isCurrent() || !scopeIsCurrent()) {
        return "stale";
      }

      forgetCachedWorkspaceState(tabPath, identityDescriptor);
      const resourceRoots = workspaceResourceRoots(
        tabPath,
        targetRootPath,
        identityDescriptor,
      );
      for (const rootPath of resourceRoots) {
        if (!ownership.isCurrent() || !scopeIsCurrent()) {
          return "stale";
        }

        invalidateWorkspaceResourceCachesForRoot(rootPath);
        clearExternalFileConflictsForRoot(rootPath);
      }

      if (identityDescriptor) {
        for (const [rootPath, descriptor] of Object.entries(
          workspaceIdentityByRootRef.current,
        )) {
          if (descriptor.workspaceId !== identityDescriptor.workspaceId) {
            continue;
          }

          delete workspaceIdentityByRootRef.current[rootPath];
        }
      }

      forgetLatencyTrackerForRoot(targetRootPath);
      forgetLanguageServerRuntimeStatuses(targetRootPath);
      return "disposed";
    },
    [
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      closeCoordinator,
      clearExternalFileConflictsForRoot,
      invalidateWorkspaceResourceCachesForRoot,
      forgetCachedWorkspaceState,
      forgetLanguageServerRuntimeStatuses,
      forgetLatencyTrackerForRoot,
      stopProjectRuntimes,
      workspaceIdentityByRootRef,
      unregisterWorkspace,
      reportError,
    ],
  );

  const restoreSettingsAfterIdentityReleaseFailure = useCallback(
    async (
      settings: AppSettings,
      ownership: WorkspaceCloseOwnership,
    ): Promise<void> => {
      if (!ownership.isCurrent()) {
        return;
      }

      try {
        await persistAppSettings(settings);
      } catch (error) {
        reportError("Settings", error);
      }
    },
    [persistAppSettings, reportError],
  );

  const commitWorkspaceTabClose = useCallback(
    async (path: string, scopeIsCurrent: CloseScopeGuard): Promise<boolean> => {
      const currentSettings = appSettingsRef.current;
      const currentTabs = currentSettings.workspaceTabs;
      const tabPath =
        workspaceTabPathForIdentity(
          currentTabs,
          path,
          workspaceIdentityByRootRef.current,
        ) ?? path;
      const activeSession = workspaceCloseSession.current();
      const activeRootPath = activeSession.activeRoot;
      const identityDescriptor = workspaceIdentityForPaths(
        workspaceIdentityByRootRef.current,
        [tabPath, path],
      );
      const activeIdentityDescriptor = workspaceIdentityForPaths(
        workspaceIdentityByRootRef.current,
        activeRootPath ? [activeRootPath] : [],
      );
      const closingActiveWorkspace =
        workspaceRootKeysEqual(tabPath, activeRootPath) ||
        Boolean(
          identityDescriptor &&
            activeIdentityDescriptor &&
            identityDescriptor.workspaceId ===
              activeIdentityDescriptor.workspaceId,
        );
      const targetRootPath =
        closingActiveWorkspace && activeRootPath ? activeRootPath : tabPath;
      const nextTabs = workspaceTabsWithoutPath(currentTabs, path);

      if (nextTabs.length === currentTabs.length) {
        return true;
      }

      const ownership =
        commitWorkspaceClose(targetRootPath, identityDescriptor) ??
        alwaysCurrentWorkspaceCloseOwnership;

      if (
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, tabPath) ||
        workspaceRootKeysEqual(
          openWorkspaceRequestPathRef.current,
          targetRootPath,
        )
      ) {
        openWorkspaceRequestTokenRef.current += 1;
        openWorkspaceRequestPathRef.current = null;
      }

      if (!closingActiveWorkspace) {
        if (!ownership.isCurrent()) {
          return false;
        }

        const nextRecentPath = workspaceRootKeysEqual(
          currentSettings.recentWorkspacePath,
          tabPath,
        )
          ? (activeRootPath ?? nextTabs[nextTabs.length - 1] ?? null)
          : currentSettings.recentWorkspacePath;

        try {
          await persistAppSettings({
            ...currentSettings,
            recentWorkspacePath: nextRecentPath,
            workspaceTabs: nextTabs,
          });
        } catch (error) {
          reportError("Settings", error);
          return false;
        }

        if (!ownership.isCurrent() || !scopeIsCurrent()) {
          await restoreSettingsAfterIdentityReleaseFailure(
            currentSettings,
            ownership,
          );
          return false;
        }

        const disposalResult = await disposeWorkspaceTabResources(
          tabPath,
          targetRootPath,
          identityDescriptor,
          ownership,
          scopeIsCurrent,
        );
        if (disposalResult === "stale") {
          await restoreSettingsAfterIdentityReleaseFailure(
            currentSettings,
            ownership,
          );
          return false;
        }
        if (
          disposalResult !== "identity-release-failed" &&
          disposalResult !== "identity-release-deferred" &&
          disposalResult !== "runtime-stop-incomplete"
        ) {
          return disposalResult === "disposed";
        }

        await restoreSettingsAfterIdentityReleaseFailure(
          currentSettings,
          ownership,
        );
        return false;
      }

      if (!ownership.isCurrent()) {
        return false;
      }

      try {
        await persistWorkspaceSession(targetRootPath);
      } catch (error) {
        reportError("Session", error);
      }

      if (!ownership.isCurrent() || !scopeIsCurrent()) {
        return false;
      }

      openFileRequestTokenRef.current += 1;
      gitDiffRequestTokenRef.current += 1;
      editorGitBaselineRequestTokenRef.current += 1;
      const currentIndex = workspaceTabIndexForPath(currentTabs, tabPath);
      const nextPath =
        nextTabs[Math.min(currentIndex, nextTabs.length - 1)] ??
        nextTabs[nextTabs.length - 1] ??
        null;

      try {
        await persistAppSettings({
          ...currentSettings,
          recentWorkspacePath: nextPath,
          workspaceTabs: nextTabs,
        });
      } catch (error) {
        reportError("Settings", error);
        return false;
      }

      if (!ownership.isCurrent() || !scopeIsCurrent()) {
        await restoreSettingsAfterIdentityReleaseFailure(
          currentSettings,
          ownership,
        );
        return false;
      }

      const disposalResult = await disposeWorkspaceTabResources(
        tabPath,
        targetRootPath,
        identityDescriptor,
        ownership,
        scopeIsCurrent,
      );
      if (disposalResult === "stale") {
        await restoreSettingsAfterIdentityReleaseFailure(
          currentSettings,
          ownership,
        );
        return false;
      }
      if (
        disposalResult === "identity-release-failed" ||
        disposalResult === "identity-release-deferred" ||
        disposalResult === "runtime-stop-incomplete"
      ) {
        await restoreSettingsAfterIdentityReleaseFailure(
          currentSettings,
          ownership,
        );
        return false;
      }

      if (disposalResult !== "disposed" || !ownership.isCurrent()) {
        return false;
      }

      if (nextPath) {
        await openWorkspacePath(nextPath, {
          cachePreviousWorkspace: false,
        });
        return true;
      }

      await clearActiveWorkspace({
        ownership,
        runtimeAlreadyStopped: true,
      });
      return ownership.isCurrent();
    },
    [
      appSettingsRef,
      clearActiveWorkspace,
      commitWorkspaceClose,
      editorGitBaselineRequestTokenRef,
      disposeWorkspaceTabResources,
      gitDiffRequestTokenRef,
      openFileRequestTokenRef,
      openWorkspacePath,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      persistAppSettings,
      persistWorkspaceSession,
      reportError,
      resolveCachedWorkspaceState,
      restoreSettingsAfterIdentityReleaseFailure,
      workspaceCloseSession,
      workspaceIdentityByRootRef,
      workspaceHasExternalFileConflicts,
    ],
  );

  const closeWorkspaceTabOperation = useCallback(async (
    path: string,
  ): Promise<CloseCompletion> => {
    const tabPath = workspaceTabPathForIdentity(
      appSettingsRef.current.workspaceTabs,
      path,
      workspaceIdentityByRootRef.current,
    ) ?? path;
    const identity = workspaceIdentityForPaths(
      workspaceIdentityByRootRef.current,
      [tabPath, path],
    );
    const activeRoot = workspaceCloseSession.current().activeRoot;
    const activeIdentity = workspaceIdentityForPaths(
      workspaceIdentityByRootRef.current,
      activeRoot ? [activeRoot] : [],
    );
    const closingActive = workspaceRootKeysEqual(tabPath, activeRoot) ||
      Boolean(
        identity &&
        activeIdentity &&
        identity.workspaceId === activeIdentity.workspaceId,
      );
    const targetRoot = closingActive && activeRoot ? activeRoot : tabPath;
    const roots = workspaceResourceRoots(tabPath, targetRoot, identity);

    return executeDirtyClose(
      () => captureDirtyCloseTargets(targetRoot),
      roots,
      "workspace",
      (scopeIsCurrent) => commitWorkspaceTabClose(tabPath, scopeIsCurrent),
    );
  }, [
    appSettingsRef,
    captureDirtyCloseTargets,
    commitWorkspaceTabClose,
    executeDirtyClose,
    workspaceCloseSession,
    workspaceIdentityByRootRef,
  ]);

  const closeWorkspaceTab = useCallback(
    (path: string) => {
      const tabPath =
        workspaceTabPathForIdentity(
          appSettingsRef.current.workspaceTabs,
          path,
          workspaceIdentityByRootRef.current,
        ) ??
        path;
      const identityDescriptor = workspaceIdentityForPaths(
        workspaceIdentityByRootRef.current,
        [tabPath, path],
      );
      const closeKeys = workspaceCloseKeys(tabPath, identityDescriptor);
      const inFlight = closeKeys
        .map((key) => workspaceCloseInFlightRef.current.get(key))
        .find((operation) => operation !== undefined);
      if (inFlight) {
        return inFlight.then(() => undefined);
      }

      const operation = closeWorkspaceTabOperation(tabPath).then(
        () => undefined,
      ).finally(() => {
        for (const key of closeKeys) {
          if (workspaceCloseInFlightRef.current.get(key) !== operation) {
            continue;
          }

          workspaceCloseInFlightRef.current.delete(key);
        }
      });
      for (const key of closeKeys) {
        workspaceCloseInFlightRef.current.set(key, operation);
      }
      return operation;
    },
    [
      appSettingsRef,
      closeWorkspaceTabOperation,
      workspaceIdentityByRootRef,
    ],
  );

  const quitApplication = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    requestApplicationShutdown(async (scopeIsCurrent) => {
      await persistCurrentWorkspaceSession();
      if (!scopeIsCurrent()) {
        return false;
      }

      await invoke("quit_application");
      return true;
    }, "Application");
  }, [persistCurrentWorkspaceSession, requestApplicationShutdown]);

  const closeApplicationWindow = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    requestApplicationShutdown(
      (scopeIsCurrent) => confirmNativeShutdown("close", scopeIsCurrent),
      "Window",
    );
  }, [confirmNativeShutdown, requestApplicationShutdown]);

  return {
    closeApplicationWindow,
    closeWorkspaceTab,
    quitApplication,
  };
}

function stopRuntimeForOwnedClose(
  stopProjectRuntimes: WorkbenchCloseLifecycleDependencies["stopProjectRuntimes"],
  rootPath: string,
  ownership: WorkspaceCloseOwnership,
): Promise<ProjectRuntimeStopResult> {
  if (!ownership.isCurrent()) {
    return Promise.resolve("stale");
  }

  if (ownership === alwaysCurrentWorkspaceCloseOwnership) {
    return stopProjectRuntimes(rootPath);
  }

  return stopProjectRuntimes(rootPath, ownership);
}

function workbenchDirtyCloseDocumentDescriptor(
  target: WorkbenchDirtyCloseTarget,
) {
  const ownership = target.identity.ownership;
  const relativePath = "workspaceRelativePath" in ownership
    ? ownership.workspaceRelativePath
    : workspaceRelativePath(ownership.rootPath, ownership.path);

  return createDirtyCloseDocumentDescriptor(
    target.targetId,
    target.owner.executionRoot,
    relativePath,
    target.identity.saveTarget.document.name,
  );
}

function reportDirtyCloseSaveFailure(
  result: DirtyCloseSaveBlockedResult<WorkbenchDirtyCloseIdentity>,
  targetCount: number,
  reportError: WorkbenchCloseLifecycleDependencies["reportError"],
): void {
  const failed = workbenchDirtyCloseDocumentDescriptor(result.target);
  const savedCount = result.savedTargets?.length ?? 0;
  const location = `${failed.workspaceLabel} / ${failed.relativePath}`;
  const prefix = savedCount > 0
    ? `Saved ${savedCount} of ${targetCount} files.`
    : "No files were saved.";
  reportError(
    "Save",
    new Error(
      `${prefix} Could not save ${location}. The close was cancelled; fix the file and try again.`,
    ),
  );
}

function workspaceRelativePath(rootPath: string, path: string): string {
  const normalizedRoot = rootPath.replace(/[\\/]+$/, "");
  const prefix = `${normalizedRoot}/`;
  if (path.startsWith(prefix)) {
    return path.slice(prefix.length);
  }

  return path.split(/[\\/]/).pop() ?? path;
}

function workspaceIdentityForPaths(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  paths: string[],
): WorkspaceIdentityDescriptor | null {
  for (const path of paths) {
    const exactIdentity = identities[path];
    if (exactIdentity) {
      return exactIdentity;
    }
  }

  return (
    Object.values(identities).find((identity) =>
      paths.some(
        (path) =>
          workspaceRootKeysEqual(path, identity.selectedPath) ||
          workspaceRootKeysEqual(path, identity.canonicalRoot),
      ),
    ) ?? null
  );
}

function workspaceTabPathForIdentity(
  tabs: string[],
  path: string,
  identities: Record<string, WorkspaceIdentityDescriptor>,
): string | null {
  const exactTabPath = workspaceTabPathForPath(tabs, path);
  if (exactTabPath) {
    return exactTabPath;
  }

  const requestedIdentity = workspaceIdentityForPaths(identities, [path]);
  if (!requestedIdentity) {
    return null;
  }

  return (
    tabs.find((tabPath) => {
      const tabIdentity = workspaceIdentityForPaths(identities, [tabPath]);
      return tabIdentity?.workspaceId === requestedIdentity.workspaceId;
    }) ?? null
  );
}

function workspaceResourceRoots(
  tabPath: string,
  targetRootPath: string,
  identity: WorkspaceIdentityDescriptor | null,
): string[] {
  const roots = [tabPath, targetRootPath];
  if (identity) {
    roots.push(identity.selectedPath, identity.canonicalRoot);
  }

  return [...new Set(roots)];
}

function workspaceCloseKeys(
  tabPath: string,
  identity: WorkspaceIdentityDescriptor | null,
): string[] {
  const keys = [`root:${normalizedWorkspaceRootKey(tabPath)}`];
  if (!identity) {
    return keys;
  }

  keys.push(
    `workspace:${identity.workspaceId}`,
    `root:${normalizedWorkspaceRootKey(identity.selectedPath)}`,
    `root:${normalizedWorkspaceRootKey(identity.canonicalRoot)}`,
  );
  return [...new Set(keys)];
}

function resolveCachedWorkspaceStateFallback(
  cache: Record<string, CachedWorkspaceDirtyState>,
  rootPath: string,
  identity?: WorkspaceIdentityDescriptor | null,
): CachedWorkspaceDirtyState | null {
  if (!identity) {
    return cache[normalizedWorkspaceRootKey(rootPath)] ?? null;
  }

  const identityKey = workspaceIdentityStateCacheKey(identity.workspaceId);
  return (
    matchingCachedWorkspaceState(cache[identityKey], identity) ??
    Object.values(cache).find(
      (cached) => matchingCachedWorkspaceState(cached, identity) !== null,
    ) ??
    null
  );
}

function forgetCachedWorkspaceStateFallback(
  cache: Record<string, CachedWorkspaceDirtyState>,
  rootPath: string,
  identity?: WorkspaceIdentityDescriptor | null,
): void {
  if (!identity) {
    delete cache[normalizedWorkspaceRootKey(rootPath)];
    return;
  }

  for (const [key, cached] of Object.entries(cache)) {
    if (matchingCachedWorkspaceState(cached, identity) === null) {
      continue;
    }

    delete cache[key];
  }
}

function matchingCachedWorkspaceState(
  cached: CachedWorkspaceDirtyState | undefined,
  identity: WorkspaceIdentityDescriptor,
): CachedWorkspaceDirtyState | null {
  if (
    cached?.workspaceIdentityDescriptor?.workspaceId !== identity.workspaceId
  ) {
    return null;
  }

  return cached;
}

function workspaceTabsWithoutPath(tabs: string[], path: string): string[] {
  return tabs.filter((tabPath) => !workspaceRootKeysEqual(tabPath, path));
}

function workspaceTabPathForPath(
  tabs: string[],
  path: string | null | undefined,
): string | null {
  return tabs.find((tabPath) => workspaceRootKeysEqual(tabPath, path)) ?? null;
}

function workspaceTabIndexForPath(
  tabs: string[],
  path: string | null | undefined,
): number {
  return tabs.findIndex((tabPath) => workspaceRootKeysEqual(tabPath, path));
}

function uniqueNormalizedWorkspaceRoots(
  paths: Array<string | null | undefined>,
): string[] {
  const roots: string[] = [];

  for (const path of paths) {
    const root = normalizedWorkspaceRootKey(path);
    if (!root || roots.includes(root)) {
      continue;
    }

    roots.push(root);
  }

  return roots;
}

function runWithWorkspaceSaveExclusions<T>(
  roots: string[],
  runWithDocumentSaveExclusion: RunWithDocumentSaveExclusion,
  operation: () => Promise<T>,
  index = 0,
): Promise<T> {
  const rootPath = roots[index];
  if (!rootPath) {
    return operation();
  }

  return runWithDocumentSaveExclusion({ kind: "workspace", rootPath }, () =>
    runWithWorkspaceSaveExclusions(
      roots,
      runWithDocumentSaveExclusion,
      operation,
      index + 1,
    ),
  );
}

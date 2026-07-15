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
import { createWorkspaceRoot } from "../domain/workspacePath";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import { documentNeedsAttention } from "../domain/externalFileConflict";
import { isDirty } from "../domain/workspace";
import {
  normalizedWorkspaceRootKey,
  workspaceRootKeysEqual,
} from "../domain/workspaceRootKey";
import { CloseCoordinator } from "./closeCoordinator";
import type { RunWithDocumentSaveExclusion } from "./documentSaveCoordinator";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { WorkspaceStateCache } from "./useWorkspaceStateCache";

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
  ) => Promise<void>;
  forgetLanguageServerRuntimeStatuses: (rootPath: string) => void;
  forgetLatencyTrackerForRoot: (rootPath: string) => void;
  unregisterWorkspace: (
    workspaceId: string,
  ) => Promise<WorkspaceIdentityReleaseOutcome | void>;
  clearExternalFileConflictsForRoot: (rootPath: string) => void;
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
type WorkspaceDisposalResult =
  | "disposed"
  | "identity-release-deferred"
  | "identity-release-failed"
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
    dirtyCount,
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
    editorConfigCacheRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    openFileRequestTokenRef,
    gitDiffRequestTokenRef,
    editorGitBaselineRequestTokenRef,
    prompter,
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
    workspaceHasExternalFileConflicts,
    openWorkspacePath,
    clearActiveWorkspace,
    persistWorkspaceSession = async () => undefined,
    reportError,
  } = dependencies;
  const closeCoordinator = useMemo(() => new CloseCoordinator(), []);
  const nativeCloseInFlightRef = useRef(false);
  const workspaceCloseInFlightRef = useRef(new Map<string, Promise<void>>());
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
    async (kind: NativeCloseKind) => {
      await persistCurrentWorkspaceSession();
      await invoke("confirm_native_shutdown", { kind });
    },
    [persistCurrentWorkspaceSession],
  );

  const applicationNeedsAttention = useCallback(() => {
    if (dirtyCount > 0) {
      return true;
    }

    if (workspaceRoot && workspaceHasExternalFileConflicts(workspaceRoot)) {
      return true;
    }

    const inactiveCachedRoots: Array<{
      hasDirtyDocuments: boolean;
      roots: string[];
      workspaceId: string | null;
    }> = [];
    const activeIdentity = workspaceIdentityForPaths(
      workspaceIdentityByRootRef.current,
      workspaceRoot ? [workspaceRoot] : [],
    );
    for (const [cachedRoot, cachedState] of Object.entries(
      workspaceStateCacheRef.current,
    )) {
      const cachedIdentity =
        cachedState.workspaceIdentityDescriptor ??
        workspaceIdentityForPaths(workspaceIdentityByRootRef.current, [
          cachedRoot,
        ]);
      if (
        workspaceRootKeysEqual(cachedRoot, workspaceRoot) ||
        workspaceIdentityMatchesActiveRoot(
          cachedIdentity,
          activeIdentity,
          workspaceRoot,
        )
      ) {
        continue;
      }

      const existingRoot = inactiveCachedRoots.find(
        ({ roots, workspaceId }) =>
          Boolean(
            workspaceId &&
              cachedIdentity &&
              workspaceId === cachedIdentity.workspaceId,
          ) || workspaceRootKeysEqual(roots[0], cachedRoot),
      );
      if (existingRoot) {
        existingRoot.hasDirtyDocuments ||=
          cachedWorkspaceHasDirtyDocuments(cachedState);
        existingRoot.roots.push(cachedRoot);
        continue;
      }

      inactiveCachedRoots.push({
        hasDirtyDocuments: cachedWorkspaceHasDirtyDocuments(cachedState),
        roots: [cachedRoot],
        workspaceId: cachedIdentity?.workspaceId ?? null,
      });
    }

    for (const cachedRoot of inactiveCachedRoots) {
      if (
        documentNeedsAttention(
          cachedRoot.hasDirtyDocuments,
          cachedRoot.roots.some((root) =>
            workspaceHasExternalFileConflicts(root),
          ),
        )
      ) {
        return true;
      }
    }

    return false;
  }, [
    dirtyCount,
    workspaceHasExternalFileConflicts,
    workspaceRoot,
    workspaceStateCacheRef,
    workspaceIdentityByRootRef,
  ]);

  const requestApplicationShutdown = useCallback(
    (shutdown: () => Promise<void>, errorSource: string) => {
      if (nativeCloseInFlightRef.current) {
        return;
      }

      nativeCloseInFlightRef.current = true;
      if (
        applicationNeedsAttention() &&
        !prompter.confirm("Quit and discard unsaved changes?")
      ) {
        queueMicrotask(() => {
          nativeCloseInFlightRef.current = false;
        });
        return;
      }

      const roots = uniqueNormalizedWorkspaceRoots([
        ...appSettingsRef.current.workspaceTabs,
        workspaceRoot,
      ]);
      void runWithWorkspaceSaveExclusions(
        roots,
        runWithDocumentSaveExclusion,
        shutdown,
      ).catch((error) => {
        nativeCloseInFlightRef.current = false;
        reportError(errorSource, error);
      });
    },
    [
      appSettingsRef,
      applicationNeedsAttention,
      prompter,
      reportError,
      runWithDocumentSaveExclusion,
      workspaceRoot,
    ],
  );

  nativeCloseRequestRef.current = (payload) => {
    if (!isNativeCloseKind(payload)) {
      reportError("Application", new Error("Invalid native close request"));
      return;
    }

    requestApplicationShutdown(
      () => confirmNativeShutdown(payload),
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
    ): Promise<WorkspaceDisposalResult> => {
      if (!ownership.isCurrent()) {
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

        if (!ownership.isCurrent()) {
          return "stale";
        }
      }

      await closeCoordinator.close({
        closeDocuments: [
          () =>
            ownership.isCurrent()
              ? closeSyncedLanguageServerDocumentsForRoot(targetRootPath)
              : Promise.resolve(),
          () =>
            ownership.isCurrent()
              ? closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath)
              : Promise.resolve(),
        ],
        disposeRuntime: () =>
          stopRuntimeForOwnedClose(
            stopProjectRuntimes,
            targetRootPath,
            ownership,
          ),
      });

      if (!ownership.isCurrent()) {
        return "stale";
      }

      forgetCachedWorkspaceState(tabPath, identityDescriptor);
      const resourceRoots = workspaceResourceRoots(
        tabPath,
        targetRootPath,
        identityDescriptor,
      );
      for (const rootPath of resourceRoots) {
        delete editorConfigCacheRef.current[rootPath];
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
      editorConfigCacheRef,
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

  const closeWorkspaceTabOperation = useCallback(
    async (path: string) => {
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
        return;
      }

      const cachedWorkspaceState = resolveCachedWorkspaceState(
        tabPath,
        identityDescriptor,
      );

      if (
        closingActiveWorkspace &&
        activeSession.needsAttention &&
        !prompter.confirm("Close workspace and discard unsaved changes?")
      ) {
        return;
      }

      if (!closingActiveWorkspace) {
        if (
          cachedWorkspaceState &&
          documentNeedsAttention(
            cachedWorkspaceHasDirtyDocuments(cachedWorkspaceState),
            workspaceHasExternalFileConflicts(targetRootPath),
          ) &&
          !prompter.confirm("Close workspace and discard unsaved changes?")
        ) {
          return;
        }
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
        await runWithDocumentSaveExclusion(
          {
            kind: "workspace",
            rootPath: normalizedWorkspaceRootKey(targetRootPath),
          },
          async () => {
            if (!ownership.isCurrent()) {
              return;
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
              return;
            }

            if (!ownership.isCurrent()) {
              return;
            }

            const disposalResult = await disposeWorkspaceTabResources(
              tabPath,
              targetRootPath,
              identityDescriptor,
              ownership,
            );
            if (
              disposalResult !== "identity-release-failed" &&
              disposalResult !== "identity-release-deferred"
            ) {
              return;
            }

            await restoreSettingsAfterIdentityReleaseFailure(
              currentSettings,
              ownership,
            );
          },
        );
        return;
      }

      await runWithDocumentSaveExclusion(
        {
          kind: "workspace",
          rootPath: normalizedWorkspaceRootKey(targetRootPath),
        },
        async () => {
          if (!ownership.isCurrent()) {
            return;
          }

          try {
            await persistWorkspaceSession(targetRootPath);
          } catch (error) {
            reportError("Session", error);
          }

          if (!ownership.isCurrent()) {
            return;
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
            return;
          }

          if (!ownership.isCurrent()) {
            return;
          }

          const disposalResult = await disposeWorkspaceTabResources(
            tabPath,
            targetRootPath,
            identityDescriptor,
            ownership,
          );
          if (
            disposalResult === "identity-release-failed" ||
            disposalResult === "identity-release-deferred"
          ) {
            await restoreSettingsAfterIdentityReleaseFailure(
              currentSettings,
              ownership,
            );
            return;
          }

          if (disposalResult !== "disposed" || !ownership.isCurrent()) {
            return;
          }

          if (nextPath) {
            await openWorkspacePath(nextPath, {
              cachePreviousWorkspace: false,
            });
            return;
          }

          await clearActiveWorkspace({
            ownership,
            runtimeAlreadyStopped: true,
          });
        },
      );
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
      prompter,
      reportError,
      runWithDocumentSaveExclusion,
      resolveCachedWorkspaceState,
      restoreSettingsAfterIdentityReleaseFailure,
      workspaceCloseSession,
      workspaceIdentityByRootRef,
      workspaceHasExternalFileConflicts,
    ],
  );

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
        return inFlight;
      }

      const operation = closeWorkspaceTabOperation(tabPath).finally(() => {
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

    requestApplicationShutdown(async () => {
      await persistCurrentWorkspaceSession();
      await invoke("quit_application");
    }, "Application");
  }, [persistCurrentWorkspaceSession, requestApplicationShutdown]);

  const closeApplicationWindow = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    requestApplicationShutdown(() => confirmNativeShutdown("close"), "Window");
  }, [confirmNativeShutdown, requestApplicationShutdown]);

  return {
    closeApplicationWindow,
    closeWorkspaceTab,
    quitApplication,
  };
}

function cachedWorkspaceHasDirtyDocuments(
  cached: CachedWorkspaceDirtyState,
): boolean {
  return Object.values(cached.editorSurface.documents).some(
    (document) => !document.readOnly && isDirty(document),
  );
}

function stopRuntimeForOwnedClose(
  stopProjectRuntimes: WorkbenchCloseLifecycleDependencies["stopProjectRuntimes"],
  rootPath: string,
  ownership: WorkspaceCloseOwnership,
): Promise<void> {
  if (!ownership.isCurrent()) {
    return Promise.resolve();
  }

  if (ownership === alwaysCurrentWorkspaceCloseOwnership) {
    return stopProjectRuntimes(rootPath);
  }

  return stopProjectRuntimes(rootPath, ownership);
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

function workspaceIdentityMatchesActiveRoot(
  cachedIdentity: WorkspaceIdentityDescriptor | null,
  activeIdentity: WorkspaceIdentityDescriptor | null,
  activeRoot: string | null,
): boolean {
  if (!cachedIdentity) {
    return false;
  }

  if (
    activeIdentity &&
    cachedIdentity.workspaceId === activeIdentity.workspaceId
  ) {
    return true;
  }

  return (
    workspaceRootKeysEqual(cachedIdentity.selectedPath, activeRoot) ||
    workspaceRootKeysEqual(cachedIdentity.canonicalRoot, activeRoot)
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
    return cache[rootPath] ?? null;
  }

  const canonicalKey = canonicalWorkspaceRootKey(identity);
  return (
    cache[canonicalKey] ??
    cache[rootPath] ??
    cache[identity.selectedPath] ??
    Object.values(cache).find(
      (cached) =>
        cached.workspaceIdentityDescriptor?.workspaceId ===
        identity.workspaceId,
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
    delete cache[rootPath];
    return;
  }

  const canonicalKey = canonicalWorkspaceRootKey(identity);
  for (const [key, cached] of Object.entries(cache)) {
    if (
      key !== rootPath &&
      key !== identity.selectedPath &&
      key !== canonicalKey &&
      cached.workspaceIdentityDescriptor?.workspaceId !== identity.workspaceId
    ) {
      continue;
    }

    delete cache[key];
  }
}

function canonicalWorkspaceRootKey(
  identity: WorkspaceIdentityDescriptor,
): string {
  const root = createWorkspaceRoot(
    identity.workspaceId,
    identity.canonicalRoot,
    identity.policy,
  );
  if (!root.ok) {
    return identity.canonicalRoot;
  }

  return root.value.nativePath;
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

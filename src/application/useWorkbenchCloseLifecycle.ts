import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useMemo, type MutableRefObject } from "react";
import type { EditorConfigFile } from "../domain/editorConfig";
import type { AppSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import type { WorkspaceIdentityDescriptor } from "../infrastructure/tauriWorkspaceIdentityGateway";
import { documentNeedsAttention } from "../domain/externalFileConflict";
import { isDirty } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { CloseCoordinator } from "./closeCoordinator";
import type { WorkbenchPrompter } from "./workbenchPrompter";

interface CachedWorkspaceDirtyState {
  documents: Record<string, EditorDocument>;
}

interface OpenWorkspacePathOptions {
  cachePreviousWorkspace?: boolean;
}

export interface WorkbenchCloseLifecycleDependencies {
  workspaceRoot: string | null;
  dirtyCount: number;

  appSettingsRef: MutableRefObject<AppSettings>;
  workspaceStateCacheRef: MutableRefObject<Record<string, CachedWorkspaceDirtyState>>;
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
  persistAppSettings: (nextSettings: AppSettings) => Promise<void>;
  closeSyncedLanguageServerDocumentsForRoot: (
    rootPath: string,
  ) => Promise<void>;
  closeSyncedJavaScriptTypeScriptDocumentsForRoot: (
    rootPath: string,
  ) => Promise<void>;
  stopProjectRuntimes: (rootPath?: string) => Promise<void>;
  forgetLanguageServerRuntimeStatuses: (rootPath: string) => void;
  forgetLatencyTrackerForRoot: (rootPath: string) => void;
  unregisterWorkspace: (workspaceId: string) => Promise<void>;
  clearExternalFileConflictsForRoot: (rootPath: string) => void;
  workspaceHasExternalFileConflicts: (rootPath: string) => boolean;
  openWorkspacePath: (
    path: string,
    options?: OpenWorkspacePathOptions,
  ) => Promise<void>;
  clearActiveWorkspace: () => Promise<void>;
  persistWorkspaceSession?: (rootPath: string) => Promise<void>;
  reportError: (source: string, error: unknown) => void;
}

export interface WorkbenchCloseLifecycle {
  closeWorkspaceTab: (path: string) => Promise<void>;
  closeApplicationWindow: () => void;
  quitApplication: () => void;
}

export function useWorkbenchCloseLifecycle(
  dependencies: WorkbenchCloseLifecycleDependencies,
): WorkbenchCloseLifecycle {
  const {
    workspaceRoot,
    dirtyCount,
    appSettingsRef,
    workspaceStateCacheRef,
    workspaceIdentityByRootRef,
    editorConfigCacheRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    openFileRequestTokenRef,
    gitDiffRequestTokenRef,
    editorGitBaselineRequestTokenRef,
    prompter,
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

  const disposeWorkspaceTabResources = useCallback(
    async (tabPath: string, targetRootPath: string) => {
      delete workspaceStateCacheRef.current[tabPath];
      delete workspaceStateCacheRef.current[targetRootPath];
      delete editorConfigCacheRef.current[tabPath];
      delete editorConfigCacheRef.current[targetRootPath];
      clearExternalFileConflictsForRoot(targetRootPath);

      const identityDescriptor =
        workspaceIdentityByRootRef.current[tabPath] ??
        workspaceIdentityByRootRef.current[targetRootPath] ??
        null;
      if (identityDescriptor) {
        delete workspaceIdentityByRootRef.current[identityDescriptor.selectedPath];
        delete workspaceIdentityByRootRef.current[identityDescriptor.canonicalRoot];
        try {
          await unregisterWorkspace(identityDescriptor.workspaceId);
        } catch (error) {
          reportError("Workspace", error);
        }
      }

      forgetLatencyTrackerForRoot(targetRootPath);
      forgetLanguageServerRuntimeStatuses(targetRootPath);
      await closeCoordinator.close({
        closeDocuments: [
          () => closeSyncedLanguageServerDocumentsForRoot(targetRootPath),
          () => closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath),
        ],
        disposeRuntime: () => stopProjectRuntimes(targetRootPath),
      });
      forgetLanguageServerRuntimeStatuses(targetRootPath);
    },
    [
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      closeCoordinator,
      clearExternalFileConflictsForRoot,
      editorConfigCacheRef,
      forgetLanguageServerRuntimeStatuses,
      forgetLatencyTrackerForRoot,
      stopProjectRuntimes,
      workspaceStateCacheRef,
      workspaceIdentityByRootRef,
      unregisterWorkspace,
      reportError,
    ],
  );

  const closeWorkspaceTab = useCallback(
    async (path: string) => {
      const currentSettings = appSettingsRef.current;
      const currentTabs = currentSettings.workspaceTabs;
      const tabPath = workspaceTabPathForPath(currentTabs, path) ?? path;
      const closingActiveWorkspace = workspaceRootKeysEqual(tabPath, workspaceRoot);
      const targetRootPath =
        closingActiveWorkspace && workspaceRoot ? workspaceRoot : tabPath;
      const nextTabs = workspaceTabsWithoutPath(currentTabs, path);
      const cachedWorkspaceState =
        workspaceStateCacheRef.current[tabPath] ??
        workspaceStateCacheRef.current[targetRootPath] ??
        null;

      if (nextTabs.length === currentTabs.length) {
        return;
      }

      if (
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, tabPath) ||
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, targetRootPath)
      ) {
        openWorkspaceRequestTokenRef.current += 1;
        openWorkspaceRequestPathRef.current = null;
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

        const nextRecentPath =
          workspaceRootKeysEqual(currentSettings.recentWorkspacePath, tabPath)
            ? workspaceRoot ?? nextTabs[nextTabs.length - 1] ?? null
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
        await disposeWorkspaceTabResources(tabPath, targetRootPath);
        return;
      }

      if (
        dirtyCount > 0 &&
        !prompter.confirm("Close workspace and discard unsaved changes?")
      ) {
        return;
      }

      try {
        await persistWorkspaceSession(targetRootPath);
      } catch (error) {
        reportError("Session", error);
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

      await disposeWorkspaceTabResources(tabPath, targetRootPath);

      if (nextPath) {
        await openWorkspacePath(nextPath, { cachePreviousWorkspace: false });
        return;
      }

      await clearActiveWorkspace();
    },
    [
      appSettingsRef,
      clearActiveWorkspace,
      dirtyCount,
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
      workspaceRoot,
      workspaceStateCacheRef,
      workspaceHasExternalFileConflicts,
    ],
  );

  const quitApplication = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    void (async () => {
      if (workspaceRoot) {
        try {
          await persistWorkspaceSession(workspaceRoot);
        } catch (error) {
          reportError("Session", error);
        }
      }

      await invoke("quit_application");
    })().catch((error) => reportError("Application", error));
  }, [persistWorkspaceSession, reportError, workspaceRoot]);

  const closeApplicationWindow = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    void (async () => {
      if (workspaceRoot) {
        try {
          await persistWorkspaceSession(workspaceRoot);
        } catch (error) {
          reportError("Session", error);
        }
      }

      await getCurrentWindow().close();
    })().catch((error) => reportError("Window", error));
  }, [persistWorkspaceSession, reportError, workspaceRoot]);

  return {
    closeApplicationWindow,
    closeWorkspaceTab,
    quitApplication,
  };
}

function cachedWorkspaceHasDirtyDocuments(
  cached: CachedWorkspaceDirtyState,
): boolean {
  return Object.values(cached.documents).some(isDirty);
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

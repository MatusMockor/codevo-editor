import { invoke, isTauri } from "@tauri-apps/api/core";
import { useCallback, type MutableRefObject } from "react";
import type { EditorConfigFile } from "../domain/editorConfig";
import type { AppSettings } from "../domain/settings";
import type { EditorDocument } from "../domain/workspace";
import { isDirty } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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
  openWorkspacePath: (
    path: string,
    options?: OpenWorkspacePathOptions,
  ) => Promise<void>;
  clearActiveWorkspace: () => Promise<void>;
  reportError: (source: string, error: unknown) => void;
}

export interface WorkbenchCloseLifecycle {
  closeWorkspaceTab: (path: string) => Promise<void>;
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
    openWorkspacePath,
    clearActiveWorkspace,
    reportError,
  } = dependencies;

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
          cachedWorkspaceHasDirtyDocuments(cachedWorkspaceState) &&
          !prompter.confirm("Close workspace and discard unsaved changes?")
        ) {
          return;
        }

        const nextRecentPath =
          workspaceRootKeysEqual(currentSettings.recentWorkspacePath, tabPath)
            ? workspaceRoot ?? nextTabs[nextTabs.length - 1] ?? null
            : currentSettings.recentWorkspacePath;

        delete workspaceStateCacheRef.current[tabPath];
        delete workspaceStateCacheRef.current[targetRootPath];
        delete editorConfigCacheRef.current[tabPath];
        delete editorConfigCacheRef.current[targetRootPath];
        forgetLatencyTrackerForRoot(targetRootPath);
        forgetLanguageServerRuntimeStatuses(targetRootPath);
        await Promise.allSettled([
          closeSyncedLanguageServerDocumentsForRoot(targetRootPath),
          closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath),
        ]);
        await stopProjectRuntimes(targetRootPath);
        forgetLanguageServerRuntimeStatuses(targetRootPath);

        try {
          await persistAppSettings({
            ...currentSettings,
            recentWorkspacePath: nextRecentPath,
            workspaceTabs: nextTabs,
          });
        } catch (error) {
          reportError("Settings", error);
        }
        return;
      }

      if (
        dirtyCount > 0 &&
        !prompter.confirm("Close workspace and discard unsaved changes?")
      ) {
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

      delete workspaceStateCacheRef.current[tabPath];
      delete workspaceStateCacheRef.current[targetRootPath];
      delete editorConfigCacheRef.current[tabPath];
      delete editorConfigCacheRef.current[targetRootPath];
      forgetLatencyTrackerForRoot(targetRootPath);
      forgetLanguageServerRuntimeStatuses(targetRootPath);
      await Promise.allSettled([
        closeSyncedLanguageServerDocumentsForRoot(targetRootPath),
        closeSyncedJavaScriptTypeScriptDocumentsForRoot(targetRootPath),
      ]);
      await stopProjectRuntimes(targetRootPath);
      forgetLanguageServerRuntimeStatuses(targetRootPath);

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

      if (nextPath) {
        await openWorkspacePath(nextPath, { cachePreviousWorkspace: false });
        return;
      }

      await clearActiveWorkspace();
    },
    [
      appSettingsRef,
      clearActiveWorkspace,
      closeSyncedJavaScriptTypeScriptDocumentsForRoot,
      closeSyncedLanguageServerDocumentsForRoot,
      dirtyCount,
      editorConfigCacheRef,
      editorGitBaselineRequestTokenRef,
      forgetLanguageServerRuntimeStatuses,
      forgetLatencyTrackerForRoot,
      gitDiffRequestTokenRef,
      openFileRequestTokenRef,
      openWorkspacePath,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      persistAppSettings,
      prompter,
      reportError,
      stopProjectRuntimes,
      workspaceRoot,
      workspaceStateCacheRef,
    ],
  );

  const quitApplication = useCallback(() => {
    if (!isTauri()) {
      return;
    }

    void invoke("quit_application").catch((error) =>
      reportError("Application", error),
    );
  }, [reportError]);

  return {
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

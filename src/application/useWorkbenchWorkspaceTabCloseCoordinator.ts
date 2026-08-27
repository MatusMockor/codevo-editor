import { useCallback, useRef, type MutableRefObject } from "react";
import type { AppSettings } from "../domain/settings";
import type { CloseCompletion } from "../domain/dirtyClose";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { WorkspaceIdentityDescriptor } from "./workspaceIdentityGatewayPort";
import type {
  WorkbenchDirtyCloseTarget,
  WorkspaceCloseOwnership,
  WorkspaceCloseSessionPort,
} from "./useWorkbenchCloseLifecycle";

type CloseScopeGuard = () => boolean;

export type WorkspaceTabDisposalResult =
  | "backend-closed-local-stale"
  | "disposed"
  | "identity-release-deferred"
  | "identity-release-failed"
  | "runtime-stop-incomplete"
  | "stale";

export interface WorkbenchWorkspaceTabCloseCoordinatorDependencies {
  readonly activeRef: MutableRefObject<boolean>;
  readonly appSettingsRef: MutableRefObject<AppSettings>;
  readonly workspaceIdentityByRootRef: MutableRefObject<
    Record<string, WorkspaceIdentityDescriptor>
  >;
  readonly openWorkspaceRequestPathRef: MutableRefObject<string | null>;
  readonly openWorkspaceRequestTokenRef: MutableRefObject<number>;
  readonly openFileRequestTokenRef: MutableRefObject<number>;
  readonly gitDiffRequestTokenRef: MutableRefObject<number>;
  readonly editorGitBaselineRequestTokenRef: MutableRefObject<number>;
  readonly workspaceCloseSession: WorkspaceCloseSessionPort;
  readonly captureDirtyCloseTargets: (
    rootPath: string | null,
  ) => readonly WorkbenchDirtyCloseTarget[] | null;
  readonly executeDirtyClose: (
    captureTargets: () => readonly WorkbenchDirtyCloseTarget[] | null,
    roots: readonly string[],
    scope: "workspace",
    commit: (scopeIsCurrent: CloseScopeGuard) => Promise<boolean>,
  ) => Promise<CloseCompletion>;
  readonly commitWorkspaceClose: (
    rootPath: string,
    identity: WorkspaceIdentityDescriptor | null,
  ) => WorkspaceCloseOwnership | void;
  readonly persistAppSettings: (settings: AppSettings) => Promise<void>;
  readonly persistWorkspaceSession: (rootPath: string) => Promise<void>;
  readonly disposeWorkspaceTabResources: (
    tabPath: string,
    targetRootPath: string,
    identity: WorkspaceIdentityDescriptor | null,
    ownership: WorkspaceCloseOwnership,
    scopeIsCurrent: CloseScopeGuard,
    legacyOwnership: boolean,
  ) => Promise<WorkspaceTabDisposalResult>;
  readonly openWorkspacePath: (
    path: string,
    options?: { readonly cachePreviousWorkspace?: boolean },
  ) => Promise<void>;
  readonly clearActiveWorkspace: (options?: {
    readonly ownership?: WorkspaceCloseOwnership;
    readonly runtimeAlreadyStopped?: boolean;
  }) => Promise<void>;
  readonly prepareRetainedStateCleanup: (
    path: string,
    identity: WorkspaceIdentityDescriptor | null,
  ) => () => void;
  readonly reportError: (source: string, error: unknown) => void;
}

const alwaysCurrentWorkspaceCloseOwnership: WorkspaceCloseOwnership = {
  isCurrent: () => true,
};

export function useWorkbenchWorkspaceTabCloseCoordinator(
  dependencies: WorkbenchWorkspaceTabCloseCoordinatorDependencies,
): (path: string) => Promise<void> {
  const {
    activeRef,
    appSettingsRef,
    workspaceIdentityByRootRef,
    openWorkspaceRequestPathRef,
    openWorkspaceRequestTokenRef,
    openFileRequestTokenRef,
    gitDiffRequestTokenRef,
    editorGitBaselineRequestTokenRef,
    workspaceCloseSession,
    captureDirtyCloseTargets,
    executeDirtyClose,
    commitWorkspaceClose,
    persistAppSettings,
    persistWorkspaceSession,
    disposeWorkspaceTabResources,
    openWorkspacePath,
    clearActiveWorkspace,
    prepareRetainedStateCleanup,
    reportError,
  } = dependencies;
  const inFlightRef = useRef(new Map<string, Promise<void>>());

  const restoreSettings = useCallback(
    async (
      previousSettings: AppSettings,
      attemptedSettings: AppSettings,
      tabPath: string,
      ownership: WorkspaceCloseOwnership,
    ): Promise<void> => {
      const isCurrent = () => activeRef.current && ownership.isCurrent();
      if (!isCurrent()) return;
      const currentSettings = appSettingsRef.current;
      const restoredSettings = restoreClosedWorkspaceTab(
        currentSettings,
        previousSettings,
        attemptedSettings,
        tabPath,
      );
      try {
        await persistAppSettings(restoredSettings);
        if (!isCurrent()) return;
      } catch (error) {
        if (!isCurrent()) return;
        reportError("Settings", error);
      }
    },
    [activeRef, appSettingsRef, persistAppSettings, reportError],
  );

  const commitTabClose = useCallback(
    async (path: string, scopeIsCurrent: CloseScopeGuard): Promise<boolean> => {
      const currentSettings = appSettingsRef.current;
      const currentTabs = currentSettings.workspaceTabs;
      const tabPath =
        workspaceTabPathForIdentity(currentTabs, path, workspaceIdentityByRootRef.current) ?? path;
      const activeRootPath = workspaceCloseSession.current().activeRoot;
      const identity = workspaceIdentityForPaths(workspaceIdentityByRootRef.current, [
        tabPath,
        path,
      ]);
      const activeIdentity = workspaceIdentityForPaths(
        workspaceIdentityByRootRef.current,
        activeRootPath ? [activeRootPath] : [],
      );
      const closingActive =
        workspaceRootKeysEqual(tabPath, activeRootPath) ||
        Boolean(identity && activeIdentity && identity.workspaceId === activeIdentity.workspaceId);
      const targetRootPath = closingActive && activeRootPath ? activeRootPath : tabPath;
      const nextTabs = workspaceTabsWithoutPath(currentTabs, path);
      if (nextTabs.length === currentTabs.length) return true;

      const capturedOwnership = commitWorkspaceClose(targetRootPath, identity);
      const ownership = capturedOwnership ?? alwaysCurrentWorkspaceCloseOwnership;
      const legacyOwnership = capturedOwnership === undefined;
      if (
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, tabPath) ||
        workspaceRootKeysEqual(openWorkspaceRequestPathRef.current, targetRootPath)
      ) {
        openWorkspaceRequestTokenRef.current += 1;
        openWorkspaceRequestPathRef.current = null;
      }

      if (!closingActive) {
        if (!ownership.isCurrent()) return false;
        const nextRecentPath = workspaceRootKeysEqual(currentSettings.recentWorkspacePath, tabPath)
          ? (activeRootPath ?? nextTabs[nextTabs.length - 1] ?? null)
          : currentSettings.recentWorkspacePath;
        const attemptedSettings = closeSettings(currentSettings, nextTabs, nextRecentPath);
        if (!(await persistNextSettings(attemptedSettings))) return false;
        if (!ownership.isCurrent() || !scopeIsCurrent()) {
          await restoreSettings(currentSettings, attemptedSettings, tabPath, ownership);
          return false;
        }
        return settleDisposal(
          await disposeWorkspaceTabResources(
            tabPath,
            targetRootPath,
            identity,
            ownership,
            scopeIsCurrent,
            legacyOwnership,
          ),
          currentSettings,
          attemptedSettings,
          tabPath,
          ownership,
          false,
          targetRootPath,
        );
      }

      if (!ownership.isCurrent()) return false;
      try {
        await persistWorkspaceSession(targetRootPath);
      } catch (error) {
        if (!ownership.isCurrent() || !scopeIsCurrent()) return false;
        reportError("Session", error);
      }
      if (!ownership.isCurrent() || !scopeIsCurrent()) return false;

      openFileRequestTokenRef.current += 1;
      gitDiffRequestTokenRef.current += 1;
      editorGitBaselineRequestTokenRef.current += 1;
      const currentIndex = workspaceTabIndexForPath(currentTabs, tabPath);
      const nextPath =
        nextTabs[Math.min(currentIndex, nextTabs.length - 1)] ??
        nextTabs[nextTabs.length - 1] ??
        null;
      const attemptedSettings = closeSettings(currentSettings, nextTabs, nextPath);
      if (!(await persistNextSettings(attemptedSettings))) return false;
      if (!ownership.isCurrent() || !scopeIsCurrent()) {
        await restoreSettings(currentSettings, attemptedSettings, tabPath, ownership);
        return false;
      }

      const disposed = await settleDisposal(
        await disposeWorkspaceTabResources(
          tabPath,
          targetRootPath,
          identity,
          ownership,
          scopeIsCurrent,
          legacyOwnership,
        ),
        currentSettings,
        attemptedSettings,
        tabPath,
        ownership,
        true,
        targetRootPath,
      );
      if (!disposed || !activeRef.current || !ownership.isCurrent()) return false;
      if (nextPath) {
        await openWorkspacePath(nextPath, { cachePreviousWorkspace: false });
        return activeRef.current && ownership.isCurrent();
      }
      await clearActiveWorkspace({ ownership, runtimeAlreadyStopped: true });
      return activeRef.current && ownership.isCurrent();

      async function persistNextSettings(settings: AppSettings): Promise<boolean> {
        try {
          await persistAppSettings(settings);
          return true;
        } catch (error) {
          if (!ownership.isCurrent() || !scopeIsCurrent()) return false;
          reportError("Settings", error);
          return false;
        }
      }

      async function settleDisposal(
        result: WorkspaceTabDisposalResult,
        previousSettings: AppSettings,
        attemptedSettings: AppSettings,
        closedTabPath: string,
        closeOwnership: WorkspaceCloseOwnership,
        activeWorkspace: boolean,
        rootPath: string,
      ): Promise<boolean> {
        switch (result) {
          case "disposed":
            return activeRef.current && closeOwnership.isCurrent();
          case "backend-closed-local-stale":
            await restoreSettings(
              previousSettings,
              attemptedSettings,
              closedTabPath,
              closeOwnership,
            );
            if (!activeWorkspace || !activeRef.current || !closeOwnership.isCurrent()) {
              return false;
            }
            await openWorkspacePath(rootPath);
            return false;
          case "identity-release-deferred":
          case "identity-release-failed":
          case "runtime-stop-incomplete":
          case "stale":
            await restoreSettings(
              previousSettings,
              attemptedSettings,
              closedTabPath,
              closeOwnership,
            );
            return false;
          default: {
            const exhaustive: never = result;
            return exhaustive;
          }
        }
      }
    },
    [
      activeRef,
      appSettingsRef,
      clearActiveWorkspace,
      commitWorkspaceClose,
      disposeWorkspaceTabResources,
      editorGitBaselineRequestTokenRef,
      gitDiffRequestTokenRef,
      openFileRequestTokenRef,
      openWorkspacePath,
      openWorkspaceRequestPathRef,
      openWorkspaceRequestTokenRef,
      persistAppSettings,
      persistWorkspaceSession,
      reportError,
      restoreSettings,
      workspaceCloseSession,
      workspaceIdentityByRootRef,
    ],
  );

  const closeOperation = useCallback(
    async (path: string): Promise<CloseCompletion> => {
      const tabPath =
        workspaceTabPathForIdentity(
          appSettingsRef.current.workspaceTabs,
          path,
          workspaceIdentityByRootRef.current,
        ) ?? path;
      const identity = workspaceIdentityForPaths(workspaceIdentityByRootRef.current, [
        tabPath,
        path,
      ]);
      const activeRoot = workspaceCloseSession.current().activeRoot;
      const activeIdentity = workspaceIdentityForPaths(
        workspaceIdentityByRootRef.current,
        activeRoot ? [activeRoot] : [],
      );
      const closingActive =
        workspaceRootKeysEqual(tabPath, activeRoot) ||
        Boolean(identity && activeIdentity && identity.workspaceId === activeIdentity.workspaceId);
      const targetRoot = closingActive && activeRoot ? activeRoot : tabPath;
      return executeDirtyClose(
        () => captureDirtyCloseTargets(targetRoot),
        workspaceResourceRoots(tabPath, targetRoot, identity),
        "workspace",
        (scopeIsCurrent) => commitTabClose(tabPath, scopeIsCurrent),
      );
    },
    [
      appSettingsRef,
      captureDirtyCloseTargets,
      commitTabClose,
      executeDirtyClose,
      workspaceCloseSession,
      workspaceIdentityByRootRef,
    ],
  );

  return useCallback(
    (path: string) => {
      const tabPath =
        workspaceTabPathForIdentity(
          appSettingsRef.current.workspaceTabs,
          path,
          workspaceIdentityByRootRef.current,
        ) ?? path;
      const identity = workspaceIdentityForPaths(workspaceIdentityByRootRef.current, [
        tabPath,
        path,
      ]);
      const keys = workspaceCloseKeys(tabPath, identity);
      const existing = keys.map((key) => inFlightRef.current.get(key)).find(Boolean);
      if (existing) return existing.then(() => undefined);

      const cleanupRetainedState = prepareRetainedStateCleanup(path, identity);
      const operation = closeOperation(tabPath)
        .then(() => cleanupRetainedState())
        .finally(() => {
          for (const key of keys) {
            if (inFlightRef.current.get(key) === operation) inFlightRef.current.delete(key);
          }
        });
      for (const key of keys) inFlightRef.current.set(key, operation);
      return operation;
    },
    [appSettingsRef, closeOperation, prepareRetainedStateCleanup, workspaceIdentityByRootRef],
  );
}

export function workspaceIdentityForPaths(
  identities: Record<string, WorkspaceIdentityDescriptor>,
  paths: string[],
): WorkspaceIdentityDescriptor | null {
  for (const path of paths) {
    const exactIdentity = identities[path];
    if (exactIdentity) return exactIdentity;
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
  const exact = tabs.find((tabPath) => workspaceRootKeysEqual(tabPath, path));
  if (exact) return exact;
  const requestedIdentity = workspaceIdentityForPaths(identities, [path]);
  if (!requestedIdentity) return null;
  return (
    tabs.find(
      (tabPath) =>
        workspaceIdentityForPaths(identities, [tabPath])?.workspaceId ===
        requestedIdentity.workspaceId,
    ) ?? null
  );
}

function workspaceResourceRoots(
  tabPath: string,
  targetRootPath: string,
  identity: WorkspaceIdentityDescriptor | null,
): string[] {
  const roots = [tabPath, targetRootPath];
  if (identity) roots.push(identity.selectedPath, identity.canonicalRoot);
  return [...new Set(roots)];
}

function workspaceCloseKeys(
  tabPath: string,
  identity: WorkspaceIdentityDescriptor | null,
): string[] {
  const keys = [`root:${normalizedWorkspaceRootKey(tabPath)}`];
  if (!identity) return keys;
  keys.push(
    `workspace:${identity.workspaceId}`,
    `root:${normalizedWorkspaceRootKey(identity.selectedPath)}`,
    `root:${normalizedWorkspaceRootKey(identity.canonicalRoot)}`,
  );
  return [...new Set(keys)];
}

function workspaceTabsWithoutPath(tabs: string[], path: string): string[] {
  return tabs.filter((tabPath) => !workspaceRootKeysEqual(tabPath, path));
}

function closeSettings(
  settings: AppSettings,
  workspaceTabs: string[],
  recentWorkspacePath: string | null,
): AppSettings {
  return { ...settings, recentWorkspacePath, workspaceTabs };
}

function restoreClosedWorkspaceTab(
  current: AppSettings,
  previous: AppSettings,
  attempted: AppSettings,
  tabPath: string,
): AppSettings {
  if (current.workspaceTabs.some((path) => workspaceRootKeysEqual(path, tabPath))) return current;
  const previousIndex = workspaceTabIndexForPath(previous.workspaceTabs, tabPath);
  const workspaceTabs = [...current.workspaceTabs];
  workspaceTabs.splice(Math.min(previousIndex, workspaceTabs.length), 0, tabPath);
  const recentWorkspacePath = workspaceRootKeysEqual(
    current.recentWorkspacePath,
    attempted.recentWorkspacePath,
  )
    ? previous.recentWorkspacePath
    : current.recentWorkspacePath;
  return { ...current, recentWorkspacePath, workspaceTabs };
}

function workspaceTabIndexForPath(tabs: string[], path: string): number {
  const index = tabs.findIndex((tabPath) => workspaceRootKeysEqual(tabPath, path));
  return index < 0 ? tabs.length - 1 : index;
}

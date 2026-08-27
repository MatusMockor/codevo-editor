import type { PackageScript } from "../../domain/packageScripts";
import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
} from "../../domain/editorSessionOwnerKey";
import { clearRecentlyClosedTabs, type RecentlyClosedTabs } from "../../domain/recentlyClosedTabs";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import type { WorkspaceIdentityDescriptor } from "../workspaceIdentityGatewayPort";
import { useCallback, type MutableRefObject } from "react";
import {
  clearAllExternallyRemovedDocumentTombstones,
  clearExternallyRemovedDocumentTombstonesForRoot,
} from "./externallyRemovedDocumentTombstones";

interface PackageScriptsByRootEntry {
  readonly composerScripts: PackageScript[];
  readonly hasArtisan: boolean;
}

export interface WorkspaceTabRetainedStateCleanupDependencies {
  readonly workspaceTabs: () => readonly string[];
  readonly identities: () => Readonly<Record<string, WorkspaceIdentityDescriptor>>;
  readonly currentWorkspaceRoot: () => string | null;
  readonly runtimeRootByTab: () => Record<string, string>;
  readonly runtimeOwnerByTab: () => Record<string, WorkspaceRuntimeOwner>;
  readonly resolveCurrentRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  readonly updatePackageScripts: (
    update: (
      current: Readonly<Record<string, PackageScriptsByRootEntry>>,
    ) => Record<string, PackageScriptsByRootEntry>,
  ) => void;
  readonly forgetWorkspaceSettings: (key: string) => void;
  readonly hasPhpWorkspaceByOwner: () => Record<string, boolean>;
  readonly releaseWorkspaceTrustOwner: (ownerKey: string) => void;
  readonly recentlyClosedTabsRef: MutableRefObject<RecentlyClosedTabs>;
  readonly editorViewStatesByOwner: () => Record<string, unknown>;
}

export interface WorkspaceTabRetainedStateCleanupHookDependencies {
  readonly appSettingsRef: MutableRefObject<{ readonly workspaceTabs: readonly string[] }>;
  readonly workspaceIdentityByRootRef: MutableRefObject<
    Record<string, WorkspaceIdentityDescriptor>
  >;
  readonly currentWorkspaceRootRef: MutableRefObject<string | null>;
  readonly workspaceRuntimeRootByTabRef: MutableRefObject<Record<string, string>>;
  readonly workspaceRuntimeOwnerByTabRef: MutableRefObject<Record<string, WorkspaceRuntimeOwner>>;
  readonly resolveCurrentWorkspaceRuntimeOwner: () => WorkspaceRuntimeOwner | null;
  readonly setPackageScriptsByRoot: WorkspaceTabRetainedStateCleanupDependencies["updatePackageScripts"];
  readonly forgetWorkspaceSettings: (key: string) => void;
  readonly hasPhpWorkspaceByOwnerRef: MutableRefObject<Record<string, boolean>>;
  readonly releaseWorkspaceTrustOwner: (ownerKey: string) => void;
  readonly recentlyClosedTabsRef: MutableRefObject<RecentlyClosedTabs>;
  readonly workspaceEditorViewStatesRef: MutableRefObject<Record<string, unknown>>;
}

export function useWorkspaceTabRetainedStateCleanupPort(
  dependencies: WorkspaceTabRetainedStateCleanupHookDependencies,
): (path: string, identity: WorkspaceIdentityDescriptor | null) => () => void {
  const {
    appSettingsRef,
    workspaceIdentityByRootRef,
    currentWorkspaceRootRef,
    workspaceRuntimeRootByTabRef,
    workspaceRuntimeOwnerByTabRef,
    resolveCurrentWorkspaceRuntimeOwner,
    setPackageScriptsByRoot,
    forgetWorkspaceSettings,
    hasPhpWorkspaceByOwnerRef,
    releaseWorkspaceTrustOwner,
    recentlyClosedTabsRef,
    workspaceEditorViewStatesRef,
  } = dependencies;
  return useCallback(
    (path, identity) =>
      prepareWorkspaceTabRetainedStateCleanup(
        {
          workspaceTabs: () => appSettingsRef.current.workspaceTabs,
          identities: () => workspaceIdentityByRootRef.current,
          currentWorkspaceRoot: () => currentWorkspaceRootRef.current,
          runtimeRootByTab: () => workspaceRuntimeRootByTabRef.current,
          runtimeOwnerByTab: () => workspaceRuntimeOwnerByTabRef.current,
          resolveCurrentRuntimeOwner: resolveCurrentWorkspaceRuntimeOwner,
          updatePackageScripts: setPackageScriptsByRoot,
          forgetWorkspaceSettings,
          hasPhpWorkspaceByOwner: () => hasPhpWorkspaceByOwnerRef.current,
          releaseWorkspaceTrustOwner,
          recentlyClosedTabsRef,
          editorViewStatesByOwner: () => workspaceEditorViewStatesRef.current,
        },
        path,
        identity,
      ),
    [
      appSettingsRef,
      currentWorkspaceRootRef,
      forgetWorkspaceSettings,
      hasPhpWorkspaceByOwnerRef,
      recentlyClosedTabsRef,
      releaseWorkspaceTrustOwner,
      resolveCurrentWorkspaceRuntimeOwner,
      setPackageScriptsByRoot,
      workspaceEditorViewStatesRef,
      workspaceIdentityByRootRef,
      workspaceRuntimeOwnerByTabRef,
      workspaceRuntimeRootByTabRef,
    ],
  );
}

export function prepareWorkspaceTabRetainedStateCleanup(
  dependencies: WorkspaceTabRetainedStateCleanupDependencies,
  path: string,
  capturedIdentity?: WorkspaceIdentityDescriptor | null,
): () => void {
  const identities = dependencies.identities();
  const identity =
    capturedIdentity ??
    identities[path] ??
    Object.values(identities).find(
      (candidate) =>
        workspaceRootKeysEqual(path, candidate.selectedPath) ||
        workspaceRootKeysEqual(path, candidate.canonicalRoot),
    ) ??
    null;
  const canonicalKey = identity?.canonicalRoot ?? path;
  const resolvedTabPath = identity
    ? (dependencies
        .workspaceTabs()
        .find((tabPath) => identities[tabPath]?.workspaceId === identity.workspaceId) ??
      identity.selectedPath)
    : path;
  const runtimeRootByTab = dependencies.runtimeRootByTab();
  const runtimeOwnerByTab = dependencies.runtimeOwnerByTab();
  const runtimeRootPath = runtimeRootByTab[resolvedTabPath] ?? resolvedTabPath;
  const runtimeOwner =
    runtimeOwnerByTab[resolvedTabPath] ??
    runtimeOwnerByTab[path] ??
    (workspaceRootKeysEqual(dependencies.currentWorkspaceRoot(), path)
      ? dependencies.resolveCurrentRuntimeOwner()
      : null);

  return () => {
    const currentIdentities = dependencies.identities();
    const replacementIdentity = identity
      ? Object.values(currentIdentities).find(
          (candidate) =>
            candidate !== identity &&
            (candidate.workspaceId === identity.workspaceId ||
              workspaceRootKeysEqual(candidate.selectedPath, identity.selectedPath) ||
              workspaceRootKeysEqual(candidate.canonicalRoot, identity.canonicalRoot)),
        )
      : null;
    if (replacementIdentity) return;
    const stillOpen = dependencies
      .workspaceTabs()
      .some(
        (tabPath) =>
          workspaceRootKeysEqual(tabPath, resolvedTabPath) ||
          Boolean(identity && currentIdentities[tabPath]?.workspaceId === identity.workspaceId),
      );
    if (stillOpen) return;

    dependencies.updatePackageScripts((current) =>
      withoutClosedWorkspacePackageScripts(current, [path, resolvedTabPath, runtimeRootPath]),
    );
    dependencies.forgetWorkspaceSettings(canonicalKey);
    const currentRuntimeRoots = dependencies.runtimeRootByTab();
    for (const rootPath of [path, resolvedTabPath, runtimeRootPath]) {
      if (currentRuntimeRoots[rootPath] === runtimeRootPath) delete currentRuntimeRoots[rootPath];
    }
    const currentRuntimeOwners = dependencies.runtimeOwnerByTab();
    for (const rootPath of [path, resolvedTabPath, runtimeRootPath]) {
      if (currentRuntimeOwners[rootPath] === runtimeOwner) delete currentRuntimeOwners[rootPath];
    }
    if (runtimeOwner) {
      delete dependencies.hasPhpWorkspaceByOwner()[runtimeOwner.ownerKey];
      dependencies.releaseWorkspaceTrustOwner(runtimeOwner.ownerKey);
    }
    dependencies.recentlyClosedTabsRef.current = clearClosedWorkspaceEditorRetainedState(
      dependencies.recentlyClosedTabsRef.current,
      dependencies.editorViewStatesByOwner(),
      identity,
      resolvedTabPath,
    );
  };
}

export function ownedAndPendingWorkspaceIdentityIds(
  ownedIds: ReadonlySet<string>,
  pendingAdmissionsById: Readonly<Record<string, unknown>>,
): string[] {
  return [...new Set([...ownedIds, ...Object.keys(pendingAdmissionsById)])];
}

export function withoutClosedWorkspacePackageScripts(
  current: Readonly<Record<string, PackageScriptsByRootEntry>>,
  closedRoots: readonly string[],
): Record<string, PackageScriptsByRootEntry> {
  const next = { ...current };
  for (const rootPath of Object.keys(next)) {
    if (closedRoots.some((closedRoot) => workspaceRootKeysEqual(rootPath, closedRoot))) {
      delete next[rootPath];
    }
  }
  return next;
}

export function disposeWorkspaceFileChanges(
  gateway: WorkspaceFileChangeGateway,
  tombstonesByPath: Record<string, string>,
): void {
  clearAllExternallyRemovedDocumentTombstones(tombstonesByPath);
  try {
    void Promise.resolve(gateway.dispose?.()).catch(() => undefined);
  } catch {
    // Unmount cleanup is best-effort after authority has already been retired.
  }
}

export function releaseWorkspaceRetainedResources(
  gateway: WorkspaceFileChangeGateway,
  tombstonesByPath: Record<string, string>,
  rootPath: string,
): void {
  try {
    void Promise.resolve(gateway.releaseRoot?.(rootPath)).catch(() => undefined);
  } catch {
    // Root cleanup is best-effort; local retained state must still be cleared.
  }
  clearExternallyRemovedDocumentTombstonesForRoot(tombstonesByPath, rootPath);
}

function workspaceEditorSessionOwnerKeyForClose(
  identity: { readonly workspaceId: string; readonly canonicalRoot: string } | null,
  legacyRootPath: string,
): string {
  return identity
    ? createEditorSessionOwnerKey(identity.workspaceId, identity.canonicalRoot)
    : createLegacyEditorSessionOwnerKey(legacyRootPath);
}

export function clearClosedWorkspaceEditorRetainedState(
  recentlyClosedTabs: RecentlyClosedTabs,
  editorViewStatesByOwner: Record<string, unknown>,
  identity: { readonly workspaceId: string; readonly canonicalRoot: string } | null,
  legacyRootPath: string,
): RecentlyClosedTabs {
  const ownerKey = workspaceEditorSessionOwnerKeyForClose(identity, legacyRootPath);
  delete editorViewStatesByOwner[ownerKey];
  return clearRecentlyClosedTabs(recentlyClosedTabs, ownerKey);
}

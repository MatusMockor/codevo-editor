import type { PackageScript } from "../../domain/packageScripts";
import {
  createEditorSessionOwnerKey,
  createLegacyEditorSessionOwnerKey,
} from "../../domain/editorSessionOwnerKey";
import { clearRecentlyClosedTabs, type RecentlyClosedTabs } from "../../domain/recentlyClosedTabs";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceFileChangeGateway } from "../../domain/workspaceFileChange";
import {
  clearAllExternallyRemovedDocumentTombstones,
  clearExternallyRemovedDocumentTombstonesForRoot,
} from "./externallyRemovedDocumentTombstones";

interface PackageScriptsByRootEntry {
  readonly composerScripts: PackageScript[];
  readonly hasArtisan: boolean;
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

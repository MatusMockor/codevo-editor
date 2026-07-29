import {
  isLanguageServerActive,
  type LanguageServerRuntimeStatus,
} from "../../domain/languageServerRuntime";
import {
  cachedLanguageServerRuntimeStatusForOwner,
  cachedLanguageServerRuntimeStatusForRoot,
  type LanguageServerRuntimeStatusByOwner,
} from "../../domain/languageServerRuntimeStatusCache";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";

export function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    status.kind === "running"
  );
}

function isRunningLanguageServerSessionForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
  sessionId: number,
): status is Extract<LanguageServerRuntimeStatus, { kind: "running" }> {
  return (
    isRunningLanguageServerForWorkspace(status, statusRoot, workspaceRoot) &&
    status.sessionId === sessionId
  );
}

export function isLanguageServerSessionActiveForOwner(
  runtimeStatuses: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner,
  rootPath: string,
  sessionId: number,
): boolean {
  return isRunningLanguageServerSessionForWorkspace(
    cachedLanguageServerRuntimeStatusForOwner(runtimeStatuses, owner),
    owner.executionRoot,
    rootPath,
    sessionId,
  );
}

export function isLanguageServerSessionCurrentForOwnerOrLegacy(
  runtimeStatuses: LanguageServerRuntimeStatusByOwner,
  owner: WorkspaceRuntimeOwner | undefined,
  legacyStatus: LanguageServerRuntimeStatus | null,
  legacyStatusRoot: string | null,
  rootPath: string,
  sessionId: number,
): boolean {
  if (owner) {
    return isLanguageServerSessionActiveForOwner(runtimeStatuses, owner, rootPath, sessionId);
  }

  const cachedRuntimeStatus = cachedLanguageServerRuntimeStatusForRoot(runtimeStatuses, rootPath);
  const currentLegacyStatus =
    cachedRuntimeStatus ??
    (workspaceRootKeysEqual(legacyStatusRoot, rootPath) ? legacyStatus : null);

  return isRunningLanguageServerSessionForWorkspace(
    currentLegacyStatus,
    currentLegacyStatus?.rootPath ?? legacyStatusRoot,
    rootPath,
    sessionId,
  );
}

export function isLanguageServerActiveForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): boolean {
  return (
    isLanguageServerStatusForWorkspace(status, statusRoot, workspaceRoot) &&
    isLanguageServerActive(status)
  );
}

function isLanguageServerStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is LanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus = status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return Boolean(rootedStatus) && workspaceRootKeysEqual(rootedStatus, workspaceRoot);
}

import type { DebuggerSessionSnapshot } from "../domain/debugSessionState";
import { debuggerSessionId } from "../domain/debug";
import { initialDebuggerSnapshot } from "../domain/debugSessionState";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export function activeDebugSessionId(
  rootPath: string | null,
  snapshots: Readonly<Record<string, DebuggerSessionSnapshot>>,
): number | null {
  if (!rootPath) return null;
  const snapshot = snapshots[normalizedWorkspaceRootKey(rootPath)] ?? initialDebuggerSnapshot();
  return snapshot.state.kind === "terminated" ? null : debuggerSessionId(snapshot.state);
}

export function exactWorkspaceOwnerCurrent(
  currentRoot: string | null,
  currentWorkspaceId: string | null,
  isWorkspaceCurrent: ((rootPath: string, workspaceId: string) => boolean) | undefined,
  rootPath: string,
  requestedWorkspaceId: string | null,
): boolean {
  if (!workspaceRootKeysEqual(rootPath, currentRoot)) return false;
  if (currentWorkspaceId !== requestedWorkspaceId) return false;
  if (requestedWorkspaceId === null || !isWorkspaceCurrent) return true;
  try {
    return isWorkspaceCurrent(rootPath, requestedWorkspaceId);
  } catch {
    return false;
  }
}

export function trustedWorkspace(check: () => boolean): boolean {
  try {
    return check();
  } catch {
    return false;
  }
}

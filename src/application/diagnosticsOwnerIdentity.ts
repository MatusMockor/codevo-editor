import { languageServerUriSyncKey } from "../domain/languageServerDocumentSync";
import type { LanguageServerDiagnosticEvent } from "../domain/languageServerDiagnostics";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export type DiagnosticsChannelKind = "php" | "typescript";

export function diagnosticsOwnerKey(
  rootPath: string | null | undefined,
  owner?: WorkspaceRuntimeOwner,
): string {
  return owner?.ownerKey ?? normalizedWorkspaceRootKey(rootPath);
}

export function diagnosticsExecutionRoot(
  rootPath: string | null | undefined,
  owner?: WorkspaceRuntimeOwner,
): string | null | undefined {
  return owner?.executionRoot ?? rootPath;
}

export function diagnosticsEventForOwner(
  event: LanguageServerDiagnosticEvent,
  owner?: WorkspaceRuntimeOwner,
): LanguageServerDiagnosticEvent {
  return !owner || event.rootPath === owner.executionRoot
    ? event
    : { ...event, rootPath: owner.executionRoot };
}

export function diagnosticsUriVersionKey(
  rootPath: string,
  uri: string,
  owner?: WorkspaceRuntimeOwner,
): string {
  return owner ? `${owner.ownerKey}\u0000${uri}` : languageServerUriSyncKey(rootPath, uri);
}

export function diagnosticsOwnerLifecycleKey(
  kind: DiagnosticsChannelKind,
  ownerKey: string,
): string {
  return `${kind}:${ownerKey}`;
}

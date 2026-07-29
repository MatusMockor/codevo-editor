import type { LanguageServerRuntimeStatusByOwner } from "../../domain/languageServerRuntimeStatusCache";
import type { WorkspaceRuntimeOwner } from "../../domain/workspaceRuntimeOwner";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import type { WorkspaceSettings } from "../../domain/settings";
import type { DocumentSavePipelineOwnerContext } from "../useDocumentSavePipeline";

export function ownerDocumentSavePipelineContextFor(
  owner: WorkspaceRuntimeOwner,
  settings: WorkspaceSettings,
  hasPhpWorkspaceByOwner: Readonly<Record<string, boolean>>,
  phpRuntimeStatusByOwner: LanguageServerRuntimeStatusByOwner,
  javaScriptTypeScriptRuntimeStatusByOwner: LanguageServerRuntimeStatusByOwner,
  synchronizedOwner: WorkspaceRuntimeOwner | null = null,
): DocumentSavePipelineOwnerContext {
  const phpRuntimeStatus = phpRuntimeStatusByOwner[owner.ownerKey] ?? null;
  const javaScriptTypeScriptRuntimeStatus =
    javaScriptTypeScriptRuntimeStatusByOwner[owner.ownerKey] ?? null;

  return {
    canUseLanguageServerDocument:
      synchronizedOwner?.ownerKey === owner.ownerKey &&
      workspaceRootKeysEqual(synchronizedOwner.executionRoot, owner.executionRoot),
    hasPhpWorkspace: hasPhpWorkspaceByOwner[owner.ownerKey] === true,
    javaScriptTypeScriptRuntimeStatus,
    javaScriptTypeScriptRuntimeStatusRoot:
      javaScriptTypeScriptRuntimeStatus?.rootPath ?? owner.executionRoot,
    owner,
    phpRuntimeStatus,
    phpRuntimeStatusRoot: phpRuntimeStatus?.rootPath ?? owner.executionRoot,
    settings,
  };
}

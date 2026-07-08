import {
  canUseLanguageServerFeature,
  type LanguageServerFeature,
} from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export type RunningLanguageServerRuntimeStatus = Extract<
  LanguageServerRuntimeStatus,
  { kind: "running" }
>;

export interface ActiveDocumentLanguage {
  isJavaScriptTypeScriptLanguageServerDocument: boolean;
  isLanguageServerDocument: boolean;
  language: string | null | undefined;
}

export interface ActiveDocumentLanguageServerFeatureOptions {
  activeDocument: ActiveDocumentLanguage | null;
  feature: LanguageServerFeature;
  javaScriptTypeScriptLanguageServerRuntimeStatus:
    | LanguageServerRuntimeStatus
    | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  workspaceRoot: string | null;
}

export function canUseActiveDocumentLanguageServerFeature({
  activeDocument,
  feature,
  javaScriptTypeScriptLanguageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  languageServerRuntimeStatus,
  languageServerRuntimeStatusRoot,
  workspaceRoot,
}: ActiveDocumentLanguageServerFeatureOptions): boolean {
  if (!activeDocument) {
    return false;
  }

  if (activeDocument.isJavaScriptTypeScriptLanguageServerDocument) {
    return languageServerRuntimeSupportsFeatureForWorkspace(
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      workspaceRoot,
      feature,
    );
  }

  if (!activeDocument.isLanguageServerDocument) {
    return false;
  }

  return languageServerRuntimeSupportsFeatureForWorkspace(
    languageServerRuntimeStatus,
    languageServerRuntimeStatusRoot,
    workspaceRoot,
    feature,
  );
}

export function isRunningLanguageServerForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
): status is RunningLanguageServerRuntimeStatus {
  if (!workspaceRoot || !status) {
    return false;
  }

  const rootedStatus =
    status.rootPath ?? (status.kind === "stopped" ? statusRoot : null);

  return (
    status.kind === "running" &&
    Boolean(rootedStatus) &&
    workspaceRootKeysEqual(rootedStatus, workspaceRoot)
  );
}

function languageServerRuntimeSupportsFeatureForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string | null | undefined,
  feature: LanguageServerFeature,
): status is RunningLanguageServerRuntimeStatus {
  return (
    isRunningLanguageServerForWorkspace(status, statusRoot, workspaceRoot) &&
    canUseLanguageServerFeature(status.capabilities, feature)
  );
}

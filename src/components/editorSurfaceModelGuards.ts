import type * as Monaco from "monaco-editor";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import {
  normalizeLargeSmartDocumentPolicy,
  type LargeSmartDocumentPolicy,
} from "../domain/largeDocumentPolicy";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export function isLargeSmartModel(
  model: Monaco.editor.ITextModel,
  policy: LargeSmartDocumentPolicy,
): boolean {
  if (typeof model.getValueLength !== "function" || typeof model.getLineCount !== "function") {
    return false;
  }
  const normalizedPolicy = normalizeLargeSmartDocumentPolicy(policy);
  return (
    model.getValueLength() > normalizedPolicy.characterLimit ||
    model.getLineCount() > normalizedPolicy.lineLimit
  );
}

export function isJavaScriptTypeScriptRuntimeActiveForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  workspaceRoot: string | null,
): boolean {
  return (
    status?.kind === "running" &&
    Boolean(workspaceRoot) &&
    Boolean(status.rootPath) &&
    workspaceRootKeysEqual(status.rootPath, workspaceRoot)
  );
}

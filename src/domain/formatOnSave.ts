import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "./languageServerDocumentSync";
import {
  canUseLanguageServerFeature,
  type LanguageServerFormattingOptions,
} from "./languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "./languageServerRuntime";
import type { EditorDocument } from "./workspace";
import { workspaceRootKeysEqual } from "./workspaceRootKey";

export type FormatOnSaveProvider = "javaScriptTypeScript" | "php";

export interface FormatOnSaveRuntime {
  status: LanguageServerRuntimeStatus | null;
  statusRoot: string | null;
}

export interface FormatOnSavePlanInput {
  document: EditorDocument;
  hasPhpWorkspace: boolean;
  javaScriptTypeScript: FormatOnSaveRuntime;
  php: FormatOnSaveRuntime;
  workspaceRoot: string;
}

export interface FormatOnSavePlan {
  provider: FormatOnSaveProvider;
  sessionId: number;
}

export function defaultFormatOnSaveOptions(): LanguageServerFormattingOptions {
  return {
    insertSpaces: true,
    tabSize: 2,
  };
}

export function planFormatOnSave(
  input: FormatOnSavePlanInput,
): FormatOnSavePlan | null {
  if (isJavaScriptTypeScriptLanguageServerDocument(input.document)) {
    return formatPlanForRuntime(
      "javaScriptTypeScript",
      input.javaScriptTypeScript,
      input.workspaceRoot,
    );
  }

  if (isLanguageServerDocument(input.document) && input.hasPhpWorkspace) {
    return formatPlanForRuntime("php", input.php, input.workspaceRoot);
  }

  return null;
}

function formatPlanForRuntime(
  provider: FormatOnSaveProvider,
  runtime: FormatOnSaveRuntime,
  workspaceRoot: string,
): FormatOnSavePlan | null {
  const status = runningStatusForWorkspace(
    runtime.status,
    runtime.statusRoot,
    workspaceRoot,
  );

  if (!status) {
    return null;
  }

  if (!canUseLanguageServerFeature(status.capabilities, "formatting")) {
    return null;
  }

  return { provider, sessionId: status.sessionId };
}

function runningStatusForWorkspace(
  status: LanguageServerRuntimeStatus | null,
  statusRoot: string | null,
  workspaceRoot: string,
): Extract<LanguageServerRuntimeStatus, { kind: "running" }> | null {
  if (!status || status.kind !== "running") {
    return null;
  }

  const effectiveRoot = status.rootPath ?? statusRoot;

  if (!effectiveRoot) {
    return null;
  }

  if (!workspaceRootKeysEqual(effectiveRoot, workspaceRoot)) {
    return null;
  }

  return status;
}

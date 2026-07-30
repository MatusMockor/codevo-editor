import { useEffect } from "react";
import type * as Monaco from "monaco-editor";
import type { CommandExecutionRunner } from "../../application/commandRegistry";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import type { LanguageServerRuntimeStatus } from "../../domain/languageServerRuntime";
import type { EditorDocument } from "../../domain/workspace";
import { javaScriptTypeScriptDefinitionGesture } from "../javascriptTypescriptMonacoProviderRegistration";
import { isJavaScriptTypeScriptRuntimeActiveForWorkspace } from "../editorSurfaceModelGuards";

interface EditorDefinitionNavigationMode {
  readonly customNavigationEnabled: boolean;
  readonly managedDocumentActive: boolean;
  readonly managedRuntimeActive: boolean;
}

export function useEditorDefinitionNavigation({
  activeDocument,
  editor,
  runtimeStatus,
  workspaceRoot,
}: {
  readonly activeDocument: EditorDocument | null;
  readonly editor: Monaco.editor.IStandaloneCodeEditor | null;
  readonly runtimeStatus: LanguageServerRuntimeStatus | null;
  readonly workspaceRoot: string | null;
}): EditorDefinitionNavigationMode {
  const managedRuntimeActive = isJavaScriptTypeScriptRuntimeActiveForWorkspace(
    runtimeStatus,
    workspaceRoot,
  );
  const javaScriptTypeScriptDocumentActive = Boolean(
    activeDocument && isJavaScriptTypeScriptLanguageServerDocument(activeDocument),
  );
  const customNavigationEnabled = Boolean(
    activeDocument && (!javaScriptTypeScriptDocumentActive || managedRuntimeActive),
  );

  useEffect(() => {
    if (!customNavigationEnabled) {
      return;
    }

    const gesture = javaScriptTypeScriptDefinitionGesture(editor);
    if (typeof gesture?.gotoDefinition !== "function") {
      return;
    }

    const original = gesture.gotoDefinition;
    const disabled = () => Promise.resolve();
    gesture.gotoDefinition = disabled;

    return () => {
      if (gesture.gotoDefinition === disabled) {
        gesture.gotoDefinition = original;
      }
    };
  }, [customNavigationEnabled, editor]);

  return {
    customNavigationEnabled,
    managedDocumentActive: javaScriptTypeScriptDocumentActive && managedRuntimeActive,
    managedRuntimeActive,
  };
}

export function configuredF12NeedsNativeDefinition({
  commandIds,
  customNavigationEnabled,
  runCommand,
}: {
  readonly commandIds: readonly string[];
  readonly customNavigationEnabled: boolean;
  readonly runCommand: CommandExecutionRunner | undefined;
}): boolean {
  if (runCommand) {
    for (const commandId of commandIds) {
      if (runCommand(commandId) === "executed") {
        return false;
      }
    }
  }

  return !customNavigationEnabled && commandIds.includes("editor.goToDefinition");
}

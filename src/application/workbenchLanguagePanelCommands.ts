import type { KeymapCommandId } from "../domain/keymap";
import type { LanguageServerFeature } from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { Command } from "./commandRegistry";
import {
  canUseActiveDocumentLanguageServerFeature,
  type ActiveDocumentLanguage,
} from "./workbenchLanguageServerCommandEnablement";

interface WorkbenchLanguagePanelCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  activeDocument: ActiveDocumentLanguage | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus:
    | LanguageServerRuntimeStatus
    | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  workspaceRoot: string | null;
  openFileStructure: Command["run"];
  openCallHierarchy: Command["run"];
  openTypeHierarchy: Command["run"];
  openReferencesPanel: Command["run"];
  openFileReferencesPanel: Command["run"];
}

export function workbenchLanguagePanelCommands({
  shortcut,
  activeDocument,
  languageServerRuntimeStatus,
  languageServerRuntimeStatusRoot,
  javaScriptTypeScriptLanguageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  workspaceRoot,
  openFileStructure,
  openCallHierarchy,
  openTypeHierarchy,
  openReferencesPanel,
  openFileReferencesPanel,
}: WorkbenchLanguagePanelCommandsOptions): Command[] {
  const canUseFeature = (feature: LanguageServerFeature) =>
    canUseActiveDocumentLanguageServerFeature({
      activeDocument,
      feature,
      javaScriptTypeScriptLanguageServerRuntimeStatus,
      javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
      languageServerRuntimeStatus,
      languageServerRuntimeStatusRoot,
      workspaceRoot,
    });

  return [
    {
      id: "editor.fileStructure",
      title: "File Structure",
      category: "Editor",
      shortcut: shortcut("editor.fileStructure"),
      isEnabled: () => canOpenFileStructure(activeDocument, canUseFeature),
      run: openFileStructure,
    },
    {
      id: "editor.showCallHierarchy",
      title: "Show Call Hierarchy",
      category: "Editor",
      isEnabled: () => canUseFeature("callHierarchy"),
      run: openCallHierarchy,
    },
    {
      id: "editor.showTypeHierarchy",
      title: "Show Type Hierarchy",
      category: "Editor",
      isEnabled: () => canUseFeature("typeHierarchy"),
      run: openTypeHierarchy,
    },
    {
      id: "editor.findReferences",
      title: "Find All References",
      category: "Editor",
      shortcut: shortcut("editor.findReferences"),
      isEnabled: () => Boolean(activeDocument),
      run: openReferencesPanel,
    },
    {
      id: "editor.findFileReferences",
      title: "Find File References",
      category: "Editor",
      shortcut: shortcut("editor.findFileReferences"),
      isEnabled: () => Boolean(activeDocument),
      run: openFileReferencesPanel,
    },
  ];
}

function canOpenFileStructure(
  activeDocument: ActiveDocumentLanguage | null,
  canUseFeature: (feature: LanguageServerFeature) => boolean,
): boolean {
  if (!activeDocument) {
    return false;
  }

  if (activeDocument.isJavaScriptTypeScriptLanguageServerDocument) {
    return canUseFeature("documentSymbol");
  }

  return activeDocument.isLanguageServerDocument;
}

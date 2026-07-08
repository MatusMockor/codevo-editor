import type { KeymapCommandId } from "../domain/keymap";
import type { LanguageServerFeature } from "../domain/languageServerFeatures";
import type { LanguageServerRuntimeStatus } from "../domain/languageServerRuntime";
import type { Command } from "./commandRegistry";
import {
  canUseActiveDocumentLanguageServerFeature,
  type ActiveDocumentLanguage,
} from "./workbenchLanguageServerCommandEnablement";

type NavigationRun = () => unknown;

interface WorkbenchLanguageNavigationCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  activeDocument: ActiveDocumentLanguage | null;
  languageServerRuntimeStatus: LanguageServerRuntimeStatus | null;
  languageServerRuntimeStatusRoot: string | null;
  javaScriptTypeScriptLanguageServerRuntimeStatus:
    | LanguageServerRuntimeStatus
    | null;
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot: string | null;
  workspaceRoot: string | null;
  goToDefinition: NavigationRun;
  goToSourceDefinition: NavigationRun;
  goToDeclaration: NavigationRun;
  goToTypeDefinition: NavigationRun;
  goToImplementation: NavigationRun;
  goToSuperMethod: NavigationRun;
}

export function workbenchLanguageNavigationCommands({
  shortcut,
  activeDocument,
  languageServerRuntimeStatus,
  languageServerRuntimeStatusRoot,
  javaScriptTypeScriptLanguageServerRuntimeStatus,
  javaScriptTypeScriptLanguageServerRuntimeStatusRoot,
  workspaceRoot,
  goToDefinition,
  goToSourceDefinition,
  goToDeclaration,
  goToTypeDefinition,
  goToImplementation,
  goToSuperMethod,
}: WorkbenchLanguageNavigationCommandsOptions): Command[] {
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
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToDefinition"),
      isEnabled: () => Boolean(activeDocument),
      run: fireAndForget(goToDefinition),
    },
    {
      id: "editor.goToSourceDefinition",
      title: "Go to Source Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToSourceDefinition"),
      isEnabled: () =>
        Boolean(
          activeDocument?.isJavaScriptTypeScriptLanguageServerDocument &&
            canUseFeature("sourceDefinition"),
        ),
      run: fireAndForget(goToSourceDefinition),
    },
    {
      id: "editor.goToDeclaration",
      title: "Go to Declaration",
      category: "Editor",
      shortcut: shortcut("editor.goToDeclaration"),
      isEnabled: () => canUseFeature("declaration"),
      run: fireAndForget(goToDeclaration),
    },
    {
      id: "editor.goToTypeDefinition",
      title: "Go to Type Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToTypeDefinition"),
      isEnabled: () => canUseFeature("typeDefinition"),
      run: fireAndForget(goToTypeDefinition),
    },
    {
      id: "editor.goToImplementation",
      title: "Go to Implementation",
      category: "Editor",
      shortcut: shortcut("editor.goToImplementation"),
      isEnabled: () => canUseFeature("implementation"),
      run: fireAndForget(goToImplementation),
    },
    {
      id: "editor.goToSuperMethod",
      title: "Go to Super Method",
      category: "Editor",
      shortcut: shortcut("editor.goToSuperMethod"),
      isEnabled: () => activeDocument?.language === "php",
      run: fireAndForget(goToSuperMethod),
    },
  ];
}

function fireAndForget(run: NavigationRun): Command["run"] {
  return () => {
    void run();
  };
}

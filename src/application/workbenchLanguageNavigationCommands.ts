import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";
import type { ActiveDocumentLanguage } from "./workbenchLanguageServerCommandEnablement";

type NavigationRun = () => unknown;

interface WorkbenchLanguageNavigationCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  activeDocument: ActiveDocumentLanguage | null;
  goToDefinition: NavigationRun;
  goToSourceDefinition: NavigationRun;
  goToDeclaration: NavigationRun;
  goToTypeDefinition: NavigationRun;
  goToImplementation: NavigationRun;
  goToSuperMethod: NavigationRun;
}

export function workbenchLanguageNavigationCommands({
  shortcut,
  goToDefinition,
  goToSourceDefinition,
  goToDeclaration,
  goToTypeDefinition,
  goToImplementation,
  goToSuperMethod,
}: WorkbenchLanguageNavigationCommandsOptions): Command[] {
  const canAttemptNavigation: Command["isEnabled"] = (context) =>
    context.hasActiveDocument;

  return [
    {
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToDefinition"),
      isEnabled: canAttemptNavigation,
      run: fireAndForget(goToDefinition),
    },
    {
      id: "editor.goToSourceDefinition",
      title: "Go to Source Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToSourceDefinition"),
      isEnabled: canAttemptNavigation,
      run: fireAndForget(goToSourceDefinition),
    },
    {
      id: "editor.goToDeclaration",
      title: "Go to Declaration",
      category: "Editor",
      shortcut: shortcut("editor.goToDeclaration"),
      isEnabled: canAttemptNavigation,
      run: fireAndForget(goToDeclaration),
    },
    {
      id: "editor.goToTypeDefinition",
      title: "Go to Type Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToTypeDefinition"),
      isEnabled: canAttemptNavigation,
      run: fireAndForget(goToTypeDefinition),
    },
    {
      id: "editor.goToImplementation",
      title: "Go to Implementation",
      category: "Editor",
      shortcut: shortcut("editor.goToImplementation"),
      isEnabled: canAttemptNavigation,
      run: fireAndForget(goToImplementation),
    },
    {
      id: "editor.goToSuperMethod",
      title: "Go to Super Method",
      category: "Editor",
      shortcut: shortcut("editor.goToSuperMethod"),
      isEnabled: canAttemptNavigation,
      run: fireAndForget(goToSuperMethod),
    },
  ];
}

function fireAndForget(run: NavigationRun): Command["run"] {
  return () => {
    void run();
  };
}

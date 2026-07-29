import type { KeymapCommandId } from "../domain/keymap";
import type { LanguageServerFeature } from "../domain/languageServerFeatures";
import type { Command } from "./commandRegistry";
import {
  javaScriptTypeScriptCommandSupports,
  type JavaScriptTypeScriptFeatureAvailability,
} from "./workbenchLanguageServerCommandEnablement";

type NavigationRun = () => unknown;

interface WorkbenchLanguageNavigationCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  javaScriptTypeScriptFeatureAvailability: JavaScriptTypeScriptFeatureAvailability;
  goToDefinition: NavigationRun;
  goToSourceDefinition: NavigationRun;
  goToDeclaration: NavigationRun;
  goToTypeDefinition: NavigationRun;
  goToImplementation: NavigationRun;
  goToSuperMethod: NavigationRun;
}

export function workbenchLanguageNavigationCommands({
  shortcut,
  javaScriptTypeScriptFeatureAvailability,
  goToDefinition,
  goToSourceDefinition,
  goToDeclaration,
  goToTypeDefinition,
  goToImplementation,
  goToSuperMethod,
}: WorkbenchLanguageNavigationCommandsOptions): Command[] {
  const canAttemptNavigation =
    (feature?: LanguageServerFeature): Command["isEnabled"] =>
    (context) =>
      context.hasActiveDocument &&
      (feature === undefined ||
        javaScriptTypeScriptCommandSupports(javaScriptTypeScriptFeatureAvailability, feature));

  return [
    {
      id: "editor.goToDefinition",
      title: "Go to Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToDefinition"),
      isEnabled: canAttemptNavigation("definition"),
      run: awaitNavigation(goToDefinition),
    },
    {
      id: "editor.goToSourceDefinition",
      title: "Go to Source Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToSourceDefinition"),
      isEnabled: canAttemptNavigation("sourceDefinition"),
      run: awaitNavigation(goToSourceDefinition),
    },
    {
      id: "editor.goToDeclaration",
      title: "Go to Declaration",
      category: "Editor",
      shortcut: shortcut("editor.goToDeclaration"),
      isEnabled: canAttemptNavigation("declaration"),
      run: awaitNavigation(goToDeclaration),
    },
    {
      id: "editor.goToTypeDefinition",
      title: "Go to Type Definition",
      category: "Editor",
      shortcut: shortcut("editor.goToTypeDefinition"),
      isEnabled: canAttemptNavigation("typeDefinition"),
      run: awaitNavigation(goToTypeDefinition),
    },
    {
      id: "editor.goToImplementation",
      title: "Go to Implementation",
      category: "Editor",
      shortcut: shortcut("editor.goToImplementation"),
      isEnabled: canAttemptNavigation("implementation"),
      run: awaitNavigation(goToImplementation),
    },
    {
      id: "editor.goToSuperMethod",
      title: "Go to Super Method",
      category: "Editor",
      shortcut: shortcut("editor.goToSuperMethod"),
      isEnabled: canAttemptNavigation(),
      run: awaitNavigation(goToSuperMethod),
    },
  ];
}

function awaitNavigation(run: NavigationRun): Command["run"] {
  return async () => {
    await run();
  };
}

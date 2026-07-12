import type { ArtisanControllerAction } from "../domain/artisanRoutes";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  bestIndexedSymbolMatch,
  editorPositionFromProjectSymbol,
} from "./projectSymbolNavigation";

export interface ArtisanRouteNavigationDependencies {
  activePath: string;
  currentRootPath(): string | null;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
  ): Promise<boolean>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  rootPath: string | null;
  setMessage(message: string): void;
}

export async function navigateToArtisanController(
  dependencies: ArtisanRouteNavigationDependencies,
  action: ArtisanControllerAction,
): Promise<boolean> {
  const {
    activePath,
    currentRootPath,
    openNavigationTarget,
    projectSymbolSearch,
    rootPath,
    setMessage,
  } = dependencies;

  if (!rootPath) {
    return false;
  }

  const symbols = await projectSymbolSearch.searchProjectSymbols(
    rootPath,
    action.methodName,
    50,
  );

  if (!workspaceRootKeysEqual(currentRootPath(), rootPath)) {
    return false;
  }

  const classMethods = symbols.filter(
    (symbol) =>
      symbol.kind === "method" &&
      symbol.containerName?.toLowerCase() === action.className.toLowerCase(),
  );
  const target = bestIndexedSymbolMatch(
    classMethods,
    action.methodName,
    activePath,
  );

  if (!target) {
    setMessage(
      `Route target ${action.className}@${action.methodName} was not indexed.`,
    );
    return false;
  }

  return openNavigationTarget(
    target.path,
    editorPositionFromProjectSymbol(target),
    `${action.methodName}()`,
  );
}

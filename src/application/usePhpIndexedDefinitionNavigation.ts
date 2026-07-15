import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import type { EditorDocument, IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import { resolvePhpIdentifierContextAt } from "./phpFrameworkIdentifierContextResolverRegistry";
import {
  bestIndexedSymbolMatch,
  editorPositionFromProjectSymbol,
} from "./projectSymbolNavigation";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
  request?: NavigationRequest,
) => Promise<boolean>;

type PhpFrameworkIdentifierDefinitionHandler = (
  context: PhpIdentifierContext,
  request?: NavigationRequest,
) => Promise<boolean>;

type PhpClassIdentifierDefinitionHandler = (
  name: string,
  request?: NavigationRequest,
) => Promise<boolean>;

export interface PhpIndexedDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  goToPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
  goToPhpClassConstantDefinition: PhpContextHandler<"classConstant">;
  goToPhpClassIdentifierDefinition: PhpClassIdentifierDefinitionHandler;
  goToPhpMethodCallDefinition: PhpContextHandler<"methodCall">;
  goToPhpStaticMethodCallDefinition: PhpContextHandler<"staticMethodCall">;
  identifierAtEditorPosition(
    source: string,
    position: EditorPosition,
  ): string | null;
  intelligenceMode: IntelligenceMode;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: { shouldCommit?: () => boolean },
  ): Promise<boolean>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  providers: readonly PhpFrameworkProvider[];
  reportErrorForActiveWorkspaceRoot(
    rootPath: string,
    title: string,
    error: unknown,
  ): void;
  setMessage(message: string | null): void;
  workspaceRoot: string | null;
}

export interface PhpIndexedDefinitionNavigation {
  goToIndexedSymbolDefinition(request?: NavigationRequest): Promise<boolean>;
}

async function invokeNavigationHandler<Argument>(
  handler: (argument: Argument, request?: NavigationRequest) => Promise<boolean>,
  argument: Argument,
  request: NavigationRequest | undefined,
  isNavigationActive: () => boolean,
): Promise<boolean> {
  const handled = request
    ? await handler(argument, request)
    : await handler(argument);

  if (!isNavigationActive()) {
    return false;
  }

  return handled;
}

export function usePhpIndexedDefinitionNavigation({
  activeDocument,
  activeEditorPositionRef,
  currentWorkspaceRootRef,
  goToPhpFrameworkIdentifierDefinition,
  goToPhpClassConstantDefinition,
  goToPhpClassIdentifierDefinition,
  goToPhpMethodCallDefinition,
  goToPhpStaticMethodCallDefinition,
  identifierAtEditorPosition,
  intelligenceMode,
  openNavigationTarget,
  projectSymbolSearch,
  providers,
  reportErrorForActiveWorkspaceRoot,
  setMessage,
  workspaceRoot,
}: PhpIndexedDefinitionNavigationDependencies): PhpIndexedDefinitionNavigation {
  const goToIndexedSymbolDefinition = useCallback(async (
    request?: NavigationRequest,
  ): Promise<boolean> => {
    if (!activeDocument || !workspaceRoot) {
      return false;
    }

    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
    const isNavigationActive = () =>
      isRequestedRootActive() && canNavigate(request);

    if (!isNavigationActive()) {
      return false;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const symbolName = identifierAtEditorPosition(
      activeDocument.content,
      editorPosition,
    );

    if (!symbolName) {
      return false;
    }

    const openIndexedSymbolByName = async (query: string): Promise<boolean> => {
      if (!shouldIndexWorkspace(intelligenceMode)) {
        if (!isNavigationActive()) {
          return false;
        }

        setMessage("Enable Smart Index or IDE Mode to search indexed symbols.");
        return false;
      }

      const symbols = await projectSymbolSearch.searchProjectSymbols(
        requestedRoot,
        query,
        25,
      );

      if (!isNavigationActive()) {
        return false;
      }

      const target = bestIndexedSymbolMatch(
        symbols,
        query,
        activeDocument.path,
      );

      if (!target) {
        if (!isNavigationActive()) {
          return false;
        }

        setMessage(`No indexed symbol found for ${query}.`);
        return false;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const opened = await openNavigationTarget(
        target.path,
        editorPositionFromProjectSymbol(target),
        target.name,
        { shouldCommit: isNavigationActive },
      );

      if (!isNavigationActive()) {
        return false;
      }

      return opened;
    };

    try {
      if (activeDocument.language !== "php") {
        const openedIndexedTarget = await openIndexedSymbolByName(symbolName);

        if (!isNavigationActive()) {
          return false;
        }

        return openedIndexedTarget;
      }

      const context = resolvePhpIdentifierContextAt(
        activeDocument.content,
        editorPosition,
        providers,
      );

      if (!context) {
        return false;
      }

      if (context.kind === "methodCall") {
        const handled = await invokeNavigationHandler(
          goToPhpMethodCallDefinition,
          context,
          request,
          isNavigationActive,
        );

        if (!isNavigationActive()) {
          return false;
        }

        return handled;
      }

      if (context.kind === "staticMethodCall") {
        const handled = await invokeNavigationHandler(
          goToPhpStaticMethodCallDefinition,
          context,
          request,
          isNavigationActive,
        );

        if (!isNavigationActive()) {
          return false;
        }

        return handled;
      }

      if (context.kind === "classConstant") {
        const handled = await invokeNavigationHandler(
          goToPhpClassConstantDefinition,
          context,
          request,
          isNavigationActive,
        );

        if (!isNavigationActive()) {
          return false;
        }

        return handled;
      }

      const openedFrameworkTarget = await invokeNavigationHandler(
        goToPhpFrameworkIdentifierDefinition,
        context,
        request,
        isNavigationActive,
      );

      if (!isNavigationActive()) {
        return false;
      }

      if (openedFrameworkTarget) {
        return true;
      }

      if (!isNavigationActive()) {
        return false;
      }

      if (context.kind !== "classIdentifier") {
        return false;
      }

      const openedClassTarget = await invokeNavigationHandler(
        goToPhpClassIdentifierDefinition,
        context.name,
        request,
        isNavigationActive,
      );

      if (!isNavigationActive()) {
        return false;
      }

      if (openedClassTarget) {
        return true;
      }

      if (!isNavigationActive()) {
        return false;
      }

      const openedIndexedTarget = await openIndexedSymbolByName(context.name);

      if (!isNavigationActive()) {
        return false;
      }

      return openedIndexedTarget;
    } catch (error) {
      if (!isNavigationActive()) {
        return false;
      }

      reportErrorForActiveWorkspaceRoot(
        requestedRoot,
        "Go to Definition",
        error,
      );
      return false;
    }
  }, [
    activeDocument,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    goToPhpClassConstantDefinition,
    goToPhpClassIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    identifierAtEditorPosition,
    intelligenceMode,
    openNavigationTarget,
    projectSymbolSearch,
    providers,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
  ]);

  return { goToIndexedSymbolDefinition };
}

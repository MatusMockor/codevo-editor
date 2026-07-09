import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpIdentifierContextAt,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import type { EditorDocument, IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import {
  type PhpFrameworkIdentifierDefinitionHandler,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import {
  bestIndexedSymbolMatch,
  editorPositionFromProjectSymbol,
} from "./projectSymbolNavigation";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
) => Promise<boolean>;

export interface PhpIndexedDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  goToPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
  goToPhpClassConstantDefinition: PhpContextHandler<"classConstant">;
  goToPhpClassIdentifierDefinition(name: string): Promise<boolean>;
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
  ): Promise<boolean>;
  projectSymbolSearch: ProjectSymbolSearchGateway;
  reportErrorForActiveWorkspaceRoot(
    rootPath: string,
    title: string,
    error: unknown,
  ): void;
  setMessage(message: string | null): void;
  workspaceRoot: string | null;
}

export interface PhpIndexedDefinitionNavigation {
  goToIndexedSymbolDefinition(): Promise<boolean>;
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
  reportErrorForActiveWorkspaceRoot,
  setMessage,
  workspaceRoot,
}: PhpIndexedDefinitionNavigationDependencies): PhpIndexedDefinitionNavigation {
  const goToIndexedSymbolDefinition = useCallback(async (): Promise<boolean> => {
    if (!activeDocument || !workspaceRoot) {
      return false;
    }

    const requestedRoot = workspaceRoot;
    const isRequestedRootActive = () =>
      workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);
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
        setMessage("Enable Smart Index or IDE Mode to search indexed symbols.");
        return false;
      }

      const symbols = await projectSymbolSearch.searchProjectSymbols(
        requestedRoot,
        query,
        25,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      const target = bestIndexedSymbolMatch(
        symbols,
        query,
        activeDocument.path,
      );

      if (!target) {
        setMessage(`No indexed symbol found for ${query}.`);
        return false;
      }

      return openNavigationTarget(
        target.path,
        editorPositionFromProjectSymbol(target),
        target.name,
      );
    };

    try {
      if (activeDocument.language !== "php") {
        return await openIndexedSymbolByName(symbolName);
      }

      const context = phpIdentifierContextAt(
        activeDocument.content,
        editorPosition,
      );

      if (!context) {
        return false;
      }

      if (context.kind === "methodCall") {
        return goToPhpMethodCallDefinition(context);
      }

      if (context.kind === "staticMethodCall") {
        return goToPhpStaticMethodCallDefinition(context);
      }

      if (context.kind === "classConstant") {
        return goToPhpClassConstantDefinition(context);
      }

      const openedFrameworkTarget =
        await goToPhpFrameworkIdentifierDefinition(context);

      if (!isRequestedRootActive()) {
        return false;
      }

      if (openedFrameworkTarget) {
        return true;
      }

      if (context.kind !== "classIdentifier") {
        return false;
      }

      const openedClassTarget = await goToPhpClassIdentifierDefinition(
        context.name,
      );

      if (!isRequestedRootActive()) {
        return false;
      }

      if (openedClassTarget) {
        return true;
      }

      return await openIndexedSymbolByName(context.name);
    } catch (error) {
      if (!isRequestedRootActive()) {
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
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
  ]);

  return { goToIndexedSymbolDefinition };
}

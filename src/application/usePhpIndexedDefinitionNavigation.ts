import { useCallback, type MutableRefObject } from "react";
import { shouldIndexWorkspace } from "../domain/intelligence";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpIdentifierContextAt,
  resolvePhpClassName,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import type { EditorDocument, IntelligenceMode } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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
  goToPhpClassConstantDefinition: PhpContextHandler<"classConstant">;
  goToPhpClassIdentifierDefinition(name: string): Promise<boolean>;
  goToPhpLaravelAuthGuardDefinition: PhpContextHandler<"laravelAuthGuardString">;
  goToPhpLaravelBroadcastConnectionDefinition: PhpContextHandler<"laravelBroadcastConnectionString">;
  goToPhpLaravelCacheStoreDefinition: PhpContextHandler<"laravelCacheStoreString">;
  goToPhpLaravelConfigDefinition: PhpContextHandler<"laravelConfigString">;
  goToPhpLaravelDatabaseConnectionDefinition: PhpContextHandler<"laravelDatabaseConnectionString">;
  goToPhpLaravelEnvDefinition: PhpContextHandler<"laravelEnvString">;
  goToPhpLaravelGateAbilityDefinition: PhpContextHandler<"laravelGateAbilityString">;
  goToPhpLaravelLogChannelDefinition: PhpContextHandler<"laravelLogChannelString">;
  goToPhpLaravelMailMailerDefinition: PhpContextHandler<"laravelMailMailerString">;
  goToPhpLaravelMiddlewareAliasDefinition: PhpContextHandler<"laravelMiddlewareAliasString">;
  goToPhpLaravelNamedRouteDefinition: PhpContextHandler<"laravelNamedRouteString">;
  goToPhpLaravelPasswordBrokerDefinition: PhpContextHandler<"laravelPasswordBrokerString">;
  goToPhpLaravelQueueConnectionDefinition: PhpContextHandler<"laravelQueueConnectionString">;
  goToPhpLaravelRedisConnectionDefinition: PhpContextHandler<"laravelRedisConnectionString">;
  goToPhpLaravelRelationStringDefinition: PhpContextHandler<"laravelRelationString">;
  goToPhpLaravelStorageDiskDefinition: PhpContextHandler<"laravelStorageDiskString">;
  goToPhpLaravelTranslationDefinition: PhpContextHandler<"laravelTranslationString">;
  goToPhpLaravelViewDefinition: PhpContextHandler<"laravelViewString">;
  goToPhpMethodCallDefinition: PhpContextHandler<"methodCall">;
  goToPhpStaticMethodCallDefinition: PhpContextHandler<"staticMethodCall">;
  identifierAtEditorPosition(
    source: string,
    position: EditorPosition,
  ): string | null;
  intelligenceMode: IntelligenceMode;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
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
  goToPhpClassConstantDefinition,
  goToPhpClassIdentifierDefinition,
  goToPhpLaravelAuthGuardDefinition,
  goToPhpLaravelBroadcastConnectionDefinition,
  goToPhpLaravelCacheStoreDefinition,
  goToPhpLaravelConfigDefinition,
  goToPhpLaravelDatabaseConnectionDefinition,
  goToPhpLaravelEnvDefinition,
  goToPhpLaravelGateAbilityDefinition,
  goToPhpLaravelLogChannelDefinition,
  goToPhpLaravelMailMailerDefinition,
  goToPhpLaravelMiddlewareAliasDefinition,
  goToPhpLaravelNamedRouteDefinition,
  goToPhpLaravelPasswordBrokerDefinition,
  goToPhpLaravelQueueConnectionDefinition,
  goToPhpLaravelRedisConnectionDefinition,
  goToPhpLaravelRelationStringDefinition,
  goToPhpLaravelStorageDiskDefinition,
  goToPhpLaravelTranslationDefinition,
  goToPhpLaravelViewDefinition,
  goToPhpMethodCallDefinition,
  goToPhpStaticMethodCallDefinition,
  identifierAtEditorPosition,
  intelligenceMode,
  openDirectPhpMethodTarget,
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

      if (context.kind === "laravelRelationString") {
        return goToPhpLaravelRelationStringDefinition(context);
      }

      if (context.kind === "laravelNamedRouteString") {
        return goToPhpLaravelNamedRouteDefinition(context);
      }

      if (context.kind === "laravelTranslationString") {
        return goToPhpLaravelTranslationDefinition(context);
      }

      if (context.kind === "laravelEnvString") {
        return goToPhpLaravelEnvDefinition(context);
      }

      if (context.kind === "laravelConfigString") {
        return goToPhpLaravelConfigDefinition(context);
      }

      if (context.kind === "laravelAuthGuardString") {
        return goToPhpLaravelAuthGuardDefinition(context);
      }

      if (context.kind === "laravelGateAbilityString") {
        return goToPhpLaravelGateAbilityDefinition(context);
      }

      if (context.kind === "laravelMiddlewareAliasString") {
        return goToPhpLaravelMiddlewareAliasDefinition(context);
      }

      if (context.kind === "laravelCacheStoreString") {
        return goToPhpLaravelCacheStoreDefinition(context);
      }

      if (context.kind === "laravelDatabaseConnectionString") {
        return goToPhpLaravelDatabaseConnectionDefinition(context);
      }

      if (context.kind === "laravelBroadcastConnectionString") {
        return goToPhpLaravelBroadcastConnectionDefinition(context);
      }

      if (context.kind === "laravelQueueConnectionString") {
        return goToPhpLaravelQueueConnectionDefinition(context);
      }

      if (context.kind === "laravelRedisConnectionString") {
        return goToPhpLaravelRedisConnectionDefinition(context);
      }

      if (context.kind === "laravelMailMailerString") {
        return goToPhpLaravelMailMailerDefinition(context);
      }

      if (context.kind === "laravelPasswordBrokerString") {
        return goToPhpLaravelPasswordBrokerDefinition(context);
      }

      if (context.kind === "laravelLogChannelString") {
        return goToPhpLaravelLogChannelDefinition(context);
      }

      if (context.kind === "laravelStorageDiskString") {
        return goToPhpLaravelStorageDiskDefinition(context);
      }

      if (context.kind === "laravelViewString") {
        return goToPhpLaravelViewDefinition(context);
      }

      if (context.kind === "laravelRouteActionMethod") {
        const className = resolvePhpClassName(
          activeDocument.content,
          context.className,
        );

        if (!className) {
          return false;
        }

        return openDirectPhpMethodTarget(className, context.methodName);
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
    goToPhpLaravelAuthGuardDefinition,
    goToPhpLaravelBroadcastConnectionDefinition,
    goToPhpLaravelCacheStoreDefinition,
    goToPhpLaravelConfigDefinition,
    goToPhpLaravelDatabaseConnectionDefinition,
    goToPhpLaravelEnvDefinition,
    goToPhpLaravelGateAbilityDefinition,
    goToPhpLaravelLogChannelDefinition,
    goToPhpLaravelMailMailerDefinition,
    goToPhpLaravelMiddlewareAliasDefinition,
    goToPhpLaravelNamedRouteDefinition,
    goToPhpLaravelPasswordBrokerDefinition,
    goToPhpLaravelQueueConnectionDefinition,
    goToPhpLaravelRedisConnectionDefinition,
    goToPhpLaravelRelationStringDefinition,
    goToPhpLaravelStorageDiskDefinition,
    goToPhpLaravelTranslationDefinition,
    goToPhpLaravelViewDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    identifierAtEditorPosition,
    intelligenceMode,
    openDirectPhpMethodTarget,
    openNavigationTarget,
    projectSymbolSearch,
    reportErrorForActiveWorkspaceRoot,
    setMessage,
    workspaceRoot,
  ]);

  return { goToIndexedSymbolDefinition };
}

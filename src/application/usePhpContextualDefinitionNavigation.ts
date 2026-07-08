import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpIdentifierContextAt,
  resolvePhpClassName,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
) => Promise<boolean>;

export interface PhpContextualDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  activeEditorPositionRef: MutableRefObject<EditorPosition | null>;
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
  goToPhpMemberPropertyDefinition: PhpContextHandler<"memberPropertyAccess">;
  goToPhpMethodCallDefinition: PhpContextHandler<"methodCall">;
  goToPhpStaticMethodCallDefinition: PhpContextHandler<"staticMethodCall">;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openPhpClassTarget(className: string, label: string): Promise<boolean>;
}

export interface PhpContextualDefinitionNavigation {
  goToContextualPhpDefinition(): Promise<boolean>;
}

export function usePhpContextualDefinitionNavigation({
  activeDocument,
  activeEditorPositionRef,
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
  goToPhpMemberPropertyDefinition,
  goToPhpMethodCallDefinition,
  goToPhpStaticMethodCallDefinition,
  openDirectPhpMethodTarget,
  openPhpClassTarget,
}: PhpContextualDefinitionNavigationDependencies): PhpContextualDefinitionNavigation {
  const goToContextualPhpDefinition = useCallback(async (): Promise<boolean> => {
    if (!activeDocument || activeDocument.language !== "php") {
      return false;
    }

    const editorPosition = activeEditorPositionRef.current;

    if (!editorPosition) {
      return false;
    }

    const context = phpIdentifierContextAt(activeDocument.content, editorPosition);

    if (!context) {
      return false;
    }

    if (context.kind === "methodCall") {
      return goToPhpMethodCallDefinition(context);
    }

    if (context.kind === "memberPropertyAccess") {
      return goToPhpMemberPropertyDefinition(context);
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

      const openedMethodTarget = await openDirectPhpMethodTarget(
        className,
        context.methodName,
      );

      if (openedMethodTarget) {
        return true;
      }

      return openPhpClassTarget(className, context.className);
    }

    if (context.kind === "classIdentifier") {
      return goToPhpClassIdentifierDefinition(context.name);
    }

    return false;
  }, [
    activeDocument,
    activeEditorPositionRef,
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
    goToPhpMemberPropertyDefinition,
    goToPhpMethodCallDefinition,
    goToPhpStaticMethodCallDefinition,
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  ]);

  return { goToContextualPhpDefinition };
}

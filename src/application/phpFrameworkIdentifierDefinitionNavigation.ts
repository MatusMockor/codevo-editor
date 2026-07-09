import type { EditorDocument } from "../domain/workspace";
import {
  resolvePhpClassName,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import type { PhpLaravelLiteralDefinitionNavigation } from "./usePhpLaravelLiteralDefinitionNavigation";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
) => Promise<boolean>;

export type PhpFrameworkIdentifierContext = Extract<
  PhpIdentifierContext,
  | { kind: "laravelAuthGuardString" }
  | { kind: "laravelBroadcastConnectionString" }
  | { kind: "laravelCacheStoreString" }
  | { kind: "laravelConfigString" }
  | { kind: "laravelDatabaseConnectionString" }
  | { kind: "laravelEnvString" }
  | { kind: "laravelGateAbilityString" }
  | { kind: "laravelLogChannelString" }
  | { kind: "laravelMailMailerString" }
  | { kind: "laravelMiddlewareAliasString" }
  | { kind: "laravelNamedRouteString" }
  | { kind: "laravelPasswordBrokerString" }
  | { kind: "laravelQueueConnectionString" }
  | { kind: "laravelRedisConnectionString" }
  | { kind: "laravelRelationString" }
  | { kind: "laravelRouteActionMethod" }
  | { kind: "laravelStorageDiskString" }
  | { kind: "laravelTranslationString" }
  | { kind: "laravelViewString" }
>;

export type PhpFrameworkIdentifierDefinitionHandler = (
  context: PhpIdentifierContext,
) => Promise<boolean>;

export interface PhpFrameworkIdentifierDefinitionNavigationDependencies
  extends PhpLaravelLiteralDefinitionNavigation {
  activeDocument: EditorDocument | null;
  goToPhpLaravelRelationStringDefinition: PhpContextHandler<"laravelRelationString">;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openPhpClassTarget?(className: string, label: string): Promise<boolean>;
}

export function isPhpFrameworkIdentifierContext(
  context: PhpIdentifierContext,
): context is PhpFrameworkIdentifierContext {
  switch (context.kind) {
    case "laravelAuthGuardString":
    case "laravelBroadcastConnectionString":
    case "laravelCacheStoreString":
    case "laravelConfigString":
    case "laravelDatabaseConnectionString":
    case "laravelEnvString":
    case "laravelGateAbilityString":
    case "laravelLogChannelString":
    case "laravelMailMailerString":
    case "laravelMiddlewareAliasString":
    case "laravelNamedRouteString":
    case "laravelPasswordBrokerString":
    case "laravelQueueConnectionString":
    case "laravelRedisConnectionString":
    case "laravelRelationString":
    case "laravelRouteActionMethod":
    case "laravelStorageDiskString":
    case "laravelTranslationString":
    case "laravelViewString":
      return true;
    default:
      return false;
  }
}

export async function goToPhpFrameworkIdentifierDefinition(
  context: PhpIdentifierContext,
  {
    activeDocument,
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
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  }: PhpFrameworkIdentifierDefinitionNavigationDependencies,
): Promise<boolean> {
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
    if (!activeDocument) {
      return false;
    }

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

    return openPhpClassTarget?.(className, context.className) ?? false;
  }

  return false;
}

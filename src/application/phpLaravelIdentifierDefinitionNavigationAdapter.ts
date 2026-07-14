import {
  resolvePhpClassName,
  type PhpIdentifierContext,
} from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import type {
  PhpFrameworkIdentifierDefinitionNavigationAdapter,
  PhpFrameworkIdentifierDefinitionHandler,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import type { PhpContextualFrameworkLiteralDefinitionRequest } from "./usePhpContextualFrameworkLiteralDefinitionNavigation";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
) => Promise<boolean>;

type LaravelConfigDerivedIdentifierKind =
  | "laravelAuthGuardString"
  | "laravelBroadcastConnectionString"
  | "laravelCacheStoreString"
  | "laravelDatabaseConnectionString"
  | "laravelLogChannelString"
  | "laravelMailMailerString"
  | "laravelPasswordBrokerString"
  | "laravelQueueConnectionString"
  | "laravelRedisConnectionString"
  | "laravelStorageDiskString";

type LaravelConfigDerivedIdentifierValueKey =
  | "brokerName"
  | "channelName"
  | "connectionName"
  | "diskName"
  | "guardName"
  | "mailerName"
  | "storeName";

interface LaravelConfigDerivedIdentifierDefinition {
  readonly contextKind: LaravelConfigDerivedIdentifierKind;
  readonly requestKind: PhpContextualFrameworkLiteralDefinitionRequest["kind"];
  readonly valueKey: LaravelConfigDerivedIdentifierValueKey;
}

const LARAVEL_CONFIG_DERIVED_IDENTIFIER_DEFINITIONS: readonly LaravelConfigDerivedIdentifierDefinition[] =
  [
    {
      contextKind: "laravelAuthGuardString",
      requestKind: "authGuard",
      valueKey: "guardName",
    },
    {
      contextKind: "laravelBroadcastConnectionString",
      requestKind: "broadcastConnection",
      valueKey: "connectionName",
    },
    {
      contextKind: "laravelCacheStoreString",
      requestKind: "cacheStore",
      valueKey: "storeName",
    },
    {
      contextKind: "laravelDatabaseConnectionString",
      requestKind: "databaseConnection",
      valueKey: "connectionName",
    },
    {
      contextKind: "laravelLogChannelString",
      requestKind: "logChannel",
      valueKey: "channelName",
    },
    {
      contextKind: "laravelMailMailerString",
      requestKind: "mailMailer",
      valueKey: "mailerName",
    },
    {
      contextKind: "laravelPasswordBrokerString",
      requestKind: "passwordBroker",
      valueKey: "brokerName",
    },
    {
      contextKind: "laravelQueueConnectionString",
      requestKind: "queueConnection",
      valueKey: "connectionName",
    },
    {
      contextKind: "laravelRedisConnectionString",
      requestKind: "redisConnection",
      valueKey: "connectionName",
    },
    {
      contextKind: "laravelStorageDiskString",
      requestKind: "storageDisk",
      valueKey: "diskName",
    },
  ];

export interface PhpLaravelIdentifierDefinitionNavigationAdapterDependencies {
  activeDocument: EditorDocument | null;
  goToPhpFrameworkLiteralDefinition(
    request: PhpContextualFrameworkLiteralDefinitionRequest,
  ): Promise<boolean>;
  goToPhpFrameworkAuthorizationAbilityDefinition: PhpContextHandler<"laravelGateAbilityString">;
  goToPhpFrameworkMiddlewareAliasDefinition: PhpContextHandler<"laravelMiddlewareAliasString">;
  goToPhpLaravelRelationStringDefinition: PhpContextHandler<"laravelRelationString">;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
  ): Promise<boolean>;
  openPhpClassTarget?(className: string, label: string): Promise<boolean>;
}

export function createPhpLaravelIdentifierDefinitionNavigationAdapter(
  dependencies: PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
): PhpFrameworkIdentifierDefinitionNavigationAdapter {
  const goToDefinition: PhpFrameworkIdentifierDefinitionHandler = async (
    context,
  ): Promise<boolean> => {
    const configDerivedLiteralRequest =
      phpLaravelConfigDerivedFrameworkLiteralRequest(context);

    if (configDerivedLiteralRequest) {
      return dependencies.goToPhpFrameworkLiteralDefinition(
        configDerivedLiteralRequest,
      );
    }

    switch (context.kind) {
      case "laravelRelationString":
        return dependencies.goToPhpLaravelRelationStringDefinition(context);

      case "laravelNamedRouteString":
        return dependencies.goToPhpFrameworkLiteralDefinition({
          kind: "route",
          name: context.routeName,
        });

      case "laravelTranslationString":
        return dependencies.goToPhpFrameworkLiteralDefinition({
          key: context.translationKey,
          kind: "translation",
        });

      case "laravelEnvString":
        return dependencies.goToPhpFrameworkLiteralDefinition({
          kind: "env",
          name: context.envName,
        });

      case "laravelConfigString":
        return dependencies.goToPhpFrameworkLiteralDefinition({
          key: context.configKey,
          kind: "config",
        });

      case "laravelGateAbilityString":
        return dependencies.goToPhpFrameworkAuthorizationAbilityDefinition(context);

      case "laravelMiddlewareAliasString":
        return dependencies.goToPhpFrameworkMiddlewareAliasDefinition(context);

      case "laravelViewString":
        return dependencies.goToPhpFrameworkLiteralDefinition({
          kind: "view",
          name: context.viewName,
        });

      case "laravelValidationTableString":
        return dependencies.goToPhpFrameworkLiteralDefinition({
          kind: "validationTable",
          tableName: context.tableName,
        });

      case "laravelRouteActionMethod":
        return goToRouteActionMethodDefinition(context, dependencies);

      default:
        return false;
    }
  };

  return { goToDefinition };
}

function phpLaravelConfigDerivedFrameworkLiteralRequest(
  context: PhpIdentifierContext,
): PhpContextualFrameworkLiteralDefinitionRequest | null {
  const definition = LARAVEL_CONFIG_DERIVED_IDENTIFIER_DEFINITIONS.find(
    (candidate) => candidate.contextKind === context.kind,
  );

  if (!definition) {
    return null;
  }

  const value = context[
    definition.valueKey as keyof typeof context
  ];

  if (typeof value !== "string") {
    return null;
  }

  return {
    kind: definition.requestKind,
    [definition.valueKey]: value,
  } as PhpContextualFrameworkLiteralDefinitionRequest;
}

async function goToRouteActionMethodDefinition(
  context: Extract<PhpIdentifierContext, { kind: "laravelRouteActionMethod" }>,
  {
    activeDocument,
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  }: PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
): Promise<boolean> {
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

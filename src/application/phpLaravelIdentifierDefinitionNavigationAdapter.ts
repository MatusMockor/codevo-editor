import {
  isPhpLaravelIdentifierContext,
  type PhpLaravelIdentifierContext,
  type PhpLaravelRouteActionMethodContext,
} from "../domain/phpLaravelNavigationContexts";
import { resolvePhpClassName } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import type {
  PhpFrameworkIdentifierDefinitionNavigationAdapter,
  PhpFrameworkIdentifierDefinitionHandler,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import { canNavigate, type NavigationRequest } from "./navigationRequest";
import type { PhpContextualFrameworkLiteralDefinitionRequest } from "./usePhpContextualFrameworkLiteralDefinitionNavigation";

type PhpContextHandler<Kind extends PhpLaravelIdentifierContext["kind"]> = (
  context: Extract<PhpLaravelIdentifierContext, { kind: Kind }>,
  request?: NavigationRequest,
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
    navigationRequest?: NavigationRequest,
  ): Promise<boolean>;
  goToPhpFrameworkAuthorizationAbilityDefinition: PhpContextHandler<"laravelGateAbilityString">;
  goToPhpFrameworkMiddlewareAliasDefinition: PhpContextHandler<"laravelMiddlewareAliasString">;
  goToPhpLaravelRelationStringDefinition: PhpContextHandler<"laravelRelationString">;
  openDirectPhpMethodTarget(
    className: string,
    methodName: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  openPhpClassTarget?(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
}

export function createPhpLaravelIdentifierDefinitionNavigationAdapter(
  dependencies: PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
): PhpFrameworkIdentifierDefinitionNavigationAdapter {
  const goToDefinition: PhpFrameworkIdentifierDefinitionHandler = async (
    context,
    request,
  ): Promise<boolean> => {
    if (!canNavigate(request)) {
      return false;
    }

    if (!isPhpLaravelIdentifierContext(context)) {
      return false;
    }

    const configDerivedLiteralRequest =
      phpLaravelConfigDerivedFrameworkLiteralRequest(context);

    if (configDerivedLiteralRequest) {
      return invokeNavigationDelegate(
        dependencies.goToPhpFrameworkLiteralDefinition,
        configDerivedLiteralRequest,
        request,
      );
    }

    switch (context.kind) {
      case "laravelRelationString":
        return invokeNavigationDelegate(
          dependencies.goToPhpLaravelRelationStringDefinition,
          context,
          request,
        );

      case "laravelNamedRouteString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkLiteralDefinition,
          { kind: "route", name: context.routeName },
          request,
        );

      case "laravelTranslationString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkLiteralDefinition,
          { key: context.translationKey, kind: "translation" },
          request,
        );

      case "laravelEnvString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkLiteralDefinition,
          { kind: "env", name: context.envName },
          request,
        );

      case "laravelConfigString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkLiteralDefinition,
          { key: context.configKey, kind: "config" },
          request,
        );

      case "laravelGateAbilityString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkAuthorizationAbilityDefinition,
          context,
          request,
        );

      case "laravelMiddlewareAliasString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkMiddlewareAliasDefinition,
          context,
          request,
        );

      case "laravelViewString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkLiteralDefinition,
          { kind: "view", name: context.viewName },
          request,
        );

      case "laravelValidationTableString":
        return invokeNavigationDelegate(
          dependencies.goToPhpFrameworkLiteralDefinition,
          { kind: "validationTable", tableName: context.tableName },
          request,
        );

      case "laravelRouteActionMethod":
        return goToRouteActionMethodDefinition(context, dependencies, request);

      default:
        return false;
    }
  };

  return { goToDefinition };
}

async function invokeNavigationDelegate<Argument>(
  delegate: (
    argument: Argument,
    request?: NavigationRequest,
  ) => Promise<boolean>,
  argument: Argument,
  request?: NavigationRequest,
): Promise<boolean> {
  if (!canNavigate(request)) {
    return false;
  }

  const handled = request
    ? await delegate(argument, request)
    : await delegate(argument);

  if (!canNavigate(request)) {
    return false;
  }

  return handled;
}

async function invokeTwoArgumentNavigationDelegate<First, Second>(
  delegate: (
    first: First,
    second: Second,
    request?: NavigationRequest,
  ) => Promise<boolean>,
  first: First,
  second: Second,
  request?: NavigationRequest,
): Promise<boolean> {
  if (!canNavigate(request)) {
    return false;
  }

  const handled = request
    ? await delegate(first, second, request)
    : await delegate(first, second);

  if (!canNavigate(request)) {
    return false;
  }

  return handled;
}

function phpLaravelConfigDerivedFrameworkLiteralRequest(
  context: PhpLaravelIdentifierContext,
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
  context: PhpLaravelRouteActionMethodContext,
  {
    activeDocument,
    openDirectPhpMethodTarget,
    openPhpClassTarget,
  }: PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
  request?: NavigationRequest,
): Promise<boolean> {
  if (!canNavigate(request) || !activeDocument) {
    return false;
  }

  const className = resolvePhpClassName(
    activeDocument.content,
    context.className,
  );

  if (!className) {
    return false;
  }

  const openedMethodTarget = await invokeTwoArgumentNavigationDelegate(
    openDirectPhpMethodTarget,
    className,
    context.methodName,
    request,
  );

  if (!canNavigate(request)) {
    return false;
  }

  if (openedMethodTarget) {
    return true;
  }

  if (!openPhpClassTarget) {
    return false;
  }

  return invokeTwoArgumentNavigationDelegate(
    openPhpClassTarget,
    className,
    context.className,
    request,
  );
}

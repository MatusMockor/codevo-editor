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
import type { PhpLaravelLiteralDefinitionNavigation } from "./usePhpLaravelLiteralDefinitionNavigation";

type PhpContextHandler<Kind extends PhpIdentifierContext["kind"]> = (
  context: Extract<PhpIdentifierContext, { kind: Kind }>,
) => Promise<boolean>;

export interface PhpLaravelIdentifierDefinitionNavigationAdapterDependencies
  extends PhpLaravelLiteralDefinitionNavigation {
  activeDocument: EditorDocument | null;
  goToPhpFrameworkLiteralDefinition(
    request: PhpContextualFrameworkLiteralDefinitionRequest,
  ): Promise<boolean>;
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

      case "laravelAuthGuardString":
        return dependencies.goToPhpLaravelAuthGuardDefinition(context);

      case "laravelGateAbilityString":
        return dependencies.goToPhpLaravelGateAbilityDefinition(context);

      case "laravelMiddlewareAliasString":
        return dependencies.goToPhpLaravelMiddlewareAliasDefinition(context);

      case "laravelCacheStoreString":
        return dependencies.goToPhpLaravelCacheStoreDefinition(context);

      case "laravelDatabaseConnectionString":
        return dependencies.goToPhpLaravelDatabaseConnectionDefinition(context);

      case "laravelBroadcastConnectionString":
        return dependencies.goToPhpLaravelBroadcastConnectionDefinition(context);

      case "laravelQueueConnectionString":
        return dependencies.goToPhpLaravelQueueConnectionDefinition(context);

      case "laravelRedisConnectionString":
        return dependencies.goToPhpLaravelRedisConnectionDefinition(context);

      case "laravelMailMailerString":
        return dependencies.goToPhpLaravelMailMailerDefinition(context);

      case "laravelPasswordBrokerString":
        return dependencies.goToPhpLaravelPasswordBrokerDefinition(context);

      case "laravelLogChannelString":
        return dependencies.goToPhpLaravelLogChannelDefinition(context);

      case "laravelStorageDiskString":
        return dependencies.goToPhpLaravelStorageDiskDefinition(context);

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

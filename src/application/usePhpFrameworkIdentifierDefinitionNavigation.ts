import { useCallback, useMemo } from "react";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  goToPhpFrameworkIdentifierDefinition as goToPhpFrameworkIdentifierDefinitionForContext,
  type PhpFrameworkIdentifierDefinitionHandler,
  type PhpFrameworkIdentifierDefinitionNavigationDependencies as PurePhpFrameworkIdentifierDefinitionNavigationDependencies,
} from "./phpFrameworkIdentifierDefinitionNavigation";

export interface PhpFrameworkIdentifierDefinitionNavigationDependencies
  extends Omit<
    PurePhpFrameworkIdentifierDefinitionNavigationDependencies,
    "openPhpClassTarget"
  > {
  openPhpClassTarget(className: string, label: string): Promise<boolean>;
}

export interface PhpFrameworkIdentifierDefinitionNavigation {
  goToPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
  goToContextualPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
}

export function usePhpFrameworkIdentifierDefinitionNavigation({
  activeDocument,
  goToPhpFrameworkLiteralDefinition,
  goToPhpLaravelAuthGuardDefinition,
  goToPhpLaravelBroadcastConnectionDefinition,
  goToPhpLaravelCacheStoreDefinition,
  goToPhpLaravelDatabaseConnectionDefinition,
  goToPhpLaravelGateAbilityDefinition,
  goToPhpLaravelLogChannelDefinition,
  goToPhpLaravelMailMailerDefinition,
  goToPhpLaravelMiddlewareAliasDefinition,
  goToPhpLaravelPasswordBrokerDefinition,
  goToPhpLaravelQueueConnectionDefinition,
  goToPhpLaravelRedisConnectionDefinition,
  goToPhpLaravelRelationStringDefinition,
  goToPhpLaravelStorageDiskDefinition,
  openDirectPhpMethodTarget,
  openPhpClassTarget,
}: PhpFrameworkIdentifierDefinitionNavigationDependencies): PhpFrameworkIdentifierDefinitionNavigation {
  const sharedDependencies = useMemo(
    (): PurePhpFrameworkIdentifierDefinitionNavigationDependencies => ({
      activeDocument,
      goToPhpFrameworkLiteralDefinition,
      goToPhpLaravelAuthGuardDefinition,
      goToPhpLaravelBroadcastConnectionDefinition,
      goToPhpLaravelCacheStoreDefinition,
      goToPhpLaravelDatabaseConnectionDefinition,
      goToPhpLaravelGateAbilityDefinition,
      goToPhpLaravelLogChannelDefinition,
      goToPhpLaravelMailMailerDefinition,
      goToPhpLaravelMiddlewareAliasDefinition,
      goToPhpLaravelPasswordBrokerDefinition,
      goToPhpLaravelQueueConnectionDefinition,
      goToPhpLaravelRedisConnectionDefinition,
      goToPhpLaravelRelationStringDefinition,
      goToPhpLaravelStorageDiskDefinition,
      openDirectPhpMethodTarget,
    }),
    [
      activeDocument,
      goToPhpFrameworkLiteralDefinition,
      goToPhpLaravelAuthGuardDefinition,
      goToPhpLaravelBroadcastConnectionDefinition,
      goToPhpLaravelCacheStoreDefinition,
      goToPhpLaravelDatabaseConnectionDefinition,
      goToPhpLaravelGateAbilityDefinition,
      goToPhpLaravelLogChannelDefinition,
      goToPhpLaravelMailMailerDefinition,
      goToPhpLaravelMiddlewareAliasDefinition,
      goToPhpLaravelPasswordBrokerDefinition,
      goToPhpLaravelQueueConnectionDefinition,
      goToPhpLaravelRedisConnectionDefinition,
      goToPhpLaravelRelationStringDefinition,
      goToPhpLaravelStorageDiskDefinition,
      openDirectPhpMethodTarget,
    ],
  );

  const contextualDependencies = useMemo(
    (): PurePhpFrameworkIdentifierDefinitionNavigationDependencies => ({
      ...sharedDependencies,
      openPhpClassTarget,
    }),
    [openPhpClassTarget, sharedDependencies],
  );

  const goToPhpFrameworkIdentifierDefinition = useCallback(
    async (context: PhpIdentifierContext): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(
        context,
        sharedDependencies,
      ),
    [sharedDependencies],
  );

  const goToContextualPhpFrameworkIdentifierDefinition = useCallback(
    async (context: PhpIdentifierContext): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(
        context,
        contextualDependencies,
      ),
    [contextualDependencies],
  );

  return {
    goToContextualPhpFrameworkIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
  };
}

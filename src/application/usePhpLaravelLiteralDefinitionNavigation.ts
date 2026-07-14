import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { usePhpLaravelGateMiddlewareDefinitionNavigation } from "./usePhpLaravelGateMiddlewareDefinitionNavigation";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

interface NamedNavigationTarget {
  path: string;
  position: EditorPosition;
}

type LaravelGateAbilityContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelGateAbilityString" }
>;
type LaravelMiddlewareAliasContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelMiddlewareAliasString" }
>;
type LaravelAuthGuardContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelAuthGuardString" }
>;
type LaravelCacheStoreContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelCacheStoreString" }
>;
type LaravelDatabaseConnectionContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelDatabaseConnectionString" }
>;
type LaravelBroadcastConnectionContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelBroadcastConnectionString" }
>;
type LaravelQueueConnectionContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelQueueConnectionString" }
>;
type LaravelRedisConnectionContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelRedisConnectionString" }
>;
type LaravelMailMailerContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelMailMailerString" }
>;
type LaravelPasswordBrokerContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelPasswordBrokerString" }
>;
type LaravelLogChannelContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelLogChannelString" }
>;
type LaravelStorageDiskContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelStorageDiskString" }
>;

export interface PhpLaravelLiteralDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  collectAuthorizationAbilityTargets: PhpFrameworkTargets["collectAuthorizationAbilityTargets"];
  collectMiddlewareAliasTargets: PhpFrameworkTargets["collectMiddlewareAliasTargets"];
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  findAuthGuardTarget: PhpFrameworkTargets["findAuthGuardTarget"];
  findBroadcastConnectionTarget: PhpFrameworkTargets["findBroadcastConnectionTarget"];
  findCacheStoreTarget: PhpFrameworkTargets["findCacheStoreTarget"];
  findDatabaseConnectionTarget: PhpFrameworkTargets["findDatabaseConnectionTarget"];
  findLogChannelTarget: PhpFrameworkTargets["findLogChannelTarget"];
  findMailMailerTarget: PhpFrameworkTargets["findMailMailerTarget"];
  findPasswordBrokerTarget: PhpFrameworkTargets["findPasswordBrokerTarget"];
  findQueueConnectionTarget: PhpFrameworkTargets["findQueueConnectionTarget"];
  findRedisConnectionTarget: PhpFrameworkTargets["findRedisConnectionTarget"];
  findStorageDiskTarget: PhpFrameworkTargets["findStorageDiskTarget"];
  frameworkRuntime: PhpFrameworkRuntimeContext;
  openNavigationTarget(
    path: string,
    position: EditorPosition,
    label: string,
    options?: OpenNavigationOptions,
  ): Promise<boolean>;
  setMessage(message: string | null): void;
  workspaceRoot: string | null;
}

export interface PhpLaravelLiteralDefinitionNavigation {
  goToPhpLaravelAuthGuardDefinition(
    context: LaravelAuthGuardContext,
  ): Promise<boolean>;
  goToPhpLaravelBroadcastConnectionDefinition(
    context: LaravelBroadcastConnectionContext,
  ): Promise<boolean>;
  goToPhpLaravelCacheStoreDefinition(
    context: LaravelCacheStoreContext,
  ): Promise<boolean>;
  goToPhpLaravelDatabaseConnectionDefinition(
    context: LaravelDatabaseConnectionContext,
  ): Promise<boolean>;
  goToPhpLaravelGateAbilityDefinition(
    context: LaravelGateAbilityContext,
  ): Promise<boolean>;
  goToPhpLaravelLogChannelDefinition(
    context: LaravelLogChannelContext,
  ): Promise<boolean>;
  goToPhpLaravelMailMailerDefinition(
    context: LaravelMailMailerContext,
  ): Promise<boolean>;
  goToPhpLaravelMiddlewareAliasDefinition(
    context: LaravelMiddlewareAliasContext,
  ): Promise<boolean>;
  goToPhpLaravelPasswordBrokerDefinition(
    context: LaravelPasswordBrokerContext,
  ): Promise<boolean>;
  goToPhpLaravelQueueConnectionDefinition(
    context: LaravelQueueConnectionContext,
  ): Promise<boolean>;
  goToPhpLaravelRedisConnectionDefinition(
    context: LaravelRedisConnectionContext,
  ): Promise<boolean>;
  goToPhpLaravelStorageDiskDefinition(
    context: LaravelStorageDiskContext,
  ): Promise<boolean>;
}

export function usePhpLaravelLiteralDefinitionNavigation({
  activeDocument,
  collectAuthorizationAbilityTargets,
  collectMiddlewareAliasTargets,
  currentWorkspaceRootRef,
  findAuthGuardTarget,
  findBroadcastConnectionTarget,
  findCacheStoreTarget,
  findDatabaseConnectionTarget,
  findLogChannelTarget,
  findMailMailerTarget,
  findPasswordBrokerTarget,
  findQueueConnectionTarget,
  findRedisConnectionTarget,
  findStorageDiskTarget,
  frameworkRuntime,
  openNavigationTarget,
  setMessage,
  workspaceRoot,
}: PhpLaravelLiteralDefinitionNavigationDependencies): PhpLaravelLiteralDefinitionNavigation {
  const {
    goToPhpLaravelGateAbilityDefinition,
    goToPhpLaravelMiddlewareAliasDefinition,
  } = usePhpLaravelGateMiddlewareDefinitionNavigation({
    activeDocument,
    collectAuthorizationAbilityTargets,
    collectMiddlewareAliasTargets,
    currentWorkspaceRootRef,
    frameworkRuntime,
    openNavigationTarget,
    setMessage,
    workspaceRoot,
  });
  const supportsLaravelOnlyTargets = frameworkRuntime.hasProvider("laravel");
  const openResolvedTarget = useCallback(
    async <Target extends NamedNavigationTarget>({
      gate = supportsLaravelOnlyTargets,
      label,
      missingMessage,
      resolve,
    }: {
      gate?: boolean;
      label(target: Target): string;
      missingMessage: string;
      resolve(): Promise<Target | null>;
    }): Promise<boolean> => {
      const requestedRoot = workspaceRoot;
      const isRequestedRootActive = () =>
        workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot);

      if (!requestedRoot || !activeDocument || !gate) {
        return false;
      }

      const target = await resolve();

      if (!isRequestedRootActive()) {
        return false;
      }

      if (!target) {
        setMessage(missingMessage);
        return false;
      }

      return openNavigationTarget(target.path, target.position, label(target));
    },
    [
      activeDocument,
      currentWorkspaceRootRef,
      openNavigationTarget,
      setMessage,
      supportsLaravelOnlyTargets,
      workspaceRoot,
    ],
  );

  const goToPhpLaravelAuthGuardDefinition = useCallback(
    async (context: LaravelAuthGuardContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.guardName,
        missingMessage: `No Laravel auth guard ${context.guardName} found.`,
        resolve: () => findAuthGuardTarget(context.guardName),
      }),
    [findAuthGuardTarget, openResolvedTarget],
  );

  const goToPhpLaravelCacheStoreDefinition = useCallback(
    async (context: LaravelCacheStoreContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.storeName,
        missingMessage: `No Laravel cache store ${context.storeName} found.`,
        resolve: () => findCacheStoreTarget(context.storeName),
      }),
    [findCacheStoreTarget, openResolvedTarget],
  );

  const goToPhpLaravelDatabaseConnectionDefinition = useCallback(
    async (context: LaravelDatabaseConnectionContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.connectionName,
        missingMessage: `No Laravel database connection ${context.connectionName} found.`,
        resolve: () => findDatabaseConnectionTarget(context.connectionName),
      }),
    [findDatabaseConnectionTarget, openResolvedTarget],
  );

  const goToPhpLaravelBroadcastConnectionDefinition = useCallback(
    async (context: LaravelBroadcastConnectionContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.connectionName,
        missingMessage: `No Laravel broadcast connection ${context.connectionName} found.`,
        resolve: () => findBroadcastConnectionTarget(context.connectionName),
      }),
    [findBroadcastConnectionTarget, openResolvedTarget],
  );

  const goToPhpLaravelQueueConnectionDefinition = useCallback(
    async (context: LaravelQueueConnectionContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.connectionName,
        missingMessage: `No Laravel queue connection ${context.connectionName} found.`,
        resolve: () => findQueueConnectionTarget(context.connectionName),
      }),
    [findQueueConnectionTarget, openResolvedTarget],
  );

  const goToPhpLaravelRedisConnectionDefinition = useCallback(
    async (context: LaravelRedisConnectionContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.connectionName,
        missingMessage: `No Laravel redis connection ${context.connectionName} found.`,
        resolve: () => findRedisConnectionTarget(context.connectionName),
      }),
    [findRedisConnectionTarget, openResolvedTarget],
  );

  const goToPhpLaravelMailMailerDefinition = useCallback(
    async (context: LaravelMailMailerContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.mailerName,
        missingMessage: `No Laravel mailer ${context.mailerName} found.`,
        resolve: () => findMailMailerTarget(context.mailerName),
      }),
    [findMailMailerTarget, openResolvedTarget],
  );

  const goToPhpLaravelPasswordBrokerDefinition = useCallback(
    async (context: LaravelPasswordBrokerContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.brokerName,
        missingMessage: `No Laravel password broker ${context.brokerName} found.`,
        resolve: () => findPasswordBrokerTarget(context.brokerName),
      }),
    [findPasswordBrokerTarget, openResolvedTarget],
  );

  const goToPhpLaravelLogChannelDefinition = useCallback(
    async (context: LaravelLogChannelContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.channelName,
        missingMessage: `No Laravel log channel ${context.channelName} found.`,
        resolve: () => findLogChannelTarget(context.channelName),
      }),
    [findLogChannelTarget, openResolvedTarget],
  );

  const goToPhpLaravelStorageDiskDefinition = useCallback(
    async (context: LaravelStorageDiskContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.diskName,
        missingMessage: `No Laravel storage disk ${context.diskName} found.`,
        resolve: () => findStorageDiskTarget(context.diskName),
      }),
    [findStorageDiskTarget, openResolvedTarget],
  );

  return {
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
    goToPhpLaravelStorageDiskDefinition,
  };
}

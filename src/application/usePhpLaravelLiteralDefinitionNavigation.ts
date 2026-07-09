import { useCallback, type MutableRefObject } from "react";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpLaravelEnvTarget } from "../domain/phpLaravelEnv";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import type { EditorDocument } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

interface OpenNavigationOptions {
  readOnly?: boolean;
}

interface NamedNavigationTarget {
  path: string;
  position: EditorPosition;
}

type LaravelNamedRouteContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelNamedRouteString" }
>;
type LaravelGateAbilityContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelGateAbilityString" }
>;
type LaravelMiddlewareAliasContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelMiddlewareAliasString" }
>;
type LaravelViewContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelViewString" }
>;
type LaravelConfigContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelConfigString" }
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
type LaravelEnvContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelEnvString" }
>;
type LaravelTranslationContext = Extract<
  PhpIdentifierContext,
  { kind: "laravelTranslationString" }
>;

export interface PhpLaravelLiteralDefinitionNavigationDependencies {
  activeDocument: EditorDocument | null;
  collectAuthorizationAbilityTargets: PhpFrameworkTargets["collectAuthorizationAbilityTargets"];
  collectMiddlewareAliasTargets: PhpFrameworkTargets["collectMiddlewareAliasTargets"];
  collectNamedRouteTargets: PhpFrameworkTargets["collectNamedRouteTargets"];
  currentWorkspaceRootRef: MutableRefObject<string | null>;
  findAuthGuardTarget: PhpFrameworkTargets["findAuthGuardTarget"];
  findBroadcastConnectionTarget: PhpFrameworkTargets["findBroadcastConnectionTarget"];
  findCacheStoreTarget: PhpFrameworkTargets["findCacheStoreTarget"];
  findConfigTarget: PhpFrameworkTargets["findConfigTarget"];
  findDatabaseConnectionTarget: PhpFrameworkTargets["findDatabaseConnectionTarget"];
  findLogChannelTarget: PhpFrameworkTargets["findLogChannelTarget"];
  findMailMailerTarget: PhpFrameworkTargets["findMailMailerTarget"];
  findPasswordBrokerTarget: PhpFrameworkTargets["findPasswordBrokerTarget"];
  findPhpLaravelEnvTarget(
    envName: string,
  ): Promise<PhpLaravelEnvTarget | null>;
  findQueueConnectionTarget: PhpFrameworkTargets["findQueueConnectionTarget"];
  findRedisConnectionTarget: PhpFrameworkTargets["findRedisConnectionTarget"];
  findStorageDiskTarget: PhpFrameworkTargets["findStorageDiskTarget"];
  findTranslationTarget: PhpFrameworkTargets["findTranslationTarget"];
  findViewTarget: PhpFrameworkTargets["findViewTarget"];
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
  goToPhpLaravelConfigDefinition(context: LaravelConfigContext): Promise<boolean>;
  goToPhpLaravelDatabaseConnectionDefinition(
    context: LaravelDatabaseConnectionContext,
  ): Promise<boolean>;
  goToPhpLaravelEnvDefinition(context: LaravelEnvContext): Promise<boolean>;
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
  goToPhpLaravelNamedRouteDefinition(
    context: LaravelNamedRouteContext,
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
  goToPhpLaravelTranslationDefinition(
    context: LaravelTranslationContext,
  ): Promise<boolean>;
  goToPhpLaravelViewDefinition(context: LaravelViewContext): Promise<boolean>;
}

export function usePhpLaravelLiteralDefinitionNavigation({
  activeDocument,
  collectAuthorizationAbilityTargets,
  collectMiddlewareAliasTargets,
  collectNamedRouteTargets,
  currentWorkspaceRootRef,
  findAuthGuardTarget,
  findBroadcastConnectionTarget,
  findCacheStoreTarget,
  findConfigTarget,
  findDatabaseConnectionTarget,
  findLogChannelTarget,
  findMailMailerTarget,
  findPasswordBrokerTarget,
  findPhpLaravelEnvTarget,
  findQueueConnectionTarget,
  findRedisConnectionTarget,
  findStorageDiskTarget,
  findTranslationTarget,
  findViewTarget,
  frameworkRuntime,
  openNavigationTarget,
  setMessage,
  workspaceRoot,
}: PhpLaravelLiteralDefinitionNavigationDependencies): PhpLaravelLiteralDefinitionNavigation {
  const supportsLaravelOnlyTargets = frameworkRuntime.isLaravel;
  const supportsRoutes = frameworkRuntime.supports("routes");
  const supportsViews = frameworkRuntime.supports("views");
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

  const goToPhpLaravelNamedRouteDefinition = useCallback(
    async (context: LaravelNamedRouteContext): Promise<boolean> =>
      openResolvedTarget({
        gate: supportsRoutes,
        label: (target) => target.name,
        missingMessage: `No Laravel route named ${context.routeName} found.`,
        resolve: async () => {
          if (!activeDocument) {
            return null;
          }

          const routes = await collectNamedRouteTargets(
            activeDocument.content,
            activeDocument.path,
          );

          return (
            routes.find(
              (route) =>
                route.name.toLowerCase() === context.routeName.toLowerCase(),
            ) ?? null
          );
        },
      }),
    [
      activeDocument,
      collectNamedRouteTargets,
      openResolvedTarget,
      supportsRoutes,
    ],
  );

  const goToPhpLaravelGateAbilityDefinition = useCallback(
    async (context: LaravelGateAbilityContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.name,
        missingMessage: `No Laravel authorization ability ${context.ability} found.`,
        resolve: async () => {
          if (!activeDocument) {
            return null;
          }

          const abilities = await collectAuthorizationAbilityTargets(
            activeDocument.content,
            activeDocument.path,
          );

          return abilities.find((ability) => ability.name === context.ability) ?? null;
        },
      }),
    [activeDocument, collectAuthorizationAbilityTargets, openResolvedTarget],
  );

  const goToPhpLaravelMiddlewareAliasDefinition = useCallback(
    async (context: LaravelMiddlewareAliasContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.name,
        missingMessage: `No Laravel middleware alias ${context.alias} found.`,
        resolve: async () => {
          if (!activeDocument) {
            return null;
          }

          const aliases = await collectMiddlewareAliasTargets(
            activeDocument.content,
            activeDocument.path,
          );

          return aliases.find((alias) => alias.name === context.alias) ?? null;
        },
      }),
    [activeDocument, collectMiddlewareAliasTargets, openResolvedTarget],
  );

  const goToPhpLaravelViewDefinition = useCallback(
    async (context: LaravelViewContext): Promise<boolean> =>
      openResolvedTarget({
        gate: supportsViews,
        label: (target) => target.name,
        missingMessage: `No Laravel view named ${context.viewName} found.`,
        resolve: () => findViewTarget(context.viewName),
      }),
    [findViewTarget, openResolvedTarget, supportsViews],
  );

  const goToPhpLaravelConfigDefinition = useCallback(
    async (context: LaravelConfigContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.key,
        missingMessage: `No Laravel config key ${context.configKey} found.`,
        resolve: () => findConfigTarget(context.configKey),
      }),
    [findConfigTarget, openResolvedTarget],
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

  const goToPhpLaravelEnvDefinition = useCallback(
    async (context: LaravelEnvContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.name,
        missingMessage: `No Laravel env key ${context.envName} found.`,
        resolve: () => findPhpLaravelEnvTarget(context.envName),
      }),
    [findPhpLaravelEnvTarget, openResolvedTarget],
  );

  const goToPhpLaravelTranslationDefinition = useCallback(
    async (context: LaravelTranslationContext): Promise<boolean> =>
      openResolvedTarget({
        label: (target) => target.key,
        missingMessage: `No Laravel translation key ${context.translationKey} found.`,
        resolve: () => findTranslationTarget(context.translationKey),
      }),
    [findTranslationTarget, openResolvedTarget],
  );

  return {
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
    goToPhpLaravelStorageDiskDefinition,
    goToPhpLaravelTranslationDefinition,
    goToPhpLaravelViewDefinition,
  };
}

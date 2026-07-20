import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import {
  useLaravelTargets,
  type LaravelTargets,
} from "./useLaravelTargets";

import { createPhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type {
  PhpFrameworkTargetCollectorAdapter,
  PhpFrameworkTargets,
  PhpFrameworkTargetsDependencies,
} from "./usePhpFrameworkTargets";

function phpFrameworkTargetsFromLaravelTargets(
  laravelTargets: LaravelTargets,
): PhpFrameworkTargets {
  return {
    collectNamedRouteTargets: laravelTargets.collectPhpLaravelNamedRouteTargets,
    collectAuthorizationAbilityTargets:
      laravelTargets.collectPhpLaravelGateAbilityTargets,
    collectMiddlewareAliasTargets:
      laravelTargets.collectPhpLaravelMiddlewareAliasTargets,
    collectEnvironmentTargets: laravelTargets.collectPhpLaravelEnvTargets,
    collectViewTargets: laravelTargets.collectPhpLaravelViewTargets,
    collectConfigTargets: laravelTargets.collectPhpLaravelConfigTargets,
    collectTranslationTargets:
      laravelTargets.collectPhpLaravelTranslationTargets,
    collectAuthGuardTargets: laravelTargets.collectPhpLaravelAuthGuardTargets,
    collectCacheStoreTargets: laravelTargets.collectPhpLaravelCacheStoreTargets,
    collectDatabaseConnectionTargets:
      laravelTargets.collectPhpLaravelDatabaseConnectionTargets,
    collectBroadcastConnectionTargets:
      laravelTargets.collectPhpLaravelBroadcastConnectionTargets,
    collectQueueConnectionTargets:
      laravelTargets.collectPhpLaravelQueueConnectionTargets,
    collectRedisConnectionTargets:
      laravelTargets.collectPhpLaravelRedisConnectionTargets,
    collectMailMailerTargets: laravelTargets.collectPhpLaravelMailMailerTargets,
    collectPasswordBrokerTargets:
      laravelTargets.collectPhpLaravelPasswordBrokerTargets,
    collectLogChannelTargets: laravelTargets.collectPhpLaravelLogChannelTargets,
    collectStorageDiskTargets:
      laravelTargets.collectPhpLaravelStorageDiskTargets,
    findViewTarget: laravelTargets.findPhpLaravelViewTarget,
    findEnvironmentTarget: laravelTargets.findPhpLaravelEnvTarget,
    findConfigTarget: laravelTargets.findPhpLaravelConfigTarget,
    findTranslationTarget: laravelTargets.findPhpLaravelTranslationTarget,
    findAuthGuardTarget: laravelTargets.findPhpLaravelAuthGuardTarget,
    findCacheStoreTarget: laravelTargets.findPhpLaravelCacheStoreTarget,
    findDatabaseConnectionTarget:
      laravelTargets.findPhpLaravelDatabaseConnectionTarget,
    findBroadcastConnectionTarget:
      laravelTargets.findPhpLaravelBroadcastConnectionTarget,
    findQueueConnectionTarget: laravelTargets.findPhpLaravelQueueConnectionTarget,
    findRedisConnectionTarget: laravelTargets.findPhpLaravelRedisConnectionTarget,
    findMailMailerTarget: laravelTargets.findPhpLaravelMailMailerTarget,
    findPasswordBrokerTarget: laravelTargets.findPhpLaravelPasswordBrokerTarget,
    findLogChannelTarget: laravelTargets.findPhpLaravelLogChannelTarget,
    findStorageDiskTarget: laravelTargets.findPhpLaravelStorageDiskTarget,
    invalidateTargetCache: laravelTargets.invalidatePhpLaravelTargetCache,
  };
}

function usePhpLaravelFrameworkTargetAdapter(
  dependencies: PhpFrameworkTargetsDependencies,
): PhpFrameworkTargets {
  const { frameworkIntelligence, ...shellDependencies } = dependencies;
  const laravelTargets = useLaravelTargets({
    ...shellDependencies,
    frameworkRuntime: createPhpFrameworkRuntimeContext(frameworkIntelligence),
  });

  return phpFrameworkTargetsFromLaravelTargets(laravelTargets);
}

export const phpLaravelFrameworkTargetCollectorAdapter: PhpFrameworkTargetCollectorAdapter =
  {
    providerId: phpLaravelFrameworkProvider.id,
    useTargets: usePhpLaravelFrameworkTargetAdapter,
  };

export const phpLaravelFrameworkTargetCollectorAdapters: readonly PhpFrameworkTargetCollectorAdapter[] =
  [phpLaravelFrameworkTargetCollectorAdapter];

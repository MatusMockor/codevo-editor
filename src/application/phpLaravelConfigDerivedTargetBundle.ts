import {
  phpLaravelAuthGuardTargetDefinition,
  phpLaravelBroadcastConnectionTargetDefinition,
  phpLaravelCacheStoreTargetDefinition,
  phpLaravelDatabaseConnectionTargetDefinition,
  phpLaravelLogChannelTargetDefinition,
  phpLaravelMailMailerTargetDefinition,
  phpLaravelPasswordBrokerTargetDefinition,
  phpLaravelQueueConnectionTargetDefinition,
  phpLaravelRedisConnectionTargetDefinition,
  phpLaravelStorageDiskTargetDefinition,
  useConfigDerivedLaravelTarget,
  type PhpLaravelAuthGuardTarget,
  type PhpLaravelBroadcastConnectionTarget,
  type PhpLaravelCacheStoreTarget,
  type PhpLaravelDatabaseConnectionTarget,
  type PhpLaravelLogChannelTarget,
  type PhpLaravelMailMailerTarget,
  type PhpLaravelPasswordBrokerTarget,
  type PhpLaravelQueueConnectionTarget,
  type PhpLaravelRedisConnectionTarget,
  type PhpLaravelStorageDiskTarget,
} from "./phpLaravelConfigDerivedTargets";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";

export type {
  PhpLaravelAuthGuardTarget,
  PhpLaravelBroadcastConnectionTarget,
  PhpLaravelCacheStoreTarget,
  PhpLaravelDatabaseConnectionTarget,
  PhpLaravelLogChannelTarget,
  PhpLaravelMailMailerTarget,
  PhpLaravelPasswordBrokerTarget,
  PhpLaravelQueueConnectionTarget,
  PhpLaravelRedisConnectionTarget,
  PhpLaravelStorageDiskTarget,
} from "./phpLaravelConfigDerivedTargets";

export interface PhpLaravelConfigTargetResolverLike {
  collect: () => Promise<PhpLaravelConfigTarget[]>;
  find: (configKey: string) => Promise<PhpLaravelConfigTarget | null>;
}

export interface PhpLaravelConfigDerivedTargetBundle {
  collectPhpLaravelAuthGuardTargets: () => Promise<PhpLaravelAuthGuardTarget[]>;
  collectPhpLaravelCacheStoreTargets: () => Promise<PhpLaravelCacheStoreTarget[]>;
  collectPhpLaravelDatabaseConnectionTargets: () => Promise<
    PhpLaravelDatabaseConnectionTarget[]
  >;
  collectPhpLaravelBroadcastConnectionTargets: () => Promise<
    PhpLaravelBroadcastConnectionTarget[]
  >;
  collectPhpLaravelQueueConnectionTargets: () => Promise<
    PhpLaravelQueueConnectionTarget[]
  >;
  collectPhpLaravelRedisConnectionTargets: () => Promise<
    PhpLaravelRedisConnectionTarget[]
  >;
  collectPhpLaravelMailMailerTargets: () => Promise<PhpLaravelMailMailerTarget[]>;
  collectPhpLaravelPasswordBrokerTargets: () => Promise<
    PhpLaravelPasswordBrokerTarget[]
  >;
  collectPhpLaravelLogChannelTargets: () => Promise<PhpLaravelLogChannelTarget[]>;
  collectPhpLaravelStorageDiskTargets: () => Promise<PhpLaravelStorageDiskTarget[]>;
  findPhpLaravelAuthGuardTarget: (
    guardName: string,
  ) => Promise<PhpLaravelAuthGuardTarget | null>;
  findPhpLaravelCacheStoreTarget: (
    storeName: string,
  ) => Promise<PhpLaravelCacheStoreTarget | null>;
  findPhpLaravelDatabaseConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelDatabaseConnectionTarget | null>;
  findPhpLaravelBroadcastConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelBroadcastConnectionTarget | null>;
  findPhpLaravelQueueConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelQueueConnectionTarget | null>;
  findPhpLaravelRedisConnectionTarget: (
    connectionName: string,
  ) => Promise<PhpLaravelRedisConnectionTarget | null>;
  findPhpLaravelMailMailerTarget: (
    mailerName: string,
  ) => Promise<PhpLaravelMailMailerTarget | null>;
  findPhpLaravelPasswordBrokerTarget: (
    brokerName: string,
  ) => Promise<PhpLaravelPasswordBrokerTarget | null>;
  findPhpLaravelLogChannelTarget: (
    channelName: string,
  ) => Promise<PhpLaravelLogChannelTarget | null>;
  findPhpLaravelStorageDiskTarget: (
    diskName: string,
  ) => Promise<PhpLaravelStorageDiskTarget | null>;
}

export function usePhpLaravelConfigDerivedTargetBundle(
  configTargetResolver: PhpLaravelConfigTargetResolverLike,
): PhpLaravelConfigDerivedTargetBundle {
  const authGuardTarget = useConfigDerivedLaravelTarget(
    phpLaravelAuthGuardTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const cacheStoreTarget = useConfigDerivedLaravelTarget(
    phpLaravelCacheStoreTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const databaseConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelDatabaseConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const broadcastConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelBroadcastConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const queueConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelQueueConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const redisConnectionTarget = useConfigDerivedLaravelTarget(
    phpLaravelRedisConnectionTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const mailMailerTarget = useConfigDerivedLaravelTarget(
    phpLaravelMailMailerTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const passwordBrokerTarget = useConfigDerivedLaravelTarget(
    phpLaravelPasswordBrokerTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const logChannelTarget = useConfigDerivedLaravelTarget(
    phpLaravelLogChannelTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );
  const storageDiskTarget = useConfigDerivedLaravelTarget(
    phpLaravelStorageDiskTargetDefinition,
    configTargetResolver.collect,
    configTargetResolver.find,
  );

  return {
    collectPhpLaravelAuthGuardTargets: authGuardTarget.collect,
    collectPhpLaravelCacheStoreTargets: cacheStoreTarget.collect,
    collectPhpLaravelDatabaseConnectionTargets: databaseConnectionTarget.collect,
    collectPhpLaravelBroadcastConnectionTargets: broadcastConnectionTarget.collect,
    collectPhpLaravelQueueConnectionTargets: queueConnectionTarget.collect,
    collectPhpLaravelRedisConnectionTargets: redisConnectionTarget.collect,
    collectPhpLaravelMailMailerTargets: mailMailerTarget.collect,
    collectPhpLaravelPasswordBrokerTargets: passwordBrokerTarget.collect,
    collectPhpLaravelLogChannelTargets: logChannelTarget.collect,
    collectPhpLaravelStorageDiskTargets: storageDiskTarget.collect,
    findPhpLaravelAuthGuardTarget: authGuardTarget.find,
    findPhpLaravelCacheStoreTarget: cacheStoreTarget.find,
    findPhpLaravelDatabaseConnectionTarget: databaseConnectionTarget.find,
    findPhpLaravelBroadcastConnectionTarget: broadcastConnectionTarget.find,
    findPhpLaravelQueueConnectionTarget: queueConnectionTarget.find,
    findPhpLaravelRedisConnectionTarget: redisConnectionTarget.find,
    findPhpLaravelMailMailerTarget: mailMailerTarget.find,
    findPhpLaravelPasswordBrokerTarget: passwordBrokerTarget.find,
    findPhpLaravelLogChannelTarget: logChannelTarget.find,
    findPhpLaravelStorageDiskTarget: storageDiskTarget.find,
  };
}

import { useCallback } from "react";
import {
  phpLaravelAuthGuardConfigKey,
  phpLaravelAuthGuardNameFromConfigKey,
} from "../domain/phpLaravelAuth";
import {
  phpLaravelBroadcastConnectionConfigKey,
  phpLaravelBroadcastConnectionNameFromConfigKey,
} from "../domain/phpLaravelBroadcasting";
import {
  phpLaravelCacheStoreConfigKey,
  phpLaravelCacheStoreNameFromConfigKey,
} from "../domain/phpLaravelCache";
import {
  phpLaravelDatabaseConnectionConfigKey,
  phpLaravelDatabaseConnectionNameFromConfigKey,
} from "../domain/phpLaravelDatabase";
import {
  phpLaravelLogChannelConfigKey,
  phpLaravelLogChannelNameFromConfigKey,
} from "../domain/phpLaravelLog";
import {
  phpLaravelMailMailerConfigKey,
  phpLaravelMailMailerNameFromConfigKey,
} from "../domain/phpLaravelMail";
import {
  phpLaravelPasswordBrokerConfigKey,
  phpLaravelPasswordBrokerNameFromConfigKey,
} from "../domain/phpLaravelPassword";
import {
  phpLaravelQueueConnectionConfigKey,
  phpLaravelQueueConnectionNameFromConfigKey,
} from "../domain/phpLaravelQueue";
import {
  phpLaravelRedisConnectionConfigKey,
  phpLaravelRedisConnectionNameFromConfigKey,
} from "../domain/phpLaravelRedis";
import {
  phpLaravelStorageDiskConfigKey,
  phpLaravelStorageDiskNameFromConfigKey,
} from "../domain/phpLaravelStorage";
import type { PhpLaravelConfigTarget } from "../domain/phpLaravelConfig";

/**
 * A Laravel config target whose key is one segment of a well-known config
 * namespace (`auth.guards.*`, `database.connections.*`, ...), plus the
 * human-facing name extracted from that segment under `property` (e.g.
 * `guardName`, `connectionName`). Every config-derived collector shares this
 * shape; only the property name and the name/config-key mapping functions
 * differ per collector.
 */
export type PhpLaravelConfigDerivedTarget<Property extends string> =
  PhpLaravelConfigTarget & Record<Property, string>;

export type PhpLaravelAuthGuardTarget =
  PhpLaravelConfigDerivedTarget<"guardName">;
export type PhpLaravelCacheStoreTarget =
  PhpLaravelConfigDerivedTarget<"storeName">;
export type PhpLaravelDatabaseConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelBroadcastConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelQueueConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelRedisConnectionTarget =
  PhpLaravelConfigDerivedTarget<"connectionName">;
export type PhpLaravelMailMailerTarget =
  PhpLaravelConfigDerivedTarget<"mailerName">;
export type PhpLaravelPasswordBrokerTarget =
  PhpLaravelConfigDerivedTarget<"brokerName">;
export type PhpLaravelLogChannelTarget =
  PhpLaravelConfigDerivedTarget<"channelName">;
export type PhpLaravelStorageDiskTarget =
  PhpLaravelConfigDerivedTarget<"diskName">;

export interface PhpLaravelConfigDerivedTargetDefinition<Property extends string> {
  configKeyFromName: (name: string) => string | null;
  nameFromConfigKey: (configKey: string) => string | null;
  property: Property;
}

export const phpLaravelAuthGuardTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"guardName"> =
  {
    configKeyFromName: phpLaravelAuthGuardConfigKey,
    nameFromConfigKey: phpLaravelAuthGuardNameFromConfigKey,
    property: "guardName",
  };

export const phpLaravelCacheStoreTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"storeName"> =
  {
    configKeyFromName: phpLaravelCacheStoreConfigKey,
    nameFromConfigKey: phpLaravelCacheStoreNameFromConfigKey,
    property: "storeName",
  };

export const phpLaravelDatabaseConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelDatabaseConnectionConfigKey,
    nameFromConfigKey: phpLaravelDatabaseConnectionNameFromConfigKey,
    property: "connectionName",
  };

export const phpLaravelBroadcastConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelBroadcastConnectionConfigKey,
    nameFromConfigKey: phpLaravelBroadcastConnectionNameFromConfigKey,
    property: "connectionName",
  };

export const phpLaravelQueueConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelQueueConnectionConfigKey,
    nameFromConfigKey: phpLaravelQueueConnectionNameFromConfigKey,
    property: "connectionName",
  };

export const phpLaravelRedisConnectionTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"connectionName"> =
  {
    configKeyFromName: phpLaravelRedisConnectionConfigKey,
    nameFromConfigKey: phpLaravelRedisConnectionNameFromConfigKey,
    property: "connectionName",
  };

export const phpLaravelMailMailerTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"mailerName"> =
  {
    configKeyFromName: phpLaravelMailMailerConfigKey,
    nameFromConfigKey: phpLaravelMailMailerNameFromConfigKey,
    property: "mailerName",
  };

export const phpLaravelPasswordBrokerTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"brokerName"> =
  {
    configKeyFromName: phpLaravelPasswordBrokerConfigKey,
    nameFromConfigKey: phpLaravelPasswordBrokerNameFromConfigKey,
    property: "brokerName",
  };

export const phpLaravelLogChannelTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"channelName"> =
  {
    configKeyFromName: phpLaravelLogChannelConfigKey,
    nameFromConfigKey: phpLaravelLogChannelNameFromConfigKey,
    property: "channelName",
  };

export const phpLaravelStorageDiskTargetDefinition: PhpLaravelConfigDerivedTargetDefinition<"diskName"> =
  {
    configKeyFromName: phpLaravelStorageDiskConfigKey,
    nameFromConfigKey: phpLaravelStorageDiskNameFromConfigKey,
    property: "diskName",
  };

/**
 * Builds the collect/find pair for a single config-derived target kind on top
 * of the shared `collectPhpLaravelConfigTargets`/`findPhpLaravelConfigTarget`
 * primitives. Enablement is delegated to those primitives, which already
 * return empty results when Laravel config targets are unavailable.
 */
export function useConfigDerivedLaravelTarget<Property extends string>(
  definition: PhpLaravelConfigDerivedTargetDefinition<Property>,
  collectConfigTargets: () => Promise<PhpLaravelConfigTarget[]>,
  findConfigTarget: (configKey: string) => Promise<PhpLaravelConfigTarget | null>,
): {
  collect: () => Promise<Array<PhpLaravelConfigDerivedTarget<Property>>>;
  find: (name: string) => Promise<PhpLaravelConfigDerivedTarget<Property> | null>;
} {
  const { configKeyFromName, nameFromConfigKey, property } = definition;

  const collect = useCallback(async (): Promise<
    Array<PhpLaravelConfigDerivedTarget<Property>>
  > => {
    const targets = new Map<string, PhpLaravelConfigDerivedTarget<Property>>();

    for (const target of await collectConfigTargets()) {
      const name = nameFromConfigKey(target.key);

      if (!name) {
        continue;
      }

      const key = name.toLowerCase();

      if (!targets.has(key)) {
        targets.set(key, {
          ...target,
          [property]: name,
        } as PhpLaravelConfigDerivedTarget<Property>);
      }
    }

    return Array.from(targets.values()).sort((left, right) =>
      left[property].localeCompare(right[property]),
    );
  }, [collectConfigTargets, nameFromConfigKey, property]);

  const find = useCallback(
    async (name: string): Promise<PhpLaravelConfigDerivedTarget<Property> | null> => {
      const configKey = configKeyFromName(name);

      if (!configKey) {
        return null;
      }

      const target = await findConfigTarget(configKey);

      return target
        ? ({
            ...target,
            [property]: name,
          } as PhpLaravelConfigDerivedTarget<Property>)
        : null;
    },
    [configKeyFromName, findConfigTarget, property],
  );

  return { collect, find };
}

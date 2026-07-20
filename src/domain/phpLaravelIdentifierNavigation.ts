import type { EditorPosition } from "./languageServerFeatures";
import { phpLaravelAuthGuardReferenceContextAt } from "./phpLaravelAuth";
import { phpLaravelGateAbilityReferenceContextAt } from "./phpLaravelAuthorization";
import { phpLaravelBroadcastConnectionReferenceContextAt } from "./phpLaravelBroadcasting";
import { phpLaravelCacheStoreReferenceContextAt } from "./phpLaravelCache";
import { phpLaravelConfigReferenceContextAt } from "./phpLaravelConfig";
import { phpLaravelDatabaseConnectionReferenceContextAt } from "./phpLaravelDatabase";
import { phpLaravelEnvReferenceContextAt } from "./phpLaravelEnv";
import { phpLaravelLogChannelReferenceContextAt } from "./phpLaravelLog";
import { phpLaravelMailMailerReferenceContextAt } from "./phpLaravelMail";
import { phpLaravelMiddlewareAliasReferenceContextAt } from "./phpLaravelMiddleware";
import {
  phpLaravelRelationStringIdentifierContextAt,
  phpLaravelRouteActionIdentifierContextAt,
  type PhpLaravelIdentifierContext,
} from "./phpLaravelNavigationContexts";
import { phpIdentifierContextAt, type PhpIdentifierContext } from "./phpNavigation";
import { phpLaravelPasswordBrokerReferenceContextAt } from "./phpLaravelPassword";
import { phpLaravelQueueConnectionReferenceContextAt } from "./phpLaravelQueue";
import { phpLaravelRedisConnectionReferenceContextAt } from "./phpLaravelRedis";
import { phpLaravelNamedRouteReferenceContextAt } from "./phpLaravelRoutes";
import { phpLaravelStorageDiskReferenceContextAt } from "./phpLaravelStorage";
import { phpLaravelTranslationReferenceContextAt } from "./phpLaravelTranslations";
import { phpLaravelValidationRuleTableReferenceAt } from "./phpLaravelValidation";
import { phpLaravelViewReferenceContextAt } from "./phpLaravelViews";

declare module "./phpNavigation" {
  interface PhpFrameworkIdentifierContextContributions {
    laravel: PhpLaravelIdentifierContext;
  }
}

export function phpLaravelIdentifierContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelIdentifierContext | null {
  const validationTable = phpLaravelValidationRuleTableReferenceAt(
    source,
    position,
  );

  if (validationTable) {
    return {
      kind: "laravelValidationTableString",
      tableName: validationTable.tableName,
    };
  }

  const namedRoute = phpLaravelNamedRouteReferenceContextAt(source, position);

  if (namedRoute) {
    return {
      kind: "laravelNamedRouteString",
      routeName: namedRoute.name,
    };
  }

  const translationReference = phpLaravelTranslationReferenceContextAt(
    source,
    position,
  );

  if (translationReference) {
    return {
      kind: "laravelTranslationString",
      translationKey: translationReference.key,
    };
  }

  const envReference = phpLaravelEnvReferenceContextAt(source, position);

  if (envReference) {
    return {
      envName: envReference.name,
      kind: "laravelEnvString",
    };
  }

  const configReference = phpLaravelConfigReferenceContextAt(source, position);

  if (configReference) {
    return {
      configKey: configReference.key,
      kind: "laravelConfigString",
    };
  }

  const authGuardReference = phpLaravelAuthGuardReferenceContextAt(
    source,
    position,
  );

  if (authGuardReference) {
    return {
      guardName: authGuardReference.guardName,
      kind: "laravelAuthGuardString",
    };
  }

  const gateAbilityReference = phpLaravelGateAbilityReferenceContextAt(
    source,
    position,
  );

  if (gateAbilityReference) {
    return {
      ability: gateAbilityReference.ability,
      kind: "laravelGateAbilityString",
    };
  }

  const middlewareAliasReference = phpLaravelMiddlewareAliasReferenceContextAt(
    source,
    position,
  );

  if (middlewareAliasReference) {
    return {
      alias: middlewareAliasReference.alias,
      kind: "laravelMiddlewareAliasString",
    };
  }

  const cacheStoreReference = phpLaravelCacheStoreReferenceContextAt(
    source,
    position,
  );

  if (cacheStoreReference) {
    return {
      kind: "laravelCacheStoreString",
      storeName: cacheStoreReference.storeName,
    };
  }

  const databaseConnectionReference =
    phpLaravelDatabaseConnectionReferenceContextAt(source, position);

  if (databaseConnectionReference) {
    return {
      connectionName: databaseConnectionReference.connectionName,
      kind: "laravelDatabaseConnectionString",
    };
  }

  const broadcastConnectionReference =
    phpLaravelBroadcastConnectionReferenceContextAt(source, position);

  if (broadcastConnectionReference) {
    return {
      connectionName: broadcastConnectionReference.connectionName,
      kind: "laravelBroadcastConnectionString",
    };
  }

  const queueConnectionReference = phpLaravelQueueConnectionReferenceContextAt(
    source,
    position,
  );

  if (queueConnectionReference) {
    return {
      connectionName: queueConnectionReference.connectionName,
      kind: "laravelQueueConnectionString",
    };
  }

  const mailMailerReference = phpLaravelMailMailerReferenceContextAt(
    source,
    position,
  );

  if (mailMailerReference) {
    return {
      kind: "laravelMailMailerString",
      mailerName: mailMailerReference.mailerName,
    };
  }

  const passwordBrokerReference = phpLaravelPasswordBrokerReferenceContextAt(
    source,
    position,
  );

  if (passwordBrokerReference) {
    return {
      brokerName: passwordBrokerReference.brokerName,
      kind: "laravelPasswordBrokerString",
    };
  }

  const redisConnectionReference = phpLaravelRedisConnectionReferenceContextAt(
    source,
    position,
  );

  if (redisConnectionReference) {
    return {
      connectionName: redisConnectionReference.connectionName,
      kind: "laravelRedisConnectionString",
    };
  }

  const logChannelReference = phpLaravelLogChannelReferenceContextAt(
    source,
    position,
  );

  if (logChannelReference) {
    return {
      channelName: logChannelReference.channelName,
      kind: "laravelLogChannelString",
    };
  }

  const storageDiskReference = phpLaravelStorageDiskReferenceContextAt(
    source,
    position,
  );

  if (storageDiskReference) {
    return {
      diskName: storageDiskReference.diskName,
      kind: "laravelStorageDiskString",
    };
  }

  const viewReference = phpLaravelViewReferenceContextAt(source, position);

  if (viewReference) {
    return {
      kind: "laravelViewString",
      viewName: viewReference.name,
    };
  }

  return (
    phpLaravelRelationStringIdentifierContextAt(source, position) ??
    phpLaravelRouteActionIdentifierContextAt(source, position)
  );
}

/** Compatibility helper for Laravel-focused domain tests and callers. */
export function phpIdentifierContextAtWithLaravel(
  source: string,
  position: EditorPosition,
): PhpIdentifierContext | null {
  return (
    phpLaravelIdentifierContextAt(source, position) ??
    phpIdentifierContextAt(source, position)
  );
}

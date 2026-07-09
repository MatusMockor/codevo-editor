import type { EditorPosition } from "./languageServerFeatures";
import {
  phpLaravelGateAbilityCompletionInsertText,
  phpLaravelGateAbilityReferenceContextAt,
} from "./phpLaravelAuthorization";
import {
  phpLaravelAuthGuardCompletionInsertText,
  phpLaravelAuthGuardReferenceContextAt,
} from "./phpLaravelAuth";
import {
  phpLaravelBroadcastConnectionCompletionInsertText,
  phpLaravelBroadcastConnectionReferenceContextAt,
} from "./phpLaravelBroadcasting";
import {
  phpLaravelCacheStoreCompletionInsertText,
  phpLaravelCacheStoreReferenceContextAt,
} from "./phpLaravelCache";
import { phpLaravelConfigReferenceContextAt } from "./phpLaravelConfig";
import {
  phpLaravelDatabaseConnectionCompletionInsertText,
  phpLaravelDatabaseConnectionReferenceContextAt,
} from "./phpLaravelDatabase";
import { phpLaravelEnvReferenceContextAt } from "./phpLaravelEnv";
import {
  phpLaravelLogChannelCompletionInsertText,
  phpLaravelLogChannelReferenceContextAt,
} from "./phpLaravelLog";
import {
  phpLaravelMailMailerCompletionInsertText,
  phpLaravelMailMailerReferenceContextAt,
} from "./phpLaravelMail";
import {
  phpLaravelMiddlewareAliasCompletionInsertText,
  phpLaravelMiddlewareAliasReferenceContextAt,
} from "./phpLaravelMiddleware";
import { phpLaravelNamedRouteReferenceContextAt } from "./phpLaravelRoutes";
import {
  phpLaravelPasswordBrokerCompletionInsertText,
  phpLaravelPasswordBrokerReferenceContextAt,
} from "./phpLaravelPassword";
import {
  phpLaravelQueueConnectionCompletionInsertText,
  phpLaravelQueueConnectionReferenceContextAt,
} from "./phpLaravelQueue";
import {
  phpLaravelRedisConnectionCompletionInsertText,
  phpLaravelRedisConnectionReferenceContextAt,
} from "./phpLaravelRedis";
import {
  phpLaravelStorageDiskCompletionInsertText,
  phpLaravelStorageDiskReferenceContextAt,
} from "./phpLaravelStorage";
import { phpLaravelTranslationReferenceContextAt } from "./phpLaravelTranslations";
import { phpLaravelValidationRuleStringContextAt } from "./phpLaravelValidation";
import { phpLaravelViewReferenceContextAt } from "./phpLaravelViews";
import type {
  PhpFrameworkScopedStringCompletion,
  PhpFrameworkScopedStringCompletionKind,
} from "./phpFrameworkProviders";
import { phpLaravelRelationStringCompletionContextAt } from "./phpNavigation";

export function phpLaravelScopedStringCompletionContextAt(
  source: string,
  position: EditorPosition,
): boolean {
  return Boolean(
    phpLaravelNamedRouteReferenceContextAt(source, position) ||
      phpLaravelRelationStringCompletionContextAt(source, position) ||
      phpLaravelTranslationReferenceContextAt(source, position) ||
      phpLaravelEnvReferenceContextAt(source, position) ||
      phpLaravelConfigReferenceContextAt(source, position) ||
      phpLaravelGateAbilityReferenceContextAt(source, position) ||
      phpLaravelMiddlewareAliasReferenceContextAt(source, position) ||
      phpLaravelAuthGuardReferenceContextAt(source, position) ||
      phpLaravelCacheStoreReferenceContextAt(source, position) ||
      phpLaravelDatabaseConnectionReferenceContextAt(source, position) ||
      phpLaravelBroadcastConnectionReferenceContextAt(source, position) ||
      phpLaravelQueueConnectionReferenceContextAt(source, position) ||
      phpLaravelRedisConnectionReferenceContextAt(source, position) ||
      phpLaravelMailMailerReferenceContextAt(source, position) ||
      phpLaravelPasswordBrokerReferenceContextAt(source, position) ||
      phpLaravelLogChannelReferenceContextAt(source, position) ||
      phpLaravelStorageDiskReferenceContextAt(source, position) ||
      phpLaravelValidationRuleStringContextAt(source, position) ||
      phpLaravelViewReferenceContextAt(source, position),
  );
}

export function phpLaravelScopedStringCompletionAt(
  source: string,
  position: EditorPosition,
): PhpFrameworkScopedStringCompletion | null {
  const gateAbility = phpLaravelGateAbilityReferenceContextAt(source, position);

  if (gateAbility) {
    return { kind: "gateAbility", prefix: gateAbility.prefix };
  }

  const middlewareAlias = phpLaravelMiddlewareAliasReferenceContextAt(
    source,
    position,
  );

  if (middlewareAlias && !middlewareAlias.aliasParameterStarted) {
    return { kind: "middlewareAlias", prefix: middlewareAlias.alias };
  }

  const authGuard = phpLaravelAuthGuardReferenceContextAt(source, position);

  if (authGuard) {
    return { kind: "authGuard", prefix: authGuard.prefix };
  }

  const cacheStore = phpLaravelCacheStoreReferenceContextAt(source, position);

  if (cacheStore) {
    return { kind: "cacheStore", prefix: cacheStore.prefix };
  }

  const databaseConnection = phpLaravelDatabaseConnectionReferenceContextAt(
    source,
    position,
  );

  if (databaseConnection) {
    return {
      kind: "databaseConnection",
      prefix: databaseConnection.prefix,
    };
  }

  const broadcastConnection = phpLaravelBroadcastConnectionReferenceContextAt(
    source,
    position,
  );

  if (broadcastConnection) {
    return {
      kind: "broadcastConnection",
      prefix: broadcastConnection.prefix,
    };
  }

  const queueConnection = phpLaravelQueueConnectionReferenceContextAt(
    source,
    position,
  );

  if (queueConnection) {
    return { kind: "queueConnection", prefix: queueConnection.prefix };
  }

  const redisConnection = phpLaravelRedisConnectionReferenceContextAt(
    source,
    position,
  );

  if (redisConnection) {
    return { kind: "redisConnection", prefix: redisConnection.prefix };
  }

  const mailMailer = phpLaravelMailMailerReferenceContextAt(source, position);

  if (mailMailer) {
    return { kind: "mailMailer", prefix: mailMailer.prefix };
  }

  const passwordBroker = phpLaravelPasswordBrokerReferenceContextAt(
    source,
    position,
  );

  if (passwordBroker) {
    return { kind: "passwordBroker", prefix: passwordBroker.prefix };
  }

  const logChannel = phpLaravelLogChannelReferenceContextAt(source, position);

  if (logChannel) {
    return { kind: "logChannel", prefix: logChannel.prefix };
  }

  const storageDisk = phpLaravelStorageDiskReferenceContextAt(source, position);

  if (storageDisk) {
    return { kind: "storageDisk", prefix: storageDisk.prefix };
  }

  return null;
}

export function phpLaravelScopedStringCompletionInsertText(
  kind: PhpFrameworkScopedStringCompletionKind,
  name: string,
): string {
  switch (kind) {
    case "authGuard":
      return phpLaravelAuthGuardCompletionInsertText(name);
    case "broadcastConnection":
      return phpLaravelBroadcastConnectionCompletionInsertText(name);
    case "cacheStore":
      return phpLaravelCacheStoreCompletionInsertText(name);
    case "databaseConnection":
      return phpLaravelDatabaseConnectionCompletionInsertText(name);
    case "gateAbility":
      return phpLaravelGateAbilityCompletionInsertText(name);
    case "logChannel":
      return phpLaravelLogChannelCompletionInsertText(name);
    case "mailMailer":
      return phpLaravelMailMailerCompletionInsertText(name);
    case "middlewareAlias":
      return phpLaravelMiddlewareAliasCompletionInsertText(name);
    case "passwordBroker":
      return phpLaravelPasswordBrokerCompletionInsertText(name);
    case "queueConnection":
      return phpLaravelQueueConnectionCompletionInsertText(name);
    case "redisConnection":
      return phpLaravelRedisConnectionCompletionInsertText(name);
    case "storageDisk":
      return phpLaravelStorageDiskCompletionInsertText(name);
  }
}

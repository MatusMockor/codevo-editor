import {
  phpLaravelAuthGuardCompletionInsertText,
  phpLaravelAuthGuardReferenceContextAt,
} from "../domain/phpLaravelAuth";
import {
  phpLaravelGateAbilityCompletionInsertText,
  phpLaravelGateAbilityReferenceContextAt,
} from "../domain/phpLaravelAuthorization";
import {
  phpLaravelBroadcastConnectionCompletionInsertText,
  phpLaravelBroadcastConnectionReferenceContextAt,
} from "../domain/phpLaravelBroadcasting";
import {
  phpLaravelCacheStoreCompletionInsertText,
  phpLaravelCacheStoreReferenceContextAt,
} from "../domain/phpLaravelCache";
import {
  phpLaravelDatabaseConnectionCompletionInsertText,
  phpLaravelDatabaseConnectionReferenceContextAt,
} from "../domain/phpLaravelDatabase";
import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpLaravelLogChannelCompletionInsertText,
  phpLaravelLogChannelReferenceContextAt,
} from "../domain/phpLaravelLog";
import {
  phpLaravelMailMailerCompletionInsertText,
  phpLaravelMailMailerReferenceContextAt,
} from "../domain/phpLaravelMail";
import {
  phpLaravelMiddlewareAliasCompletionInsertText,
  phpLaravelMiddlewareAliasReferenceContextAt,
} from "../domain/phpLaravelMiddleware";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import {
  phpLaravelPasswordBrokerCompletionInsertText,
  phpLaravelPasswordBrokerReferenceContextAt,
} from "../domain/phpLaravelPassword";
import {
  phpLaravelQueueConnectionCompletionInsertText,
  phpLaravelQueueConnectionReferenceContextAt,
} from "../domain/phpLaravelQueue";
import {
  phpLaravelRedisConnectionCompletionInsertText,
  phpLaravelRedisConnectionReferenceContextAt,
} from "../domain/phpLaravelRedis";
import {
  phpLaravelStorageDiskCompletionInsertText,
  phpLaravelStorageDiskReferenceContextAt,
} from "../domain/phpLaravelStorage";
import { getFileName } from "../domain/workspace";
import type {
  PhpLaravelAuthGuardTarget,
  PhpLaravelBroadcastConnectionTarget,
  PhpLaravelCacheStoreTarget,
  PhpLaravelDatabaseConnectionTarget,
  PhpLaravelGateAbilityTarget,
  PhpLaravelLogChannelTarget,
  PhpLaravelMailMailerTarget,
  PhpLaravelMiddlewareAliasTarget,
  PhpLaravelPasswordBrokerTarget,
  PhpLaravelQueueConnectionTarget,
  PhpLaravelRedisConnectionTarget,
  PhpLaravelStorageDiskTarget,
} from "./useLaravelTargets";

export interface PhpFrameworkScopedCompletionDocument {
  path: string;
}

export interface PhpFrameworkScopedCompletionDependencies {
  collectAuthGuardTargets: () => Promise<
    readonly PhpLaravelAuthGuardTarget[]
  >;
  collectBroadcastConnectionTargets: () => Promise<
    readonly PhpLaravelBroadcastConnectionTarget[]
  >;
  collectCacheStoreTargets: () => Promise<
    readonly PhpLaravelCacheStoreTarget[]
  >;
  collectDatabaseConnectionTargets: () => Promise<
    readonly PhpLaravelDatabaseConnectionTarget[]
  >;
  collectGateAbilityTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<readonly PhpLaravelGateAbilityTarget[]>;
  collectLogChannelTargets: () => Promise<
    readonly PhpLaravelLogChannelTarget[]
  >;
  collectMailMailerTargets: () => Promise<
    readonly PhpLaravelMailMailerTarget[]
  >;
  collectMiddlewareAliasTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<readonly PhpLaravelMiddlewareAliasTarget[]>;
  collectPasswordBrokerTargets: () => Promise<
    readonly PhpLaravelPasswordBrokerTarget[]
  >;
  collectQueueConnectionTargets: () => Promise<
    readonly PhpLaravelQueueConnectionTarget[]
  >;
  collectRedisConnectionTargets: () => Promise<
    readonly PhpLaravelRedisConnectionTarget[]
  >;
  collectStorageDiskTargets: () => Promise<
    readonly PhpLaravelStorageDiskTarget[]
  >;
  isRequestStillCurrent: () => boolean;
}

export interface PhpFrameworkScopedCompletionRequest {
  activeDocument: PhpFrameworkScopedCompletionDocument | null;
  isLaravelFrameworkActive: boolean;
  position: EditorPosition;
  source: string;
}

export async function resolvePhpFrameworkScopedCompletions(
  request: PhpFrameworkScopedCompletionRequest,
  dependencies: PhpFrameworkScopedCompletionDependencies,
): Promise<PhpMethodCompletion[] | null> {
  const { activeDocument, isLaravelFrameworkActive, position, source } = request;

  const gateAbilityContext = phpLaravelGateAbilityReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && gateAbilityContext && activeDocument) {
    const normalizedPrefix = gateAbilityContext.prefix.toLowerCase();
    const abilities = await dependencies.collectGateAbilityTargets(
      source,
      activeDocument.path,
    );

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return abilities
      .filter((ability) =>
        ability.name.toLowerCase().startsWith(normalizedPrefix),
      )
      .slice(0, 80)
      .map((ability) => ({
        declaringClassName: ability.relativePath ?? getFileName(ability.path),
        insertText: phpLaravelGateAbilityCompletionInsertText(ability.name),
        kind: "config",
        name: ability.name,
        parameters: "",
        returnType: null,
      }));
  }

  const middlewareAliasContext = phpLaravelMiddlewareAliasReferenceContextAt(
    source,
    position,
  );

  if (
    isLaravelFrameworkActive &&
    middlewareAliasContext &&
    !middlewareAliasContext.aliasParameterStarted &&
    activeDocument
  ) {
    const normalizedPrefix = middlewareAliasContext.alias.toLowerCase();
    const aliases = await dependencies.collectMiddlewareAliasTargets(
      source,
      activeDocument.path,
    );

    if (!dependencies.isRequestStillCurrent()) {
      return [];
    }

    return aliases
      .filter((alias) => alias.name.toLowerCase().startsWith(normalizedPrefix))
      .slice(0, 80)
      .map((alias) => ({
        declaringClassName: alias.relativePath ?? getFileName(alias.path),
        insertText: phpLaravelMiddlewareAliasCompletionInsertText(alias.name),
        kind: "config",
        name: alias.name,
        parameters: "",
        returnType: null,
      }));
  }

  const authGuardContext = phpLaravelAuthGuardReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && authGuardContext && activeDocument) {
    return configDerivedCompletions(
      authGuardContext.prefix,
      dependencies.collectAuthGuardTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.guardName,
      phpLaravelAuthGuardCompletionInsertText,
    );
  }

  const cacheStoreContext = phpLaravelCacheStoreReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && cacheStoreContext && activeDocument) {
    return configDerivedCompletions(
      cacheStoreContext.prefix,
      dependencies.collectCacheStoreTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.storeName,
      phpLaravelCacheStoreCompletionInsertText,
    );
  }

  const databaseConnectionContext =
    phpLaravelDatabaseConnectionReferenceContextAt(source, position);

  if (isLaravelFrameworkActive && databaseConnectionContext && activeDocument) {
    return configDerivedCompletions(
      databaseConnectionContext.prefix,
      dependencies.collectDatabaseConnectionTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.connectionName,
      phpLaravelDatabaseConnectionCompletionInsertText,
    );
  }

  const broadcastConnectionContext =
    phpLaravelBroadcastConnectionReferenceContextAt(source, position);

  if (isLaravelFrameworkActive && broadcastConnectionContext && activeDocument) {
    return configDerivedCompletions(
      broadcastConnectionContext.prefix,
      dependencies.collectBroadcastConnectionTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.connectionName,
      phpLaravelBroadcastConnectionCompletionInsertText,
    );
  }

  const queueConnectionContext =
    phpLaravelQueueConnectionReferenceContextAt(source, position);

  if (isLaravelFrameworkActive && queueConnectionContext && activeDocument) {
    return configDerivedCompletions(
      queueConnectionContext.prefix,
      dependencies.collectQueueConnectionTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.connectionName,
      phpLaravelQueueConnectionCompletionInsertText,
    );
  }

  const redisConnectionContext =
    phpLaravelRedisConnectionReferenceContextAt(source, position);

  if (isLaravelFrameworkActive && redisConnectionContext && activeDocument) {
    return configDerivedCompletions(
      redisConnectionContext.prefix,
      dependencies.collectRedisConnectionTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.connectionName,
      phpLaravelRedisConnectionCompletionInsertText,
    );
  }

  const mailMailerContext = phpLaravelMailMailerReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && mailMailerContext && activeDocument) {
    return configDerivedCompletions(
      mailMailerContext.prefix,
      dependencies.collectMailMailerTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.mailerName,
      phpLaravelMailMailerCompletionInsertText,
    );
  }

  const passwordBrokerContext = phpLaravelPasswordBrokerReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && passwordBrokerContext && activeDocument) {
    return configDerivedCompletions(
      passwordBrokerContext.prefix,
      dependencies.collectPasswordBrokerTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.brokerName,
      phpLaravelPasswordBrokerCompletionInsertText,
    );
  }

  const logChannelContext = phpLaravelLogChannelReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && logChannelContext && activeDocument) {
    return configDerivedCompletions(
      logChannelContext.prefix,
      dependencies.collectLogChannelTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.channelName,
      phpLaravelLogChannelCompletionInsertText,
    );
  }

  const storageDiskContext = phpLaravelStorageDiskReferenceContextAt(
    source,
    position,
  );

  if (isLaravelFrameworkActive && storageDiskContext && activeDocument) {
    return configDerivedCompletions(
      storageDiskContext.prefix,
      dependencies.collectStorageDiskTargets,
      dependencies.isRequestStillCurrent,
      (target) => target.diskName,
      phpLaravelStorageDiskCompletionInsertText,
    );
  }

  return null;
}

async function configDerivedCompletions<Target extends { relativePath: string }>(
  prefix: string,
  collectTargets: () => Promise<readonly Target[]>,
  isRequestStillCurrent: () => boolean,
  nameFromTarget: (target: Target) => string,
  insertTextForName: (name: string) => string,
): Promise<PhpMethodCompletion[]> {
  const normalizedPrefix = prefix.toLowerCase();
  const targets = await collectTargets();

  if (!isRequestStillCurrent()) {
    return [];
  }

  return targets
    .filter((target) =>
      nameFromTarget(target).toLowerCase().startsWith(normalizedPrefix),
    )
    .slice(0, 80)
    .map((target) => {
      const name = nameFromTarget(target);

      return {
        declaringClassName: target.relativePath,
        insertText: insertTextForName(name),
        kind: "config",
        name,
        parameters: "",
        returnType: null,
      };
    });
}

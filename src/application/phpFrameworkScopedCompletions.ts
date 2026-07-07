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

interface PhpFrameworkScopedCompletionHandlerContext {
  activeDocument: PhpFrameworkScopedCompletionDocument | null;
  isRequestStillCurrent: () => boolean;
  position: EditorPosition;
  source: string;
}

type PhpFrameworkScopedCompletionHandler = (
  context: PhpFrameworkScopedCompletionHandlerContext,
) => Promise<PhpMethodCompletion[] | null>;

interface PhpFrameworkScopedCompletionProvider {
  id: string;
  isActive: (request: PhpFrameworkScopedCompletionRequest) => boolean;
  resolve: (
    context: PhpFrameworkScopedCompletionHandlerContext,
    dependencies: PhpFrameworkScopedCompletionDependencies,
  ) => Promise<PhpMethodCompletion[] | null>;
}

export async function resolvePhpFrameworkScopedCompletions(
  request: PhpFrameworkScopedCompletionRequest,
  dependencies: PhpFrameworkScopedCompletionDependencies,
): Promise<PhpMethodCompletion[] | null> {
  const context: PhpFrameworkScopedCompletionHandlerContext = {
    activeDocument: request.activeDocument,
    isRequestStillCurrent: dependencies.isRequestStillCurrent,
    position: request.position,
    source: request.source,
  };

  for (const provider of phpFrameworkScopedCompletionProviders) {
    if (!provider.isActive(request)) {
      continue;
    }

    const completions = await provider.resolve(context, dependencies);

    if (completions !== null) {
      return completions;
    }
  }

  return null;
}

const phpLaravelScopedCompletionProvider: PhpFrameworkScopedCompletionProvider = {
  id: "laravel",
  isActive: (request) => request.isLaravelFrameworkActive,
  resolve: (context, dependencies) =>
    resolveScopedCompletionHandlers(
      [
        createLaravelGateAbilityHandler(dependencies),
        createLaravelMiddlewareAliasHandler(dependencies),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectAuthGuardTargets(),
          insertTextForName: phpLaravelAuthGuardCompletionInsertText,
          nameFromTarget: (target: PhpLaravelAuthGuardTarget) =>
            target.guardName,
          referenceAt: phpLaravelAuthGuardReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectCacheStoreTargets(),
          insertTextForName: phpLaravelCacheStoreCompletionInsertText,
          nameFromTarget: (target: PhpLaravelCacheStoreTarget) =>
            target.storeName,
          referenceAt: phpLaravelCacheStoreReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectDatabaseConnectionTargets(),
          insertTextForName: phpLaravelDatabaseConnectionCompletionInsertText,
          nameFromTarget: (target: PhpLaravelDatabaseConnectionTarget) =>
            target.connectionName,
          referenceAt: phpLaravelDatabaseConnectionReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () =>
            dependencies.collectBroadcastConnectionTargets(),
          insertTextForName: phpLaravelBroadcastConnectionCompletionInsertText,
          nameFromTarget: (target: PhpLaravelBroadcastConnectionTarget) =>
            target.connectionName,
          referenceAt: phpLaravelBroadcastConnectionReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectQueueConnectionTargets(),
          insertTextForName: phpLaravelQueueConnectionCompletionInsertText,
          nameFromTarget: (target: PhpLaravelQueueConnectionTarget) =>
            target.connectionName,
          referenceAt: phpLaravelQueueConnectionReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectRedisConnectionTargets(),
          insertTextForName: phpLaravelRedisConnectionCompletionInsertText,
          nameFromTarget: (target: PhpLaravelRedisConnectionTarget) =>
            target.connectionName,
          referenceAt: phpLaravelRedisConnectionReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectMailMailerTargets(),
          insertTextForName: phpLaravelMailMailerCompletionInsertText,
          nameFromTarget: (target: PhpLaravelMailMailerTarget) =>
            target.mailerName,
          referenceAt: phpLaravelMailMailerReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectPasswordBrokerTargets(),
          insertTextForName: phpLaravelPasswordBrokerCompletionInsertText,
          nameFromTarget: (target: PhpLaravelPasswordBrokerTarget) =>
            target.brokerName,
          referenceAt: phpLaravelPasswordBrokerReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectLogChannelTargets(),
          insertTextForName: phpLaravelLogChannelCompletionInsertText,
          nameFromTarget: (target: PhpLaravelLogChannelTarget) =>
            target.channelName,
          referenceAt: phpLaravelLogChannelReferenceContextAt,
        }),
        createLaravelConfigDerivedHandler({
          collectTargets: () => dependencies.collectStorageDiskTargets(),
          insertTextForName: phpLaravelStorageDiskCompletionInsertText,
          nameFromTarget: (target: PhpLaravelStorageDiskTarget) =>
            target.diskName,
          referenceAt: phpLaravelStorageDiskReferenceContextAt,
        }),
      ],
      context,
    ),
};

const phpFrameworkScopedCompletionProviders: readonly PhpFrameworkScopedCompletionProvider[] =
  [phpLaravelScopedCompletionProvider];

async function resolveScopedCompletionHandlers(
  handlers: readonly PhpFrameworkScopedCompletionHandler[],
  context: PhpFrameworkScopedCompletionHandlerContext,
): Promise<PhpMethodCompletion[] | null> {
  for (const handler of handlers) {
    const completions = await handler(context);

    if (completions !== null) {
      return completions;
    }
  }

  return null;
}

function createLaravelGateAbilityHandler(
  dependencies: PhpFrameworkScopedCompletionDependencies,
): PhpFrameworkScopedCompletionHandler {
  return async ({ activeDocument, isRequestStillCurrent, position, source }) => {
    const gateAbilityContext = phpLaravelGateAbilityReferenceContextAt(
      source,
      position,
    );

    if (!gateAbilityContext || !activeDocument) {
      return null;
    }

    return sourcePathDerivedCompletions(
      gateAbilityContext.prefix,
      () => dependencies.collectGateAbilityTargets(source, activeDocument.path),
      isRequestStillCurrent,
      (target) => target.name,
      phpLaravelGateAbilityCompletionInsertText,
    );
  };
}

function createLaravelMiddlewareAliasHandler(
  dependencies: PhpFrameworkScopedCompletionDependencies,
): PhpFrameworkScopedCompletionHandler {
  return async ({ activeDocument, isRequestStillCurrent, position, source }) => {
    const middlewareAliasContext = phpLaravelMiddlewareAliasReferenceContextAt(
      source,
      position,
    );

    if (
      !middlewareAliasContext ||
      middlewareAliasContext.aliasParameterStarted ||
      !activeDocument
    ) {
      return null;
    }

    return sourcePathDerivedCompletions(
      middlewareAliasContext.alias,
      () =>
        dependencies.collectMiddlewareAliasTargets(
          source,
          activeDocument.path,
        ),
      isRequestStillCurrent,
      (target) => target.name,
      phpLaravelMiddlewareAliasCompletionInsertText,
    );
  };
}

interface LaravelConfigDerivedReference {
  prefix: string;
}

interface LaravelConfigDerivedTarget {
  relativePath: string;
}

function createLaravelConfigDerivedHandler<Target extends LaravelConfigDerivedTarget>({
  collectTargets,
  insertTextForName,
  nameFromTarget,
  referenceAt,
}: {
  collectTargets: () => Promise<readonly Target[]>;
  insertTextForName: (name: string) => string;
  nameFromTarget: (target: Target) => string;
  referenceAt: (
    source: string,
    position: EditorPosition,
  ) => LaravelConfigDerivedReference | null;
}): PhpFrameworkScopedCompletionHandler {
  return async ({ activeDocument, isRequestStillCurrent, position, source }) => {
    const reference = referenceAt(source, position);

    if (!reference || !activeDocument) {
      return null;
    }

    return configDerivedCompletions(
      reference.prefix,
      collectTargets,
      isRequestStillCurrent,
      nameFromTarget,
      insertTextForName,
    );
  };
}

async function sourcePathDerivedCompletions<
  Target extends { path: string; relativePath: string | null },
>(
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
        declaringClassName: target.relativePath ?? getFileName(target.path),
        insertText: insertTextForName(name),
        kind: "config",
        name,
        parameters: "",
        returnType: null,
      };
    });
}

async function configDerivedCompletions<Target extends LaravelConfigDerivedTarget>(
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

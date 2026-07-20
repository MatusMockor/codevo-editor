import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { PhpFrameworkResolvedScopedStringCompletion } from "../domain/phpFrameworkProviders";
import { phpFrameworkScopedStringCompletionAt } from "../domain/phpFrameworkLiteralDispatch";
import { getFileName } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkScopedCompletionDocument {
  path: string;
}

interface PhpFrameworkScopedConfigTarget {
  name: string;
  relativePath: string;
}

export interface PhpFrameworkScopedCompletionDependencies {
  collectAuthGuardTargets: () => Promise<
    readonly { guardName: string; relativePath: string }[]
  >;
  collectBroadcastConnectionTargets: () => Promise<
    readonly { connectionName: string; relativePath: string }[]
  >;
  collectCacheStoreTargets: () => Promise<
    readonly { storeName: string; relativePath: string }[]
  >;
  collectDatabaseConnectionTargets: () => Promise<
    readonly { connectionName: string; relativePath: string }[]
  >;
  collectGateAbilityTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<
    readonly { name: string; path: string; relativePath: string | null }[]
  >;
  collectLogChannelTargets: () => Promise<
    readonly { channelName: string; relativePath: string }[]
  >;
  collectMailMailerTargets: () => Promise<
    readonly { mailerName: string; relativePath: string }[]
  >;
  collectMiddlewareAliasTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<
    readonly { name: string; path: string; relativePath: string | null }[]
  >;
  collectPasswordBrokerTargets: () => Promise<
    readonly { brokerName: string; relativePath: string }[]
  >;
  collectQueueConnectionTargets: () => Promise<
    readonly { connectionName: string; relativePath: string }[]
  >;
  collectRedisConnectionTargets: () => Promise<
    readonly { connectionName: string; relativePath: string }[]
  >;
  collectStorageDiskTargets: () => Promise<
    readonly { diskName: string; relativePath: string }[]
  >;
  isRequestStillCurrent: () => boolean;
}

export interface PhpFrameworkScopedCompletionRequest {
  activeDocument: PhpFrameworkScopedCompletionDocument | null;
  frameworkRuntime: PhpFrameworkRuntimeContext;
  position: EditorPosition;
  source: string;
}

interface PhpFrameworkScopedCompletionHandlerContext {
  activeDocument: PhpFrameworkScopedCompletionDocument | null;
  isRequestStillCurrent: () => boolean;
  source: string;
}

const PLAIN_SCOPED_COMPLETION_BEHAVIOR = {
  insertTextMode: "plain",
  triggerParameterHints: false,
} satisfies PhpMethodCompletion["completionBehavior"];

export async function resolvePhpFrameworkScopedCompletions(
  request: PhpFrameworkScopedCompletionRequest,
  dependencies: PhpFrameworkScopedCompletionDependencies,
): Promise<PhpMethodCompletion[] | null> {
  const context: PhpFrameworkScopedCompletionHandlerContext = {
    activeDocument: request.activeDocument,
    isRequestStillCurrent: dependencies.isRequestStillCurrent,
    source: request.source,
  };

  const scopedCompletion = phpFrameworkScopedStringCompletionAt(
    request.source,
    request.position,
    request.frameworkRuntime.providers,
  );

  if (!scopedCompletion) {
    return null;
  }

  if (scopedCompletion.providerId !== "laravel") {
    return null;
  }

  if (!context.activeDocument) {
    return null;
  }

  return resolveScopedStringCompletion(scopedCompletion, context, dependencies);
}

async function resolveScopedStringCompletion(
  completion: PhpFrameworkResolvedScopedStringCompletion,
  context: PhpFrameworkScopedCompletionHandlerContext,
  dependencies: PhpFrameworkScopedCompletionDependencies,
): Promise<PhpMethodCompletion[]> {
  switch (completion.kind) {
    case "authGuard":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectAuthGuardTargets()).map((target) => ({
            name: target.guardName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "broadcastConnection":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectBroadcastConnectionTargets()).map(
            (target) => ({
              name: target.connectionName,
              relativePath: target.relativePath,
            }),
          ),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "cacheStore":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectCacheStoreTargets()).map((target) => ({
            name: target.storeName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "databaseConnection":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectDatabaseConnectionTargets()).map(
            (target) => ({
              name: target.connectionName,
              relativePath: target.relativePath,
            }),
          ),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "logChannel":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectLogChannelTargets()).map((target) => ({
            name: target.channelName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "mailMailer":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectMailMailerTargets()).map((target) => ({
            name: target.mailerName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "passwordBroker":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectPasswordBrokerTargets()).map((target) => ({
            name: target.brokerName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "queueConnection":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectQueueConnectionTargets()).map((target) => ({
            name: target.connectionName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "redisConnection":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectRedisConnectionTargets()).map((target) => ({
            name: target.connectionName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "storageDisk":
      return configDerivedCompletions(
        completion.prefix,
        async () =>
          (await dependencies.collectStorageDiskTargets()).map((target) => ({
            name: target.diskName,
            relativePath: target.relativePath,
          })),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "gateAbility":
      return sourcePathDerivedCompletions(
        completion.prefix,
        () =>
          dependencies.collectGateAbilityTargets(
            context.source,
            context.activeDocument?.path ?? "",
          ),
        context.isRequestStillCurrent,
        completion.insertText,
      );
    case "middlewareAlias":
      return sourcePathDerivedCompletions(
        completion.prefix,
        () =>
          dependencies.collectMiddlewareAliasTargets(
            context.source,
            context.activeDocument?.path ?? "",
          ),
        context.isRequestStillCurrent,
        completion.insertText,
      );
  }
}

async function sourcePathDerivedCompletions<
  Target extends { name: string; path: string; relativePath: string | null },
>(
  prefix: string,
  collectTargets: () => Promise<readonly Target[]>,
  isRequestStillCurrent: () => boolean,
  insertTextForName: (name: string) => string,
): Promise<PhpMethodCompletion[]> {
  const normalizedPrefix = prefix.toLowerCase();
  const targets = await collectTargets();

  if (!isRequestStillCurrent()) {
    return [];
  }

  return targets
    .filter((target) =>
      target.name.toLowerCase().startsWith(normalizedPrefix),
    )
    .slice(0, 80)
    .map((target) => {
      const { name } = target;

      return {
        completionBehavior: PLAIN_SCOPED_COMPLETION_BEHAVIOR,
        declaringClassName: target.relativePath ?? getFileName(target.path),
        insertText: insertTextForName(name),
        kind: "config",
        name,
        parameters: "",
        returnType: null,
      };
    });
}

async function configDerivedCompletions<Target extends PhpFrameworkScopedConfigTarget>(
  prefix: string,
  collectTargets: () => Promise<readonly Target[]>,
  isRequestStillCurrent: () => boolean,
  insertTextForName: (name: string) => string,
): Promise<PhpMethodCompletion[]> {
  const normalizedPrefix = prefix.toLowerCase();
  const targets = await collectTargets();

  if (!isRequestStillCurrent()) {
    return [];
  }

  return targets
    .filter((target) =>
      target.name.toLowerCase().startsWith(normalizedPrefix),
    )
    .slice(0, 80)
    .map((target) => {
      const { name } = target;

      return {
        completionBehavior: PLAIN_SCOPED_COMPLETION_BEHAVIOR,
        declaringClassName: target.relativePath,
        insertText: insertTextForName(name),
        kind: "config",
        name,
        parameters: "",
        returnType: null,
      };
    });
}

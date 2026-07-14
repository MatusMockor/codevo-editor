import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  isPhpFrameworkProviderActive,
  phpFrameworkStringLiteralHelperAt,
  type PhpFrameworkProvider,
  type PhpFrameworkStringLiteralHelperMatch,
} from "../domain/phpFrameworkProviders";
import { PHP_FRAMEWORK_LITERAL_DEFINITION_RESOLVER_CONTRIBUTIONS } from "./phpFrameworkLiteralDefinitionResolverContributions";

export interface PhpFrameworkLiteralNavigationDocument {
  content: string;
  path: string;
}

export interface PhpFrameworkLiteralNavigationTarget {
  kind:
    | "authGuard"
    | "broadcastConnection"
    | "cacheStore"
    | "config"
    | "databaseConnection"
    | "env"
    | "inertia"
    | "nette.ajax-snippet"
    | "logChannel"
    | "mailMailer"
    | "passwordBroker"
    | "queueConnection"
    | "redisConnection"
    | "route"
    | "storageDisk"
    | "translation"
    | "validationTable"
    | "view";
  label: string;
  path: string;
  position: EditorPosition;
}

export interface PhpFrameworkLiteralRouteTarget {
  name: string;
  path: string;
  position: EditorPosition;
}

export interface PhpFrameworkLiteralNavigationDependencies {
  collectNamedRouteTargets: (
    currentSource: string,
    currentPath: string,
  ) => Promise<readonly PhpFrameworkLiteralRouteTarget[]>;
  findConfigTarget: (
    configKey: string,
  ) => Promise<{ key: string; path: string; position: EditorPosition } | null>;
  findAuthGuardTarget?: (
    guardName: string,
  ) => Promise<
    { guardName: string; path: string; position: EditorPosition } | null
  >;
  findBroadcastConnectionTarget?: (
    connectionName: string,
  ) => Promise<
    { connectionName: string; path: string; position: EditorPosition } | null
  >;
  findCacheStoreTarget?: (
    storeName: string,
  ) => Promise<
    { storeName: string; path: string; position: EditorPosition } | null
  >;
  findDatabaseConnectionTarget?: (
    connectionName: string,
  ) => Promise<
    { connectionName: string; path: string; position: EditorPosition } | null
  >;
  findEnvTarget: (
    envName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
  findInertiaComponentTarget?: (
    componentName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
  findLogChannelTarget?: (
    channelName: string,
  ) => Promise<
    { channelName: string; path: string; position: EditorPosition } | null
  >;
  findMailMailerTarget?: (
    mailerName: string,
  ) => Promise<
    { mailerName: string; path: string; position: EditorPosition } | null
  >;
  findNetteRedrawControlSnippetTarget?: (
    currentPath: string,
    snippetName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
  findPasswordBrokerTarget?: (
    brokerName: string,
  ) => Promise<
    { brokerName: string; path: string; position: EditorPosition } | null
  >;
  findQueueConnectionTarget?: (
    connectionName: string,
  ) => Promise<
    { connectionName: string; path: string; position: EditorPosition } | null
  >;
  findRedisConnectionTarget?: (
    connectionName: string,
  ) => Promise<
    { connectionName: string; path: string; position: EditorPosition } | null
  >;
  findStorageDiskTarget?: (
    diskName: string,
  ) => Promise<
    { diskName: string; path: string; position: EditorPosition } | null
  >;
  findValidationRuleModelTargets?: (
    tableName: string,
  ) => Promise<
    readonly { label: string; path: string; position: EditorPosition }[]
  >;
  findTranslationTarget: (
    translationKey: string,
  ) => Promise<{ key: string; path: string; position: EditorPosition } | null>;
  findViewTarget: (
    viewName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
}

export interface PhpFrameworkDirectLiteralDefinitionRequest {
  activeDocument: PhpFrameworkLiteralNavigationDocument | null;
  directHelperMatch?: PhpFrameworkStringLiteralHelperMatch | null;
  offset: number;
  position: EditorPosition;
  providers: readonly PhpFrameworkProvider[];
  source: string;
}

export type PhpContextualFrameworkLiteralDefinitionRequest =
  | {
      kind: "route";
      name: string;
    }
  | {
      key: string;
      kind: "config";
    }
  | {
      guardName: string;
      kind: "authGuard";
    }
  | {
      connectionName: string;
      kind: "broadcastConnection";
    }
  | {
      kind: "cacheStore";
      storeName: string;
    }
  | {
      connectionName: string;
      kind: "databaseConnection";
    }
  | {
      kind: "env";
      name: string;
    }
  | {
      channelName: string;
      kind: "logChannel";
    }
  | {
      kind: "mailMailer";
      mailerName: string;
    }
  | {
      brokerName: string;
      kind: "passwordBroker";
    }
  | {
      connectionName: string;
      kind: "queueConnection";
    }
  | {
      connectionName: string;
      kind: "redisConnection";
    }
  | {
      key: string;
      kind: "translation";
    }
  | {
      diskName: string;
      kind: "storageDisk";
    }
  | {
      kind: "view";
      name: string;
    }
  | {
      kind: "validationTable";
      tableName: string;
    };

export interface PhpFrameworkDirectLiteralDefinitionResolverContext
  extends PhpFrameworkDirectLiteralDefinitionRequest {
  helperMatch(): PhpFrameworkStringLiteralHelperMatch | null;
}

export interface PhpFrameworkContextualLiteralDefinitionResolverContext {
  activeDocument: PhpFrameworkLiteralNavigationDocument;
  providers: readonly PhpFrameworkProvider[];
  request: PhpContextualFrameworkLiteralDefinitionRequest;
}

export type PhpFrameworkLiteralDefinitionResolverResult =
  | PhpFrameworkLiteralNavigationTarget
  | null
  | undefined;

export interface PhpFrameworkLiteralDefinitionResolverEntry {
  readonly id: string;
  resolveContextual?(
    context: PhpFrameworkContextualLiteralDefinitionResolverContext,
    dependencies: PhpFrameworkLiteralNavigationDependencies,
  ): Promise<PhpFrameworkLiteralDefinitionResolverResult>;
  resolveDirect?(
    context: PhpFrameworkDirectLiteralDefinitionResolverContext,
    dependencies: PhpFrameworkLiteralNavigationDependencies,
  ): Promise<PhpFrameworkLiteralDefinitionResolverResult>;
}

export interface PhpFrameworkLiteralDefinitionResolverContribution {
  readonly entries: readonly PhpFrameworkLiteralDefinitionResolverEntry[];
  readonly providerId: string;
}

export function activePhpFrameworkLiteralDefinitionResolverEntries(
  providers: readonly PhpFrameworkProvider[],
): readonly PhpFrameworkLiteralDefinitionResolverEntry[] {
  return PHP_FRAMEWORK_LITERAL_DEFINITION_RESOLVER_CONTRIBUTIONS.filter(
    (contribution) =>
      isPhpFrameworkProviderActive(providers, contribution.providerId),
  ).flatMap((contribution) => contribution.entries);
}

export async function resolvePhpFrameworkDirectLiteralDefinitionTarget(
  request: PhpFrameworkDirectLiteralDefinitionRequest,
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null> {
  let helperMatch: PhpFrameworkStringLiteralHelperMatch | null | undefined =
    request.directHelperMatch;
  const context: PhpFrameworkDirectLiteralDefinitionResolverContext = {
    ...request,
    helperMatch: () => {
      if (helperMatch === undefined) {
        helperMatch = phpFrameworkStringLiteralHelperAt(
          request.source,
          request.offset,
          request.providers,
        );
      }

      return helperMatch;
    },
  };

  for (const resolver of activePhpFrameworkLiteralDefinitionResolverEntries(
    request.providers,
  )) {
    const target = await resolver.resolveDirect?.(context, dependencies);

    if (target !== undefined) {
      return target;
    }
  }

  return null;
}

export async function resolvePhpFrameworkContextualLiteralDefinitionTarget(
  request: PhpContextualFrameworkLiteralDefinitionRequest,
  activeDocument: PhpFrameworkLiteralNavigationDocument,
  providers: readonly PhpFrameworkProvider[],
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null | undefined> {
  const context: PhpFrameworkContextualLiteralDefinitionResolverContext = {
    activeDocument,
    providers,
    request,
  };

  for (const resolver of activePhpFrameworkLiteralDefinitionResolverEntries(
    providers,
  )) {
    const target = await resolver.resolveContextual?.(context, dependencies);

    if (target !== undefined) {
      return target;
    }
  }

  return undefined;
}

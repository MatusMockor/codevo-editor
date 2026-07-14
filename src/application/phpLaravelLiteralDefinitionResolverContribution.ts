import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkConfigLiteralTarget,
  phpFrameworkEnvLiteralTarget,
  phpFrameworkInertiaLiteralTarget,
  phpFrameworkInertiaReferenceAt,
  phpFrameworkViewLiteralTarget,
  phpFrameworkViewReferenceAt,
} from "../domain/phpFrameworkProviders";
import type {
  PhpContextualFrameworkLiteralDefinitionRequest,
  PhpFrameworkLiteralDefinitionResolverContribution,
  PhpFrameworkLiteralDefinitionResolverEntry,
  PhpFrameworkLiteralNavigationDependencies,
  PhpFrameworkLiteralNavigationDocument,
  PhpFrameworkLiteralNavigationTarget,
} from "./phpFrameworkLiteralDefinitionResolverRegistry";
import { phpTranslationLiteralDefinitionResolver } from "./phpTranslationLiteralDefinitionResolver";

type LaravelConfigDerivedLiteralTarget = {
  brokerName?: string;
  channelName?: string;
  connectionName?: string;
  diskName?: string;
  guardName?: string;
  mailerName?: string;
  path: string;
  position: EditorPosition;
  storeName?: string;
};

type LaravelConfigDerivedLiteralRequestNameKey =
  | "brokerName"
  | "channelName"
  | "connectionName"
  | "diskName"
  | "guardName"
  | "mailerName"
  | "storeName";

type LaravelConfigDerivedLiteralFinderKey =
  | "findAuthGuardTarget"
  | "findBroadcastConnectionTarget"
  | "findCacheStoreTarget"
  | "findDatabaseConnectionTarget"
  | "findLogChannelTarget"
  | "findMailMailerTarget"
  | "findPasswordBrokerTarget"
  | "findQueueConnectionTarget"
  | "findRedisConnectionTarget"
  | "findStorageDiskTarget";

type LaravelConfigDerivedLiteralFinder = (
  name: string,
) => Promise<LaravelConfigDerivedLiteralTarget | null>;

interface LaravelConfigDerivedLiteralDefinition {
  readonly finderKey: LaravelConfigDerivedLiteralFinderKey;
  readonly id: string;
  readonly nameKey: LaravelConfigDerivedLiteralRequestNameKey;
  readonly requestKind: LaravelConfigDerivedLiteralRequest["kind"];
}

type LaravelConfigDerivedLiteralRequest = Extract<
  PhpContextualFrameworkLiteralDefinitionRequest,
  {
    kind:
      | "authGuard"
      | "broadcastConnection"
      | "cacheStore"
      | "databaseConnection"
      | "logChannel"
      | "mailMailer"
      | "passwordBroker"
      | "queueConnection"
      | "redisConnection"
      | "storageDisk";
  }
>;

const LARAVEL_CONFIG_DERIVED_LITERAL_DEFINITIONS: readonly LaravelConfigDerivedLiteralDefinition[] =
  [
    {
      finderKey: "findAuthGuardTarget",
      id: "laravel.auth-guard",
      nameKey: "guardName",
      requestKind: "authGuard",
    },
    {
      finderKey: "findBroadcastConnectionTarget",
      id: "laravel.broadcast-connection",
      nameKey: "connectionName",
      requestKind: "broadcastConnection",
    },
    {
      finderKey: "findCacheStoreTarget",
      id: "laravel.cache-store",
      nameKey: "storeName",
      requestKind: "cacheStore",
    },
    {
      finderKey: "findDatabaseConnectionTarget",
      id: "laravel.database-connection",
      nameKey: "connectionName",
      requestKind: "databaseConnection",
    },
    {
      finderKey: "findLogChannelTarget",
      id: "laravel.log-channel",
      nameKey: "channelName",
      requestKind: "logChannel",
    },
    {
      finderKey: "findMailMailerTarget",
      id: "laravel.mail-mailer",
      nameKey: "mailerName",
      requestKind: "mailMailer",
    },
    {
      finderKey: "findPasswordBrokerTarget",
      id: "laravel.password-broker",
      nameKey: "brokerName",
      requestKind: "passwordBroker",
    },
    {
      finderKey: "findQueueConnectionTarget",
      id: "laravel.queue-connection",
      nameKey: "connectionName",
      requestKind: "queueConnection",
    },
    {
      finderKey: "findRedisConnectionTarget",
      id: "laravel.redis-connection",
      nameKey: "connectionName",
      requestKind: "redisConnection",
    },
    {
      finderKey: "findStorageDiskTarget",
      id: "laravel.storage-disk",
      nameKey: "diskName",
      requestKind: "storageDisk",
    },
  ];

const LARAVEL_CONFIG_DERIVED_LITERAL_DEFINITION_RESOLVERS: readonly PhpFrameworkLiteralDefinitionResolverEntry[] =
  LARAVEL_CONFIG_DERIVED_LITERAL_DEFINITIONS.map((definition) => ({
    id: definition.id,
    resolveContextual: async ({ request }, dependencies) => {
      if (request.kind !== definition.requestKind) {
        return undefined;
      }

      const finder = dependencies[
        definition.finderKey
      ] as LaravelConfigDerivedLiteralFinder | undefined;
      const literalRequest = request as LaravelConfigDerivedLiteralRequest &
        Record<LaravelConfigDerivedLiteralRequestNameKey, string>;
      const target = finder
        ? await finder(literalRequest[definition.nameKey])
        : null;

      return target
        ? {
            kind: definition.requestKind,
            label: target[definition.nameKey] ?? "",
            path: target.path,
            position: target.position,
          }
        : null;
    },
  }));

const LARAVEL_LITERAL_DEFINITION_RESOLVERS: readonly PhpFrameworkLiteralDefinitionResolverEntry[] =
  [
    {
      id: "laravel.inertia-reference",
      resolveDirect: async ({ position, providers, source }, dependencies) => {
        const reference = phpFrameworkInertiaReferenceAt(
          source,
          position,
          providers,
        );

        if (!reference) {
          return undefined;
        }

        if (!phpFrameworkInertiaLiteralTarget(reference.name, providers)) {
          return null;
        }

        const target = await dependencies.findInertiaComponentTarget?.(
          reference.name,
        );

        return target
          ? {
              kind: "inertia",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
    {
      id: "laravel.view-reference",
      resolveDirect: async ({ position, providers, source }, dependencies) => {
        const reference = phpFrameworkViewReferenceAt(
          source,
          position,
          providers,
        );

        if (!reference) {
          return undefined;
        }

        const target = await dependencies.findViewTarget(reference.name);

        return target
          ? {
              kind: "view",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
    {
      id: "laravel.config",
      resolveDirect: async ({ helperMatch, providers }, dependencies) => {
        const match = helperMatch();

        if (match?.helper !== "config") {
          return undefined;
        }

        if (!phpFrameworkConfigLiteralTarget(match.literal, providers)) {
          return null;
        }

        const target = await dependencies.findConfigTarget(match.literal);

        return target
          ? {
              kind: "config",
              label: target.key,
              path: target.path,
              position: target.position,
            }
          : null;
      },
      resolveContextual: async ({ request }, dependencies) => {
        if (request.kind !== "config") {
          return undefined;
        }

        const target = await dependencies.findConfigTarget(request.key);

        return target
          ? {
              kind: "config",
              label: target.key,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
    {
      id: "laravel.view",
      resolveDirect: async ({ helperMatch, providers }, dependencies) => {
        const match = helperMatch();

        if (match?.helper !== "view") {
          return undefined;
        }

        if (!phpFrameworkViewLiteralTarget(match.literal, providers)) {
          return null;
        }

        const target = await dependencies.findViewTarget(match.literal);

        return target
          ? {
              kind: "view",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
      resolveContextual: async ({ request }, dependencies) => {
        if (request.kind !== "view") {
          return undefined;
        }

        const target = await dependencies.findViewTarget(request.name);

        return target
          ? {
              kind: "view",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
    phpTranslationLiteralDefinitionResolver,
    {
      id: "laravel.env",
      resolveDirect: async ({ helperMatch, providers }, dependencies) => {
        const match = helperMatch();

        if (match?.helper !== "env") {
          return undefined;
        }

        if (!phpFrameworkEnvLiteralTarget(match.literal, providers)) {
          return null;
        }

        const target = await dependencies.findEnvTarget(match.literal);

        return target
          ? {
              kind: "env",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
      resolveContextual: async ({ request }, dependencies) => {
        if (request.kind !== "env") {
          return undefined;
        }

        const target = await dependencies.findEnvTarget(request.name);

        return target
          ? {
              kind: "env",
              label: target.name,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
    {
      id: "laravel.route",
      resolveDirect: async ({ activeDocument, helperMatch }, dependencies) => {
        const match = helperMatch();

        if (match?.helper !== "route") {
          return undefined;
        }

        if (!activeDocument) {
          return null;
        }

        return resolveRouteTarget(
          match.literal,
          activeDocument,
          dependencies,
        );
      },
      resolveContextual: async (
        { activeDocument, request },
        dependencies,
      ) => {
        if (request.kind !== "route") {
          return undefined;
        }

        return resolveRouteTarget(request.name, activeDocument, dependencies);
      },
    },
    ...LARAVEL_CONFIG_DERIVED_LITERAL_DEFINITION_RESOLVERS,
    {
      id: "laravel.validation-table",
      resolveContextual: async ({ request }, dependencies) => {
        if (request.kind !== "validationTable") {
          return undefined;
        }

        const targets =
          await dependencies.findValidationRuleModelTargets?.(
            request.tableName,
          );
        const target = targets?.[0];

        return target
          ? {
              kind: "validationTable",
              label: target.label,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
  ];

export const phpLaravelLiteralDefinitionResolverContribution: PhpFrameworkLiteralDefinitionResolverContribution =
  {
    entries: LARAVEL_LITERAL_DEFINITION_RESOLVERS,
    providerId: "laravel",
  };

async function resolveRouteTarget(
  routeName: string,
  activeDocument: PhpFrameworkLiteralNavigationDocument,
  dependencies: PhpFrameworkLiteralNavigationDependencies,
): Promise<PhpFrameworkLiteralNavigationTarget | null> {
  const routes = await dependencies.collectNamedRouteTargets(
    activeDocument.content,
    activeDocument.path,
  );
  const target = routes.find(
    (route) => route.name.toLowerCase() === routeName.toLowerCase(),
  );

  return target
    ? {
        kind: "route",
        label: target.name,
        path: target.path,
        position: target.position,
      }
    : null;
}

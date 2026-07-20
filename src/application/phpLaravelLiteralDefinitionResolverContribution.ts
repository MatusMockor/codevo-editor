import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  phpFrameworkConfigMissingTargetMessage,
  phpFrameworkConfigLiteralTarget,
  phpFrameworkEnvMissingTargetMessage,
  phpFrameworkEnvLiteralTarget,
  phpFrameworkInertiaLiteralTarget,
  phpFrameworkInertiaReferenceAt,
  phpFrameworkRouteMissingTargetMessage,
} from "../domain/phpFrameworkLiteralDispatch";
import {
  phpFrameworkViewMissingTargetMessage,
  phpFrameworkViewLiteralTarget,
  phpFrameworkViewReferenceAt,
} from "../domain/phpFrameworkTemplateDispatch";
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
  readonly missingMessage: (
    request: LaravelConfigDerivedLiteralRequest &
      Record<LaravelConfigDerivedLiteralRequestNameKey, string>,
  ) => string;
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
      missingMessage: (request) =>
        `No Laravel auth guard ${request.guardName} found.`,
      nameKey: "guardName",
      requestKind: "authGuard",
    },
    {
      finderKey: "findBroadcastConnectionTarget",
      id: "laravel.broadcast-connection",
      missingMessage: (request) =>
        `No Laravel broadcast connection ${request.connectionName} found.`,
      nameKey: "connectionName",
      requestKind: "broadcastConnection",
    },
    {
      finderKey: "findCacheStoreTarget",
      id: "laravel.cache-store",
      missingMessage: (request) =>
        `No Laravel cache store ${request.storeName} found.`,
      nameKey: "storeName",
      requestKind: "cacheStore",
    },
    {
      finderKey: "findDatabaseConnectionTarget",
      id: "laravel.database-connection",
      missingMessage: (request) =>
        `No Laravel database connection ${request.connectionName} found.`,
      nameKey: "connectionName",
      requestKind: "databaseConnection",
    },
    {
      finderKey: "findLogChannelTarget",
      id: "laravel.log-channel",
      missingMessage: (request) =>
        `No Laravel log channel ${request.channelName} found.`,
      nameKey: "channelName",
      requestKind: "logChannel",
    },
    {
      finderKey: "findMailMailerTarget",
      id: "laravel.mail-mailer",
      missingMessage: (request) =>
        `No Laravel mailer ${request.mailerName} found.`,
      nameKey: "mailerName",
      requestKind: "mailMailer",
    },
    {
      finderKey: "findPasswordBrokerTarget",
      id: "laravel.password-broker",
      missingMessage: (request) =>
        `No Laravel password broker ${request.brokerName} found.`,
      nameKey: "brokerName",
      requestKind: "passwordBroker",
    },
    {
      finderKey: "findQueueConnectionTarget",
      id: "laravel.queue-connection",
      missingMessage: (request) =>
        `No Laravel queue connection ${request.connectionName} found.`,
      nameKey: "connectionName",
      requestKind: "queueConnection",
    },
    {
      finderKey: "findRedisConnectionTarget",
      id: "laravel.redis-connection",
      missingMessage: (request) =>
        `No Laravel redis connection ${request.connectionName} found.`,
      nameKey: "connectionName",
      requestKind: "redisConnection",
    },
    {
      finderKey: "findStorageDiskTarget",
      id: "laravel.storage-disk",
      missingMessage: (request) =>
        `No Laravel storage disk ${request.diskName} found.`,
      nameKey: "diskName",
      requestKind: "storageDisk",
    },
  ];

const LARAVEL_CONFIG_DERIVED_LITERAL_DEFINITION_RESOLVERS: readonly PhpFrameworkLiteralDefinitionResolverEntry[] =
  LARAVEL_CONFIG_DERIVED_LITERAL_DEFINITIONS.map((definition) => ({
    id: definition.id,
    missingContextualMessage: ({ request }) => {
      if (request.kind !== definition.requestKind) {
        return undefined;
      }

      const literalRequest = request as LaravelConfigDerivedLiteralRequest &
        Record<LaravelConfigDerivedLiteralRequestNameKey, string>;

      return definition.missingMessage(literalRequest);
    },
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
      missingContextualMessage: ({ providers, request }) => {
        if (request.kind !== "config") {
          return undefined;
        }

        return phpFrameworkConfigMissingTargetMessage(request.key, providers);
      },
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
      missingContextualMessage: ({ providers, request }) => {
        if (request.kind !== "view") {
          return undefined;
        }

        return phpFrameworkViewMissingTargetMessage(request.name, providers);
      },
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
      missingContextualMessage: ({ providers, request }) => {
        if (request.kind !== "env") {
          return undefined;
        }

        return phpFrameworkEnvMissingTargetMessage(request.name, providers);
      },
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
      missingContextualMessage: ({ providers, request }) => {
        if (request.kind !== "route") {
          return undefined;
        }

        return phpFrameworkRouteMissingTargetMessage(request.name, providers);
      },
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
      missingContextualMessage: ({ request }) =>
        request.kind === "validationTable" ? null : undefined,
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

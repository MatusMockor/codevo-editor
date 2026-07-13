import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  isPhpFrameworkProviderActive,
  phpFrameworkConfigLiteralTarget,
  phpFrameworkEnvLiteralTarget,
  phpFrameworkInertiaLiteralTarget,
  phpFrameworkInertiaReferenceAt,
  phpFrameworkStringLiteralHelperAt,
  phpFrameworkTranslationLiteralTarget,
  phpFrameworkViewLiteralTarget,
  phpFrameworkViewReferenceAt,
  type PhpFrameworkProvider,
  type PhpFrameworkStringLiteralHelperMatch,
} from "../domain/phpFrameworkProviders";

export interface PhpFrameworkLiteralNavigationDocument {
  content: string;
  path: string;
}

export interface PhpFrameworkLiteralNavigationTarget {
  kind:
    | "config"
    | "env"
    | "inertia"
    | "route"
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
  findEnvTarget: (
    envName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
  findInertiaComponentTarget?: (
    componentName: string,
  ) => Promise<{ name: string; path: string; position: EditorPosition } | null>;
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
      missingMessage: string;
      name: string;
    }
  | {
      key: string;
      kind: "config";
      missingMessage: string;
    }
  | {
      kind: "env";
      missingMessage: string;
      name: string;
    }
  | {
      key: string;
      kind: "translation";
      missingMessage: string;
    }
  | {
      kind: "view";
      missingMessage: string;
      name: string;
    }
  | {
      kind: "validationTable";
      tableName: string;
    };

interface PhpFrameworkDirectLiteralDefinitionResolverContext
  extends PhpFrameworkDirectLiteralDefinitionRequest {
  helperMatch(): PhpFrameworkStringLiteralHelperMatch | null;
}

interface PhpFrameworkContextualLiteralDefinitionResolverContext {
  activeDocument: PhpFrameworkLiteralNavigationDocument;
  providers: readonly PhpFrameworkProvider[];
  request: PhpContextualFrameworkLiteralDefinitionRequest;
}

type PhpFrameworkLiteralDefinitionResolverResult =
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

interface PhpFrameworkLiteralDefinitionResolverContribution {
  readonly entries: readonly PhpFrameworkLiteralDefinitionResolverEntry[];
  readonly providerId: string;
}

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
    {
      id: "laravel.translation",
      resolveDirect: async ({ helperMatch, providers }, dependencies) => {
        const match = helperMatch();

        if (match?.helper !== "trans") {
          return undefined;
        }

        if (!phpFrameworkTranslationLiteralTarget(match.literal, providers)) {
          return null;
        }

        const target = await dependencies.findTranslationTarget(match.literal);

        return target
          ? {
              kind: "translation",
              label: target.key,
              path: target.path,
              position: target.position,
            }
          : null;
      },
      resolveContextual: async ({ request }, dependencies) => {
        if (request.kind !== "translation") {
          return undefined;
        }

        const target = await dependencies.findTranslationTarget(request.key);

        return target
          ? {
              kind: "translation",
              label: target.key,
              path: target.path,
              position: target.position,
            }
          : null;
      },
    },
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

const PHP_FRAMEWORK_LITERAL_DEFINITION_RESOLVER_CONTRIBUTIONS: readonly PhpFrameworkLiteralDefinitionResolverContribution[] =
  [
    {
      entries: LARAVEL_LITERAL_DEFINITION_RESOLVERS,
      providerId: "laravel",
    },
  ];

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

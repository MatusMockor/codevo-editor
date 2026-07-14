import type {
  PhpFrameworkAuthorizationAbilityDefinition,
  PhpFrameworkDispatchTarget,
  PhpFrameworkMiddlewareAliasDefinition,
  PhpFrameworkProvider,
  PhpFrameworkRouteCompletionContext,
  PhpFrameworkRouteDefinition,
  PhpFrameworkRouteModelBinding,
  PhpFrameworkRouteReference,
  PhpFrameworkTargetCollectionKind,
} from "./phpFrameworkProviders";
import {
  defaultPhpFrameworkProviders,
} from "./phpFrameworkProviderDefaults";
import type { EditorPosition } from "./languageServerFeatures";
import type { PhpProjectDescriptor } from "./workspace";

/**
 * First named-route reference detected at the cursor across the active
 * providers. Exclusive resolution keeps this to at most one provider today, so
 * the first non-null match wins and non-route providers are inert.
 */
export function phpFrameworkRouteReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkRouteReference | null {
  return phpFrameworkRouteCompletionContextAt(source, position, providers)
    ?.reference ?? null;
}

export function phpFrameworkRouteCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkRouteCompletionContext | null {
  for (const provider of providers) {
    const reference = provider.routes?.referenceAt?.({ position, source });

    if (reference) {
      return { provider, reference };
    }
  }

  return null;
}

/**
 * Named-route definitions declared in a single source, aggregated across the
 * active providers. Providers without a routes capability contribute nothing.
 */
export function phpFrameworkRouteDefinitionsFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkRouteDefinition[] {
  return providers.flatMap(
    (provider) => provider.routes?.definitionsFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkRouteModelBindingAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkRouteModelBinding | null {
  for (const provider of providers) {
    const binding = provider.routes?.modelBindingAt?.({ offset, source });

    if (binding) {
      return binding;
    }
  }

  return null;
}

export function phpFrameworkExplicitRouteModelBindingClassName(
  source: string,
  parameterName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string | null {
  for (const provider of providers) {
    const className =
      provider.routes?.explicitModelBindingClassNameFromSource?.({
        parameterName,
        source,
      });

    if (className) {
      return className;
    }
  }

  return null;
}

export function phpFrameworkExplicitRouteModelBindingSearchQueries(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return providers.flatMap(
    (provider) => provider.routes?.explicitModelBindingSearchQueries ?? [],
  );
}

export function phpFrameworkModelNamespacePrefixes(
  php: PhpProjectDescriptor | null | undefined,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string[] {
  const prefixes: string[] = [];

  for (const provider of providers) {
    prefixes.push(...(provider.routes?.modelNamespacePrefixes?.({ php }) ?? []));
  }

  return prefixes;
}

/**
 * Text-search anchors the active providers use to surface route declarations in
 * other files. Empty when no active provider ships routes.
 */
export function phpFrameworkRouteSearchQueries(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return phpFrameworkTargetSearchQueries("routes", providers);
}

/**
 * Whether any active provider ships a routes capability - the framework-agnostic
 * gate that replaces the hardcoded `isLaravelFrameworkActive` route checks.
 */
export function phpFrameworkSupportsRoutes(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.routes !== undefined);
}

export function phpFrameworkAuthorizationAbilityDefinitionsFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkAuthorizationAbilityDefinition[] {
  return providers.flatMap(
    (provider) =>
      provider.authorizationAbilities?.definitionsFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkAuthorizationAbilitySearchQueries(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return providers.flatMap(
    (provider) => provider.authorizationAbilities?.searchQueries ?? [],
  );
}

export function phpFrameworkSupportsAuthorizationAbilities(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) => provider.authorizationAbilities !== undefined,
  );
}

export function phpFrameworkMiddlewareAliasDefinitionsFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkMiddlewareAliasDefinition[] {
  return providers.flatMap(
    (provider) =>
      provider.middlewareAliases?.definitionsFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkMiddlewareAliasSearchQueries(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return providers.flatMap(
    (provider) => provider.middlewareAliases?.searchQueries ?? [],
  );
}

export function phpFrameworkSupportsMiddlewareAliases(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.middlewareAliases !== undefined);
}

export function phpFrameworkDispatchTargetAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkDispatchTarget | null {
  for (const provider of providers) {
    const target = provider.dispatch?.targetAt?.({ offset, source });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkEventListenerMapFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): Map<string, string[]> {
  for (const provider of providers) {
    const map = provider.dispatch?.eventListenerMapFromSource?.({ source });

    if (map && map.size > 0) {
      return map;
    }
  }

  return new Map();
}

export function phpFrameworkEventServiceProviderClassNames(
  php: PhpProjectDescriptor | null | undefined,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string[] {
  const classNames: string[] = [];

  for (const provider of providers) {
    classNames.push(
      ...(provider.dispatch?.eventServiceProviderClassNames?.({ php }) ?? []),
    );
  }

  return classNames;
}

export function phpFrameworkSupportsDispatch(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.dispatch !== undefined);
}

export function phpFrameworkTargetSearchQueries(
  kind: PhpFrameworkTargetCollectionKind,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return providers.flatMap((provider) => {
    const queries =
      provider.targetCollections
        ?.filter((collection) => collection.kind === kind)
        .flatMap((collection) => collection.searchQueries) ?? [];

    if (queries.length > 0) {
      return queries;
    }

    return legacyTargetSearchQueries(provider, kind);
  });
}

export function phpFrameworkSupportsTargetCollection(
  kind: PhpFrameworkTargetCollectionKind,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => {
    const collections = provider.targetCollections?.filter(
      (collection) => collection.kind === kind,
    );

    return (
      (collections !== undefined && collections.length > 0) ||
      legacyTargetSearchQueries(provider, kind).length > 0
    );
  });
}

function legacyTargetSearchQueries(
  provider: PhpFrameworkProvider,
  kind: PhpFrameworkTargetCollectionKind,
): readonly string[] {
  if (kind === "routes") {
    return provider.routes?.searchQueries ?? [];
  }

  return provider.viewData?.searchQueries ?? [];
}

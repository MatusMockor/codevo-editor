import {
  isLaravelApiResourceMemberMethod,
  isLaravelApiResourceStaticMethod,
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentBuilderMacroFromSource,
  isLaravelEloquentLocalScopeMemberMethod,
  isLaravelEloquentLocalScopeStaticMethod,
  isLaravelEloquentStaticBuilderReceiver,
  isLaravelMacroMemberMethodFromSource,
  phpLaravelApiResourceCompletionsFromSource,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  phpLaravelMacroCompletionsFromSource,
  phpLaravelMethodCallReturnTypeFromSource,
  phpLaravelModelAttributeCompletionsFromSource,
  phpLaravelModelPropertyClassTypeFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
} from "./phpFrameworkLaravel";
import type { EditorPosition } from "./languageServerFeatures";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
import {
  phpLaravelNamedRouteDefinitions,
  phpLaravelNamedRouteReferenceContextAt,
} from "./phpLaravelRoutes";
import type { PhpProjectDescriptor } from "./workspace";

export interface PhpFrameworkMemberCompletionContext {
  declaringClassName: string;
  sourceContext?: PhpFrameworkSourceContext;
  source: string;
}

export interface PhpFrameworkStaticMethodContext {
  className: string;
  methodName: string;
  sourceContext?: PhpFrameworkSourceContext;
  source: string;
}

export interface PhpFrameworkMemberMethodContext {
  methodName: string;
  receiverClassName?: string | null;
  receiverExpression: string;
  sourceContext?: PhpFrameworkSourceContext;
  source: string;
}

export interface PhpFrameworkPropertyTypeContext {
  propertyName: string;
  receiverType: string | null;
  source: string;
}

export interface PhpFrameworkMethodCallReturnTypeContext {
  callExpression: string | null;
  methodName: string;
  receiverExpression: string | null;
  receiverType: string | null;
  sourceContext?: PhpFrameworkSourceContext;
  source: string;
}

export interface PhpFrameworkContainerExpressionContext {
  expression: string;
}

export interface PhpFrameworkContainerBinding {
  abstractClassName: string;
  concreteClassName: string;
}

export interface PhpFrameworkContainerBindingsContext {
  source: string;
}

export interface PhpFrameworkSourceContext {
  workspaceSources?: readonly string[];
}

/**
 * A named-route reference detected at the cursor (e.g. the `route('x')`
 * argument). Framework-agnostic mirror of the Laravel route reference so the
 * controller's completion path never binds to one framework's parser.
 */
export interface PhpFrameworkRouteReference {
  call: string;
  name: string;
  position: EditorPosition;
  prefix: string;
}

/** A named-route definition (its name + declaration position). */
export interface PhpFrameworkRouteDefinition {
  name: string;
  position: EditorPosition;
}

export interface PhpFrameworkRouteReferenceContext {
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkRouteDefinitionsContext {
  source: string;
}

export interface PhpFrameworkProvider {
  id: string;
  /**
   * Plugin detection: returns true when this framework is present in the
   * project. Detection lives on the provider so registering a new framework
   * (Nette, Symfony, ...) never touches the dispatcher - the registry simply
   * asks each provider whether it applies.
   */
  appliesTo?: (php: PhpProjectDescriptor) => boolean;
  completions?: {
    memberCompletionsFromSource?: (
      context: PhpFrameworkMemberCompletionContext,
    ) => PhpMethodCompletion[];
  };
  diagnostics?: {
    isKnownMemberMethod?: (context: PhpFrameworkMemberMethodContext) => boolean;
    isKnownStaticMethod?: (context: PhpFrameworkStaticMethodContext) => boolean;
  };
  routes?: {
    referenceAt?: (
      context: PhpFrameworkRouteReferenceContext,
    ) => PhpFrameworkRouteReference | null;
    definitionsFromSource?: (
      context: PhpFrameworkRouteDefinitionsContext,
    ) => PhpFrameworkRouteDefinition[];
    /**
     * Text-search anchors that surface files declaring named routes outside the
     * active document (route files, `->name(...)` chains, resource
     * registrations). Owned by the provider so the controller's route collector
     * is framework-agnostic.
     */
    searchQueries?: readonly string[];
  };
  semantics?: {
    propertyTypeFromSource?: (
      context: PhpFrameworkPropertyTypeContext,
    ) => string | null;
    methodCallReturnTypeFromSource?: (
      context: PhpFrameworkMethodCallReturnTypeContext,
    ) => string | null;
    containerExpressionClassName?: (
      context: PhpFrameworkContainerExpressionContext,
    ) => string | null;
    containerBindingsFromSource?: (
      context: PhpFrameworkContainerBindingsContext,
    ) => PhpFrameworkContainerBinding[];
  };
}

/**
 * Text-search anchors for Laravel named routes declared outside the active
 * document. Kept beside the provider (not the controller) so route knowledge
 * stays framework-owned; a future provider ships its own anchors.
 */
const laravelRouteSearchQueries: readonly string[] = [
  "->name(",
  "'as' =>",
  "\"as\" =>",
  "Route::resource",
  "Route::apiResource",
  "Route::singleton",
  "Route::apiSingleton",
  "Route::resources",
  "Route::apiResources",
  "Route::softDeletableResources",
];

export const phpLaravelFrameworkProvider: PhpFrameworkProvider = {
  id: "laravel",
  appliesTo: (php) => isLaravelPhpProject(php),
  completions: {
    memberCompletionsFromSource: ({
      declaringClassName,
      source,
      sourceContext,
    }) => [
      ...phpLaravelMacroCompletionsFromSource(
        source,
        declaringClassName,
        sourceContext?.workspaceSources,
      ),
      ...phpLaravelModelAttributeCompletionsFromSource(
        source,
        declaringClassName,
        sourceContext?.workspaceSources,
      ),
      ...phpLaravelRelationPropertyCompletionsFromSource(
        source,
        declaringClassName,
      ),
      ...phpLaravelApiResourceCompletionsFromSource(source, declaringClassName),
    ],
  },
  diagnostics: {
    isKnownMemberMethod: ({
      methodName,
      receiverClassName,
      receiverExpression,
      source,
      sourceContext,
    }) =>
      ((isLaravelEloquentBuilderMethodName(methodName) ||
        isLaravelEloquentBuilderMacroFromSource(
          source,
          methodName,
          sourceContext?.workspaceSources,
        )) &&
        Boolean(
          phpLaravelEloquentBuilderModelTypeFromExpression(
            source,
            receiverExpression,
          ),
        )) ||
      isLaravelMacroMemberMethodFromSource(
        source,
        receiverExpression,
        receiverClassName ?? null,
        methodName,
        sourceContext?.workspaceSources,
      ) ||
      isLaravelEloquentLocalScopeMemberMethod(
        source,
        receiverExpression,
        methodName,
      ) ||
      isLaravelApiResourceMemberMethod(
        source,
        receiverClassName ?? receiverExpression,
        methodName,
      ),
    isKnownStaticMethod: ({ className, methodName, source, sourceContext }) =>
      ((isLaravelEloquentBuilderMethodName(methodName) ||
        isLaravelEloquentBuilderMacroFromSource(
          source,
          methodName,
          sourceContext?.workspaceSources,
        )) &&
        isLaravelEloquentStaticBuilderReceiver(source, className)) ||
      isLaravelEloquentLocalScopeStaticMethod(source, className, methodName) ||
      isLaravelApiResourceStaticMethod(source, className, methodName),
  },
  routes: {
    definitionsFromSource: ({ source }) =>
      phpLaravelNamedRouteDefinitions(source),
    referenceAt: ({ position, source }) =>
      phpLaravelNamedRouteReferenceContextAt(source, position),
    searchQueries: laravelRouteSearchQueries,
  },
  semantics: {
    propertyTypeFromSource: ({ propertyName, receiverType, source }) =>
      phpLaravelModelPropertyClassTypeFromSource(
        source,
        propertyName,
        receiverType,
      ),
    methodCallReturnTypeFromSource: ({
      callExpression,
      methodName,
      receiverExpression,
      receiverType,
      source,
      sourceContext,
    }) =>
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        methodName,
        receiverType,
        receiverExpression,
        callExpression,
        sourceContext?.workspaceSources,
      ),
    containerExpressionClassName: ({ expression }) =>
      phpLaravelContainerExpressionClassName(expression),
    containerBindingsFromSource: ({ source }) =>
      phpLaravelContainerBindingsFromSource(source),
  },
};

/**
 * Nette provider skeleton. Detection is wired today so the framework profile and
 * per-workspace exclusivity resolve correctly; the capabilities (templating,
 * viewData, routes, diagnostics, config) arrive in later slices. Until then this
 * provider carries no capability objects, and every dispatcher treats it as a
 * safe no-op via optional chaining - it can never crash the completion/diagnostic
 * hot path.
 */
export const phpNetteFrameworkProvider: PhpFrameworkProvider = {
  id: "nette",
  appliesTo: (php) => isNettePhpProject(php),
};

export const defaultPhpFrameworkProviders: readonly PhpFrameworkProvider[] = [];

/**
 * Plugin registry of every known framework provider. Adding a framework means
 * appending its provider here (and giving it an `appliesTo`); the rest of the
 * pipeline discovers it automatically. Laravel and Nette ship today; the seam is
 * ready for further providers (Symfony, ...) without further changes.
 */
export const phpFrameworkProviderRegistry: readonly PhpFrameworkProvider[] = [
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
];

/**
 * Active provider set for a project: exclusive by construction (exactly zero or
 * one provider). It shares the single detection pass with the framework profile
 * via `resolvePhpFrameworkProfile`, so a project can never carry two active
 * frameworks at once - the exclusivity is structural, not two independent
 * computations that could drift apart.
 */
export function phpFrameworkProvidersForProject(
  php: PhpProjectDescriptor | null,
  registry: readonly PhpFrameworkProvider[] = phpFrameworkProviderRegistry,
): readonly PhpFrameworkProvider[] {
  return resolvePhpFrameworkProfile(php, registry).providers;
}

export function phpFrameworkProviderSignature(
  providers: readonly PhpFrameworkProvider[],
): string {
  return providers.map((provider) => provider.id).join(",");
}

export function isPhpFrameworkProviderActive(
  providers: readonly PhpFrameworkProvider[],
  providerId: string,
): boolean {
  return providers.some((provider) => provider.id === providerId);
}

export function phpFrameworkMemberCompletionsFromSource(
  source: string,
  declaringClassName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
): PhpMethodCompletion[] {
  return providers.flatMap(
    (provider) =>
      provider.completions?.memberCompletionsFromSource?.({
        declaringClassName,
        source,
        sourceContext,
      }) ??
      [],
  );
}

export function isKnownPhpFrameworkStaticMethod(
  source: string,
  className: string,
  methodName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
): boolean {
  return providers.some(
    (provider) =>
      provider.diagnostics?.isKnownStaticMethod?.({
        className,
        methodName,
        source,
        sourceContext,
      }) ?? false,
  );
}

export function isKnownPhpFrameworkMemberMethod(
  source: string,
  receiverExpression: string,
  methodName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): boolean {
  return providers.some(
    (provider) =>
      provider.diagnostics?.isKnownMemberMethod?.({
        methodName,
        receiverClassName,
        receiverExpression,
        source,
        sourceContext,
      }) ?? false,
  );
}

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
  for (const provider of providers) {
    const reference = provider.routes?.referenceAt?.({ position, source });

    if (reference) {
      return reference;
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

/**
 * Text-search anchors the active providers use to surface route declarations in
 * other files. Empty when no active provider ships routes.
 */
export function phpFrameworkRouteSearchQueries(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return providers.flatMap((provider) => provider.routes?.searchQueries ?? []);
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

export function phpFrameworkPropertyTypeFromSource(
  source: string,
  propertyName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  receiverType: string | null = null,
): string | null {
  for (const provider of providers) {
    const propertyType = provider.semantics?.propertyTypeFromSource?.({
      propertyName,
      receiverType,
      source,
    });

    if (propertyType) {
      return propertyType;
    }
  }

  return null;
}

export function phpFrameworkMethodCallReturnTypeFromSource(
  source: string,
  methodName: string,
  receiverType: string | null,
  receiverExpression: string | null,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  callExpression: string | null = null,
  sourceContext?: PhpFrameworkSourceContext,
): string | null {
  for (const provider of providers) {
    const returnType = provider.semantics?.methodCallReturnTypeFromSource?.({
      callExpression,
      methodName,
      receiverExpression,
      receiverType,
      sourceContext,
      source,
    });

    if (returnType) {
      return returnType;
    }
  }

  return null;
}

export function phpFrameworkContainerExpressionClassName(
  expression: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string | null {
  for (const provider of providers) {
    const className = provider.semantics?.containerExpressionClassName?.({
      expression,
    });

    if (className) {
      return className;
    }
  }

  return null;
}

export function phpFrameworkContainerConcreteClassNameFromSource(
  source: string,
  expression: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
): string | null {
  const abstractClassName = phpFrameworkContainerExpressionClassName(
    expression,
    providers,
  );

  if (!abstractClassName) {
    return null;
  }

  return (
    phpFrameworkConcreteClassNameFromBindings(
      abstractClassName,
      phpFrameworkContainerBindingsFromSources(
        [source, ...(sourceContext?.workspaceSources ?? [])],
        providers,
      ),
    ) ?? abstractClassName
  );
}

export function phpFrameworkContainerBindingsFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkContainerBinding[] {
  return providers.flatMap(
    (provider) =>
      provider.semantics?.containerBindingsFromSource?.({ source }) ?? [],
  );
}

function phpFrameworkContainerBindingsFromSources(
  sources: readonly string[],
  providers: readonly PhpFrameworkProvider[],
): PhpFrameworkContainerBinding[] {
  const bindings: PhpFrameworkContainerBinding[] = [];

  for (const source of sources) {
    for (const binding of phpFrameworkContainerBindingsFromSource(
      source,
      providers,
    )) {
      if (bindings.some((seen) => phpFrameworkBindingsEqual(seen, binding))) {
        continue;
      }

      bindings.push(binding);
    }
  }

  return bindings;
}

function phpFrameworkConcreteClassNameFromBindings(
  abstractClassName: string,
  bindings: readonly PhpFrameworkContainerBinding[],
): string | null {
  const normalizedAbstract = phpFrameworkNormalizedClassName(abstractClassName);

  return (
    bindings.find(
      (binding) =>
        phpFrameworkNormalizedClassName(binding.abstractClassName) ===
        normalizedAbstract,
    )?.concreteClassName ?? null
  );
}

function phpFrameworkBindingsEqual(
  left: PhpFrameworkContainerBinding,
  right: PhpFrameworkContainerBinding,
): boolean {
  return (
    phpFrameworkNormalizedClassName(left.abstractClassName) ===
      phpFrameworkNormalizedClassName(right.abstractClassName) &&
    phpFrameworkNormalizedClassName(left.concreteClassName) ===
      phpFrameworkNormalizedClassName(right.concreteClassName)
  );
}

function phpFrameworkNormalizedClassName(className: string): string {
  return className.trim().replace(/^\\+/, "").toLowerCase();
}

/**
 * Exclusive, per-workspace framework profile derived from `composer.json`. This
 * is the single discriminator UI and isolation logic key off (status-bar chip,
 * gating). A project carries at most one profile.
 */
export type FrameworkProfile = "laravel" | "nette" | "generic";

/**
 * Outcome of the single framework detection pass. Both the active provider set
 * and the profile are derived from the same `matchedProviderIds`, so there is
 * exactly one source of truth - they can never disagree (the HIGH finding was
 * two independent computations that could).
 */
export interface PhpFrameworkResolution {
  /** Exclusive active provider set: exactly zero or one provider. */
  readonly providers: readonly PhpFrameworkProvider[];
  /** Exclusive framework profile derived from the winning provider. */
  readonly profile: FrameworkProfile;
  /**
   * Every provider id whose detection matched, in registry (priority) order.
   * More than one id means the project declared several framework signals at
   * once (e.g. a Laravel app carrying `latte/latte` transitively in
   * composer.lock / installed.json) and the exclusive winner was chosen by
   * registry priority - the caller should log that edge once per workspace.
   */
  readonly matchedProviderIds: readonly string[];
}

/**
 * The one detection pass: every provider whose `appliesTo` matches, in registry
 * order. Registry order is the deterministic priority (Laravel is registered
 * first), so the exclusive winner is simply the first match.
 */
function matchingPhpFrameworkProviders(
  php: PhpProjectDescriptor | null,
  registry: readonly PhpFrameworkProvider[],
): readonly PhpFrameworkProvider[] {
  if (!php) {
    return [];
  }

  return registry.filter((provider) => provider.appliesTo?.(php) ?? false);
}

/**
 * Resolves the exclusive framework profile and active provider from a project
 * descriptor over the given registry (defaulting to the shipped registry). This
 * is the single detection path both `phpFrameworkProvidersForProject` and
 * `frameworkProfileForProject` delegate to. If the registry has no provider for
 * the project the result is empty/generic.
 */
export function resolvePhpFrameworkProfile(
  php: PhpProjectDescriptor | null,
  registry: readonly PhpFrameworkProvider[] = phpFrameworkProviderRegistry,
): PhpFrameworkResolution {
  const matches = matchingPhpFrameworkProviders(php, registry);
  const [winner] = matches;

  if (!winner) {
    return { matchedProviderIds: [], profile: "generic", providers: [] };
  }

  return {
    matchedProviderIds: matches.map((provider) => provider.id),
    profile: frameworkProfileFromProviderId(winner.id),
    providers: [winner],
  };
}

/**
 * Type-safe narrowing from a provider id (an open `string`) to the closed
 * `FrameworkProfile` set. Providers outside the UI-facing set (a future
 * "symfony") stay active as providers but map to "generic" for the chip.
 */
function frameworkProfileFromProviderId(id: string): FrameworkProfile {
  if (id === "laravel") {
    return "laravel";
  }

  if (id === "nette") {
    return "nette";
  }

  return "generic";
}

/**
 * Resolves the exclusive framework profile for a project. Delegates to the same
 * detection pass as `phpFrameworkProvidersForProject`, so the chip label and the
 * active provider set are always consistent.
 */
export function frameworkProfileForProject(
  php: PhpProjectDescriptor | null | undefined,
): FrameworkProfile {
  return resolvePhpFrameworkProfile(php ?? null).profile;
}

function isLaravelPhpProject(php: PhpProjectDescriptor): boolean {
  if (php.packageName === "laravel/laravel") {
    return true;
  }

  return php.packages.some(
    (composerPackage) => composerPackage.name === "laravel/framework",
  );
}

/**
 * Nette detection mirrors `isLaravelPhpProject`: an exact composer package name
 * match (Composer normalizes package names to lowercase, so no case folding is
 * needed - and staying identical to the Laravel check keeps behavior consistent).
 * `nette/application` (the framework) or `latte/latte` (the template engine)
 * signal a Nette project.
 */
function isNettePhpProject(php: PhpProjectDescriptor): boolean {
  return php.packages.some(
    (composerPackage) =>
      composerPackage.name === "nette/application" ||
      composerPackage.name === "latte/latte",
  );
}

export { isNettePhpProject };

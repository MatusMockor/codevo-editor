import type { EditorPosition } from "./languageServerFeatures";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
import {
  isLaravelPhpProject,
  phpLaravelFrameworkProvider,
} from "./phpFrameworkLaravelProvider";
import {
  isNettePhpProject,
  NETTE_MAGIC_DIAGNOSTIC_SOURCE,
  phpNetteFrameworkProvider,
} from "./phpFrameworkNetteProvider";
import type { PhpProjectDescriptor } from "./workspace";

export {
  isLaravelPhpProject,
  isNettePhpProject,
  NETTE_MAGIC_DIAGNOSTIC_SOURCE,
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
};

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

export interface PhpFrameworkMemberPropertyContext {
  propertyName: string;
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

export interface PhpFrameworkMagicDiagnosticMatch {
  source: string | null;
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

/**
 * A config reference detected at the cursor (e.g. the `config('x')` argument).
 * Framework-agnostic mirror of the Laravel config reference so the controller's
 * completion path never binds to one framework's parser.
 */
export interface PhpFrameworkConfigReference {
  call: string;
  key: string;
  position: EditorPosition;
  prefix: string;
}

/** A config key declared in a source (its dotted key + declaration position). */
export interface PhpFrameworkConfigKey {
  key: string;
  position: EditorPosition;
}

export interface PhpFrameworkConfigReferenceContext {
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkConfigKeysContext {
  fileName: string;
  source: string;
}

export interface PhpFrameworkConfigTargetContext {
  fileName: string;
  key: string;
  source: string;
}

/**
 * An environment-variable reference detected at the cursor (e.g. the
 * `env('APP_...')` argument). Framework-agnostic mirror of Laravel's env
 * reference so PHP literal completion routing can be provider-owned.
 */
export interface PhpFrameworkEnvReference {
  name: string;
  position: EditorPosition;
  prefix: string;
}

/** An environment-variable key declared in a source (its name + position). */
export interface PhpFrameworkEnvEntry {
  name: string;
  position: EditorPosition;
}

export interface PhpFrameworkEnvReferenceContext {
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkEnvEntriesContext {
  source: string;
}

export interface PhpFrameworkEnvTargetContext {
  name: string;
  source: string;
}

/**
 * A translation reference detected at the cursor (e.g. the `__('x')` /
 * `trans('x')` argument). Framework-agnostic mirror of the Laravel translation
 * reference so the controller's completion path never binds to one framework's
 * parser.
 */
export interface PhpFrameworkTranslationReference {
  call: string;
  key: string;
  position: EditorPosition;
  prefix: string;
}

/** A translation key declared in a source (its key + declaration position). */
export interface PhpFrameworkTranslationKey {
  key: string;
  position: EditorPosition;
}

export interface PhpFrameworkTranslationReferenceContext {
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkTranslationKeysContext {
  fileName: string;
  source: string;
}

export interface PhpFrameworkTranslationTargetContext {
  fileName: string;
  key: string;
  source: string;
}

export interface PhpFrameworkJsonTranslationKeysContext {
  source: string;
}

export interface PhpFrameworkJsonTranslationTargetContext {
  key: string;
  source: string;
}

/**
 * A view reference detected at the cursor (e.g. the `view('x')` argument).
 * Framework-agnostic mirror of the Laravel view reference so the controller's
 * completion / navigation path never binds to one framework's parser.
 */
export interface PhpFrameworkViewReference {
  call: string;
  name: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpFrameworkViewReferenceContext {
  position: EditorPosition;
  source: string;
}

/**
 * A single variable bound into a view/template render (e.g. `compact('user')`
 * or `['user' => $user]`), with a cheap display-type hint and, where
 * statically known, the source expression that produced the value.
 * Framework-agnostic mirror of Laravel's `PhpLaravelViewVariable` so the
 * controller's view-data cache never binds to one framework's parser.
 */
export interface PhpFrameworkViewDataVariable {
  detail: string;
  name: string;
  typeHint: string | null;
  valueExpression: string | null;
  valueOffset: number | null;
}

/**
 * One `view(...)` / `View::make(...)`-style render call, with every variable it
 * binds. Framework-agnostic mirror of Laravel's `PhpLaravelViewDataBinding`.
 */
export interface PhpFrameworkViewDataBinding {
  variables: PhpFrameworkViewDataVariable[];
  viewName: string;
}

/**
 * A controller/presenter source's parsed view-data bindings (every render call
 * it contains). Framework-agnostic mirror of Laravel's `BladeViewDataEntry` so
 * a future provider (Nette) can ship `viewData.entryFromSource` without a
 * breaking rename.
 */
export interface PhpFrameworkViewDataEntry {
  bindings: PhpFrameworkViewDataBinding[];
  source: string;
}

export interface PhpFrameworkViewDataEntryContext {
  source: string;
}

/**
 * A validation-rule reference detected at the cursor (inside a rules array
 * value, e.g. the `'req...'` in `['name' => 'req...']`). Framework-agnostic
 * mirror of Laravel's `PhpLaravelValidationRuleStringContext` so the
 * controller's completion path never binds to one framework's parser.
 */
export interface PhpFrameworkValidationRuleReference {
  position: EditorPosition;
  prefix: string;
}

/** A single validation-rule completion (its inserted text + display name). */
export interface PhpFrameworkValidationRuleCompletion {
  insertText: string;
  name: string;
}

export interface PhpFrameworkValidationRuleReferenceContext {
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkValidationRuleCompletionContext {
  prefix: string;
}

/**
 * The classification of a string literal a framework recognises as a navigation
 * helper argument (config / route / view / trans / env). Framework-agnostic
 * mirror of Laravel's `LaravelStringLiteralHelper` so the controller's Cmd+B
 * path never binds to one framework's classifier.
 */
export type PhpFrameworkStringLiteralHelper =
  | "config"
  | "route"
  | "view"
  | "trans"
  | "env";

/**
 * A string literal at the cursor classified as a framework navigation-helper
 * argument, with the literal text and its span. Framework-agnostic mirror of
 * Laravel's `LaravelStringLiteralHelperMatch`.
 */
export interface PhpFrameworkStringLiteralHelperMatch {
  helper: PhpFrameworkStringLiteralHelper;
  literal: string;
  literalStart: number;
  literalEnd: number;
}

export interface PhpFrameworkStringLiteralContext {
  offset: number;
  source: string;
}

export interface PhpFrameworkLiteralTargetContext {
  literal: string;
}

export type PhpFrameworkResolvedLiteralTarget = object;

export interface PhpFrameworkPhpStringCompletionContext {
  position: EditorPosition;
  source: string;
}

export interface PhpFrameworkPhpPresenterLinkContext {
  offset: number;
  source: string;
}

/**
 * A PHP presenter-link target detected in a framework-owned link API (today
 * Nette's `$this->link(...)` / redirects). Shape mirrors the Nette detector but
 * keeps central completion/navigation code off Nette-specific imports.
 */
export interface PhpFrameworkPhpPresenterLink {
  call: string;
  target: string;
  targetEnd: number;
  targetStart: number;
}

/** Replace range for PHP presenter-link target completions. */
export interface PhpFrameworkPhpPresenterLinkCompletion {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

export type PhpFrameworkTargetCollectionKind = "routes" | "viewData";

export interface PhpFrameworkTargetCollectionCapability {
  kind: PhpFrameworkTargetCollectionKind;
  searchQueries: readonly string[];
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
    isKnownMemberProperty?: (
      context: PhpFrameworkMemberPropertyContext,
    ) => boolean;
    isKnownStaticMethod?: (context: PhpFrameworkStaticMethodContext) => boolean;
    /**
     * Optional diagnostic `source` label stamped on a framework-magic hint when
     * THIS provider's magic classification fires (spec §4.6). Absent → the
     * shared `laravel-magic` marker, so Laravel output stays byte-identical; the
     * Nette provider overrides it to `nette-magic` so a Nette project's
     * downgraded hints are not mislabelled as Laravel. Read once per filter pass
     * by `phpLanguageServerDiagnosticFilters`; it never affects severity or
     * WHICH diagnostics are downgraded (that is driven purely by the predicates
     * above), only the label a user sees on the resulting soft hint.
     */
    magicSource?: string;
  };
  targetCollections?: readonly PhpFrameworkTargetCollectionCapability[];
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
  config?: {
    referenceAt?: (
      context: PhpFrameworkConfigReferenceContext,
    ) => PhpFrameworkConfigReference | null;
    resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    keysFromSource?: (
      context: PhpFrameworkConfigKeysContext,
    ) => PhpFrameworkConfigKey[];
    targetFromSource?: (
      context: PhpFrameworkConfigTargetContext,
    ) => PhpFrameworkConfigKey | null;
  };
  env?: {
    referenceAt?: (
      context: PhpFrameworkEnvReferenceContext,
    ) => PhpFrameworkEnvReference | null;
    resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    entriesFromSource?: (
      context: PhpFrameworkEnvEntriesContext,
    ) => PhpFrameworkEnvEntry[];
    targetFromSource?: (
      context: PhpFrameworkEnvTargetContext,
    ) => PhpFrameworkEnvEntry | null;
  };
  translations?: {
    referenceAt?: (
      context: PhpFrameworkTranslationReferenceContext,
    ) => PhpFrameworkTranslationReference | null;
    resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    keysFromSource?: (
      context: PhpFrameworkTranslationKeysContext,
    ) => PhpFrameworkTranslationKey[];
    targetFromSource?: (
      context: PhpFrameworkTranslationTargetContext,
    ) => PhpFrameworkTranslationKey | null;
    jsonKeysFromSource?: (
      context: PhpFrameworkJsonTranslationKeysContext,
    ) => PhpFrameworkTranslationKey[];
    jsonTargetFromSource?: (
      context: PhpFrameworkJsonTranslationTargetContext,
    ) => PhpFrameworkTranslationKey | null;
  };
  templating?: {
    referenceAt?: (
      context: PhpFrameworkViewReferenceContext,
    ) => PhpFrameworkViewReference | null;
    resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
  };
  viewData?: {
    /**
     * Parses one controller/presenter source into its view-data bindings (the
     * variables each template render passes). Pure; the controller owns the
     * file discovery, per-root cache, and per-workspace isolation guards.
     */
    entryFromSource?: (
      context: PhpFrameworkViewDataEntryContext,
    ) => PhpFrameworkViewDataEntry;
    /**
     * Text-search anchors that surface the sources feeding data into templates
     * (`view(...)`, `View::make`, `->with(...)`, `compact(...)` for Laravel).
     * Owned by the provider so the controller's view-data loader stays
     * framework-agnostic; a future provider ships its own anchors.
     */
    searchQueries?: readonly string[];
  };
  validation?: {
    ruleReferenceAt?: (
      context: PhpFrameworkValidationRuleReferenceContext,
    ) => PhpFrameworkValidationRuleReference | null;
    ruleCompletions?: (
      context: PhpFrameworkValidationRuleCompletionContext,
    ) => PhpFrameworkValidationRuleCompletion[];
  };
  stringLiterals?: {
    helperAt?: (
      context: PhpFrameworkStringLiteralContext,
    ) => PhpFrameworkStringLiteralHelperMatch | null;
  };
  php?: {
    /**
     * Provider-owned gate for PHP string-literal completion contexts. This is
     * intentionally broad: central Monaco code can ask "should framework
     * completions own this string?" without importing Laravel/Nette parsers.
     */
    isScopedStringCompletionContext?: (
      context: PhpFrameworkPhpStringCompletionContext,
    ) => boolean;
    /**
     * Provider-owned PHP presenter-link navigation target detector. Today Nette
     * owns this (`$this->link(...)`, redirects), but the central definition path
     * should only dispatch through the provider seam.
     */
    presenterLinkAt?: (
      context: PhpFrameworkPhpPresenterLinkContext,
    ) => PhpFrameworkPhpPresenterLink | null;
    /**
     * Provider-owned PHP presenter-link completion replace range detector. Kept
     * separate from `presenterLinkAt` because completions fire on partial/empty
     * strings that navigation intentionally ignores.
     */
    presenterLinkCompletionAt?: (
      context: PhpFrameworkPhpPresenterLinkContext,
    ) => PhpFrameworkPhpPresenterLinkCompletion | null;
  };
  neon?: {
    /**
     * Provider-owned opt-in for NEON config intelligence. The application hook
     * still owns file discovery, cache lifecycle, and editor navigation; this
     * capability is the framework gate so a Nette-only feature does not depend
     * on a hardcoded `isNette` branch.
     */
    supportsConfigIntelligence: true;
  };
  latte?: {
    /**
     * Provider-owned opt-in for semantic Latte template intelligence. The
     * application hook still owns template scans, presenter/view-data caches,
     * and editor navigation; this capability is the framework gate so Latte
     * semantics are enabled by provider dispatch, not a hardcoded profile flag.
     */
    supportsTemplateIntelligence: true;
    /**
     * Provider-owned opt-in for Nette-style presenter-link intelligence
     * (`{link}`, `{plink}`, `n:href`, `$this->link(...)`, redirects). This is a
     * concrete Latte capability below the broad template-intelligence gate, so
     * another Latte provider can opt into template basics without inheriting
     * Nette presenter routing semantics.
     */
    supportsPresenterLinkIntelligence?: true;
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
  return Boolean(
    phpFrameworkStaticMethodMagicDiagnostic(
      source,
      className,
      methodName,
      providers,
      sourceContext,
    ),
  );
}

export function phpFrameworkStaticMethodMagicDiagnostic(
  source: string,
  className: string,
  methodName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
): PhpFrameworkMagicDiagnosticMatch | null {
  for (const provider of providers) {
    if (
      provider.diagnostics?.isKnownStaticMethod?.({
        className,
        methodName,
        source,
        sourceContext,
      })
    ) {
      return { source: provider.diagnostics.magicSource ?? null };
    }
  }

  return null;
}

export function isKnownPhpFrameworkMemberMethod(
  source: string,
  receiverExpression: string,
  methodName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): boolean {
  return Boolean(
    phpFrameworkMemberMethodMagicDiagnostic(
      source,
      receiverExpression,
      methodName,
      providers,
      sourceContext,
      receiverClassName,
    ),
  );
}

export function phpFrameworkMemberMethodMagicDiagnostic(
  source: string,
  receiverExpression: string,
  methodName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): PhpFrameworkMagicDiagnosticMatch | null {
  for (const provider of providers) {
    if (
      provider.diagnostics?.isKnownMemberMethod?.({
        methodName,
        receiverClassName,
        receiverExpression,
        source,
        sourceContext,
      })
    ) {
      return { source: provider.diagnostics.magicSource ?? null };
    }
  }

  return null;
}

export function phpFrameworkMemberPropertyMagicDiagnostic(
  source: string,
  receiverExpression: string,
  propertyName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
  sourceContext?: PhpFrameworkSourceContext,
  receiverClassName?: string | null,
): PhpFrameworkMagicDiagnosticMatch | null {
  for (const provider of providers) {
    if (
      provider.diagnostics?.isKnownMemberProperty?.({
        propertyName,
        receiverClassName,
        receiverExpression,
        source,
        sourceContext,
      })
    ) {
      return { source: provider.diagnostics.magicSource ?? null };
    }
  }

  return null;
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

/**
 * First config reference detected at the cursor across the active providers.
 * Exclusive resolution keeps this to at most one provider today, so the first
 * non-null match wins and non-config providers are inert.
 */
export function phpFrameworkConfigReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkConfigReference | null {
  for (const provider of providers) {
    const reference = provider.config?.referenceAt?.({ position, source });

    if (reference) {
      return reference;
    }
  }

  return null;
}

/**
 * Config keys declared in a single source, aggregated across the active
 * providers. Providers without a config capability contribute nothing.
 */
export function phpFrameworkConfigKeysFromSource(
  source: string,
  fileName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkConfigKey[] {
  return providers.flatMap(
    (provider) => provider.config?.keysFromSource?.({ fileName, source }) ?? [],
  );
}

/**
 * First config target for a key resolved in a single source across the active
 * providers. Providers without a config capability contribute nothing.
 */
export function phpFrameworkConfigTargetFromSource(
  source: string,
  fileName: string,
  key: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkConfigKey | null {
  for (const provider of providers) {
    const target = provider.config?.targetFromSource?.({
      fileName,
      key,
      source,
    });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkConfigLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.config?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkEnvReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkEnvReference | null {
  for (const provider of providers) {
    const reference = provider.env?.referenceAt?.({ position, source });

    if (reference) {
      return reference;
    }
  }

  return null;
}

export function phpFrameworkEnvEntriesFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkEnvEntry[] {
  return providers.flatMap(
    (provider) => provider.env?.entriesFromSource?.({ source }) ?? [],
  );
}

export function phpFrameworkEnvTargetFromSource(
  source: string,
  name: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkEnvEntry | null {
  for (const provider of providers) {
    const target = provider.env?.targetFromSource?.({ name, source });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkEnvLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.env?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkSupportsEnv(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.env !== undefined);
}

/**
 * Whether any active provider ships a config capability - the framework-agnostic
 * gate that replaces the hardcoded `isLaravelFrameworkActive` config checks.
 */
export function phpFrameworkSupportsConfig(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.config !== undefined);
}

/**
 * First translation reference detected at the cursor across the active
 * providers. Exclusive resolution keeps this to at most one provider today, so
 * the first non-null match wins and non-translation providers are inert.
 */
export function phpFrameworkTranslationReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkTranslationReference | null {
  for (const provider of providers) {
    const reference = provider.translations?.referenceAt?.({ position, source });

    if (reference) {
      return reference;
    }
  }

  return null;
}

/**
 * Translation keys declared in a single PHP lang source, aggregated across the
 * active providers. Providers without a translations capability contribute
 * nothing.
 */
export function phpFrameworkTranslationKeysFromSource(
  source: string,
  fileName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkTranslationKey[] {
  return providers.flatMap(
    (provider) =>
      provider.translations?.keysFromSource?.({ fileName, source }) ?? [],
  );
}

/**
 * First translation target for a key resolved in a single PHP lang source
 * across the active providers. Providers without a translations capability
 * contribute nothing.
 */
export function phpFrameworkTranslationTargetFromSource(
  source: string,
  fileName: string,
  key: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkTranslationKey | null {
  for (const provider of providers) {
    const target = provider.translations?.targetFromSource?.({
      fileName,
      key,
      source,
    });

    if (target) {
      return target;
    }
  }

  return null;
}

export function phpFrameworkTranslationLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.translations?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

/**
 * Translation keys declared in a single JSON lang source, aggregated across the
 * active providers. Providers without a translations capability contribute
 * nothing.
 */
export function phpFrameworkJsonTranslationKeysFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkTranslationKey[] {
  return providers.flatMap(
    (provider) => provider.translations?.jsonKeysFromSource?.({ source }) ?? [],
  );
}

/**
 * First translation target for a key resolved in a single JSON lang source
 * across the active providers. Providers without a translations capability
 * contribute nothing.
 */
export function phpFrameworkJsonTranslationTargetFromSource(
  source: string,
  key: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkTranslationKey | null {
  for (const provider of providers) {
    const target = provider.translations?.jsonTargetFromSource?.({
      key,
      source,
    });

    if (target) {
      return target;
    }
  }

  return null;
}

/**
 * Whether any active provider ships a translations capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * translation checks.
 */
export function phpFrameworkSupportsTranslations(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.translations !== undefined);
}

/**
 * First view reference detected at the cursor across the active providers.
 * Exclusive resolution keeps this to at most one provider today, so the first
 * non-null match wins and non-templating providers are inert.
 */
export function phpFrameworkViewReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkViewReference | null {
  for (const provider of providers) {
    const reference = provider.templating?.referenceAt?.({ position, source });

    if (reference) {
      return reference;
    }
  }

  return null;
}

export function phpFrameworkViewLiteralTarget(
  literal: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkResolvedLiteralTarget | null {
  for (const provider of providers) {
    const target = provider.templating?.resolveLiteralTarget?.({ literal });

    if (target) {
      return target;
    }
  }

  return null;
}

/**
 * Whether any active provider ships a templating capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * view checks.
 */
export function phpFrameworkSupportsViews(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.templating !== undefined);
}

/**
 * First view-data entry parsed from a single controller/presenter source across
 * the active providers. Providers without a viewData capability contribute
 * nothing; exclusive resolution keeps this to at most one provider today.
 */
export function phpFrameworkViewDataEntryFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkViewDataEntry | null {
  for (const provider of providers) {
    const entry = provider.viewData?.entryFromSource?.({ source });

    if (entry) {
      return entry;
    }
  }

  return null;
}

/**
 * Text-search anchors the active providers use to surface the sources feeding
 * data into templates. Empty when no active provider ships viewData.
 */
export function phpFrameworkViewDataSearchQueries(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): readonly string[] {
  return phpFrameworkTargetSearchQueries("viewData", providers);
}

/**
 * Whether any active provider ships a viewData capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * view-data checks.
 */
export function phpFrameworkSupportsViewData(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.viewData !== undefined);
}

/**
 * First validation-rule reference detected at the cursor across the active
 * providers. Exclusive resolution keeps this to at most one provider today, so
 * the first non-null match wins and non-validation providers are inert.
 */
export function phpFrameworkValidationRuleReferenceAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkValidationRuleReference | null {
  for (const provider of providers) {
    const reference = provider.validation?.ruleReferenceAt?.({
      position,
      source,
    });

    if (reference) {
      return reference;
    }
  }

  return null;
}

/**
 * Validation-rule completions for a prefix, aggregated across the active
 * providers. Providers without a validation capability contribute nothing.
 */
export function phpFrameworkValidationRuleCompletions(
  prefix: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkValidationRuleCompletion[] {
  return providers.flatMap(
    (provider) => provider.validation?.ruleCompletions?.({ prefix }) ?? [],
  );
}

/**
 * Whether any active provider ships a validation capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * validation checks.
 */
export function phpFrameworkSupportsValidation(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.validation !== undefined);
}

/**
 * First string-literal helper classification detected at the cursor across the
 * active providers. Exclusive resolution keeps this to at most one provider
 * today, so the first non-null match wins and non-stringLiteral providers are
 * inert.
 */
export function phpFrameworkStringLiteralHelperAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkStringLiteralHelperMatch | null {
  for (const provider of providers) {
    const match = provider.stringLiterals?.helperAt?.({ offset, source });

    if (match) {
      return match;
    }
  }

  return null;
}

export function phpFrameworkScopedStringCompletionContextAt(
  source: string,
  position: EditorPosition,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.php?.isScopedStringCompletionContext?.({ position, source }) ??
      false,
  );
}

export function phpFrameworkPhpPresenterLinkAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkPhpPresenterLink | null {
  for (const provider of providers) {
    const link = provider.php?.presenterLinkAt?.({ offset, source });

    if (link) {
      return link;
    }
  }

  return null;
}

export function phpFrameworkPhpPresenterLinkCompletionAt(
  source: string,
  offset: number,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkPhpPresenterLinkCompletion | null {
  for (const provider of providers) {
    const completion = provider.php?.presenterLinkCompletionAt?.({
      offset,
      source,
    });

    if (completion) {
      return completion;
    }
  }

  return null;
}

export function phpFrameworkSupportsPhpPresenterLinks(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.php?.presenterLinkAt !== undefined ||
      provider.php?.presenterLinkCompletionAt !== undefined,
  );
}

/**
 * Whether any active provider ships a stringLiterals capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * string-helper navigation checks.
 */
export function phpFrameworkSupportsStringLiterals(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some((provider) => provider.stringLiterals !== undefined);
}

/**
 * Whether any active provider ships NEON config intelligence. Today this is a
 * Nette capability, but the application layer only asks the provider boundary.
 */
export function phpFrameworkSupportsNeonConfigIntelligence(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) => provider.neon?.supportsConfigIntelligence === true,
  );
}

/**
 * Whether any active provider ships semantic Latte template intelligence. Today
 * this is a Nette capability, but the application layer only asks the provider
 * boundary.
 */
export function phpFrameworkSupportsLatteTemplateIntelligence(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) => provider.latte?.supportsTemplateIntelligence === true,
  );
}

/**
 * Whether any active provider ships Nette-style Latte/PHP presenter-link
 * intelligence. Today Nette owns this capability; the application layer only
 * asks the provider boundary before resolving `{link}` / `n:href` /
 * `$this->link(...)` targets.
 */
export function phpFrameworkSupportsLattePresenterLinkIntelligence(
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.latte?.supportsPresenterLinkIntelligence === true,
  );
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

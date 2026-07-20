import type { EditorPosition } from "./languageServerFeatures";
import {
  createPhpFrameworkCapabilityRegistry,
  definePhpFrameworkCapability,
  type PhpFrameworkCapabilityDefinition,
  type PhpFrameworkCapabilityRegistry,
  type PhpFrameworkCapabilityToken,
} from "./phpFrameworkCapabilityRegistry";
import {
  hasPhpFrameworkProvider,
  phpFrameworkProviderCoreSignature,
} from "./phpFrameworkProviderCore";
import { selectPhpFrameworkProvidersForProject } from "./phpFrameworkProviderSelection";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
import type {
  PhpFrameworkSemanticCapabilities,
  PhpFrameworkSourceContext,
} from "./phpFrameworkSemanticContracts";
import { phpFrameworkSupportsTargetCollection } from "./phpFrameworkTargetCapabilities";
import type { PhpProjectDescriptor } from "./workspace";

export type {
  PhpFrameworkCapabilityDefinition,
  PhpFrameworkCapabilityRegistry,
  PhpFrameworkCapabilityToken,
} from "./phpFrameworkCapabilityRegistry";
export {
  createPhpFrameworkCapabilityRegistry,
  definePhpFrameworkCapability,
} from "./phpFrameworkCapabilityRegistry";
export type {
  PhpFrameworkProviderCore,
  PhpFrameworkProviderPresentation,
} from "./phpFrameworkProviderCore";

export type {
  PhpFrameworkContainerAutowiredCandidate,
  PhpFrameworkContainerAutowiredCandidatesContext,
  PhpFrameworkContainerBinding,
  PhpFrameworkContainerBindingPathContext,
  PhpFrameworkContainerBindingsContext,
  PhpFrameworkContainerConcreteClassNamesContext,
  PhpFrameworkContainerExpressionContext,
  PhpFrameworkMethodCallReturnTypeContext,
  PhpFrameworkPropertyTypeContext,
  PhpFrameworkQueryCallbackContext,
  PhpFrameworkQueryCallbackVariableContext,
  PhpFrameworkSameSourceMethodReturnFallbackContext,
  PhpFrameworkSemanticCapabilities,
  PhpFrameworkSemanticProvider,
  PhpFrameworkSourceContext,
} from "./phpFrameworkSemanticContracts";

export {
  phpFrameworkAuthorizationAbilityDefinitionsFromSource,
  phpFrameworkAuthorizationAbilitySearchQueries,
  phpFrameworkDispatchTargetAt,
  phpFrameworkEventListenerMapFromSource,
  phpFrameworkEventServiceProviderClassNames,
  phpFrameworkExplicitRouteModelBindingClassName,
  phpFrameworkExplicitRouteModelBindingSearchQueries,
  phpFrameworkMiddlewareAliasDefinitionsFromSource,
  phpFrameworkMiddlewareAliasSearchQueries,
  phpFrameworkModelNamespacePrefixes,
  phpFrameworkRouteCompletionContextAt,
  phpFrameworkRouteDefinitionsFromSource,
  phpFrameworkRouteModelBindingAt,
  phpFrameworkRouteReferenceAt,
  phpFrameworkRouteSearchQueries,
  phpFrameworkSupportsAuthorizationAbilities,
  phpFrameworkSupportsDispatch,
  phpFrameworkSupportsMiddlewareAliases,
  phpFrameworkSupportsRoutes,
  phpFrameworkSupportsTargetCollection,
  phpFrameworkTargetSearchQueries,
} from "./phpFrameworkTargetCapabilities";
export {
  isPhpFrameworkContainerBindingCandidatePath,
  phpFrameworkContainerAutowiredCandidatesFromSources,
  phpFrameworkContainerBindingsFromSource,
  phpFrameworkContainerConcreteClassNamesFromSource,
  phpFrameworkContainerConcreteClassNameFromSource,
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkPropertyTypeFromSource,
  phpFrameworkQueryCallbackContextForVariable,
  phpFrameworkSuppressesSameSourceMethodReturnFallback,
  phpFrameworkSupportsContainerBindingsFromSource,
} from "./phpFrameworkSemanticCapabilities";
export {
  isKnownPhpFrameworkMemberMethod,
  isKnownPhpFrameworkStaticMethod,
  phpFrameworkMemberMethodMagicDiagnostic,
  phpFrameworkMemberPropertyMagicDiagnostic,
  phpFrameworkStaticMethodMagicDiagnostic,
} from "./phpFrameworkMemberDispatch";
export {
  phpFrameworkConfigCompletionContextAt,
  phpFrameworkConfigKeysFromSource,
  phpFrameworkConfigLiteralTarget,
  phpFrameworkConfigMissingTargetMessage,
  phpFrameworkConfigReferenceAt,
  phpFrameworkConfigTargetFromSource,
  phpFrameworkEnvCompletionContextAt,
  phpFrameworkEnvEntriesFromSource,
  phpFrameworkEnvLiteralTarget,
  phpFrameworkEnvMissingTargetMessage,
  phpFrameworkEnvReferenceAt,
  phpFrameworkEnvTargetFromSource,
  phpFrameworkInertiaCompletionContextAt,
  phpFrameworkInertiaLiteralTarget,
  phpFrameworkInertiaReferenceAt,
  phpFrameworkJsonTranslationKeysFromSource,
  phpFrameworkJsonTranslationTargetFromSource,
  phpFrameworkRouteMissingTargetMessage,
  phpFrameworkScopedStringCompletionAt,
  phpFrameworkScopedStringCompletionContextAt,
  phpFrameworkStringLiteralHelperAt,
  phpFrameworkTranslationCompletionContextAt,
  phpFrameworkTranslationKeysFromSource,
  phpFrameworkTranslationLiteralTarget,
  phpFrameworkTranslationMissingTargetMessage,
  phpFrameworkTranslationReferenceAt,
  phpFrameworkTranslationTargetFromSource,
} from "./phpFrameworkLiteralDispatch";
export {
  phpFrameworkPhpPresenterLinkAt,
  phpFrameworkPhpPresenterLinkCompletionAt,
  phpFrameworkTemplateNameFromRelativePath,
  phpFrameworkViewCompletionContextAt,
  phpFrameworkViewDataEntryFromSource,
  phpFrameworkViewDataSearchQueries,
  phpFrameworkViewLiteralTarget,
  phpFrameworkViewMissingTargetMessage,
  phpFrameworkViewReferenceAt,
} from "./phpFrameworkTemplateDispatch";
export {
  phpFrameworkValidationRuleCompletions,
  phpFrameworkValidationRuleReferenceAt,
} from "./phpFrameworkValidationDispatch";

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

export interface PhpFrameworkRouteCompletionInsertTextContext {
  name: string;
  prefix: string;
}

export interface PhpFrameworkRouteMissingTargetMessageContext {
  name: string;
}

/** A named authorization ability declared in framework configuration/source. */
export interface PhpFrameworkAuthorizationAbilityDefinition {
  name: string;
  position: EditorPosition;
}

export interface PhpFrameworkAuthorizationAbilityDefinitionsContext {
  source: string;
}

/** A named middleware alias declared in framework configuration/source. */
export interface PhpFrameworkMiddlewareAliasDefinition {
  name: string;
  position: EditorPosition;
}

export interface PhpFrameworkMiddlewareAliasDefinitionsContext {
  source: string;
}

export interface PhpFrameworkRouteModelBinding {
  explicitModelClassName: string | null;
  modelShortName: string;
  parameterEnd: number;
  parameterName: string;
  parameterStart: number;
}

export interface PhpFrameworkRouteModelBindingContext {
  offset: number;
  source: string;
}

export interface PhpFrameworkExplicitRouteModelBindingContext {
  parameterName: string;
  source: string;
}

export interface PhpFrameworkModelNamespacePrefixesContext {
  php: PhpProjectDescriptor | null | undefined;
}

export type PhpFrameworkDispatchKind = "dispatch" | "event" | "job";

export interface PhpFrameworkDispatchTarget {
  className: string;
  kind: PhpFrameworkDispatchKind;
}

export interface PhpFrameworkDispatchTargetContext {
  offset: number;
  source: string;
}

export interface PhpFrameworkEventListenerMapContext {
  source: string;
}

export interface PhpFrameworkEventServiceProviderClassNamesContext {
  php: PhpProjectDescriptor | null | undefined;
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

export interface PhpFrameworkConfigCompletionInsertTextContext {
  key: string;
  prefix: string;
}

export interface PhpFrameworkConfigMissingTargetMessageContext {
  key: string;
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

export interface PhpFrameworkEnvCompletionInsertTextContext {
  name: string;
  prefix: string;
}

export interface PhpFrameworkEnvMissingTargetMessageContext {
  name: string;
}

export interface PhpFrameworkHelperNameCompletion {
  detail: string;
  insertText: string;
  label: string;
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

export interface PhpFrameworkTranslationCompletionInsertTextContext {
  key: string;
  prefix: string;
  relativePath: string;
}

export interface PhpFrameworkTranslationMissingTargetMessageContext {
  key: string;
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

export interface PhpFrameworkViewCompletionInsertTextContext {
  name: string;
  prefix: string;
}

export interface PhpFrameworkViewMissingTargetMessageContext {
  name: string;
}

export interface PhpFrameworkTemplateNameFromRelativePathContext {
  relativePath: string;
}

export interface PhpFrameworkInertiaReference {
  call: string;
  name: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpFrameworkInertiaReferenceContext {
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
  "config" | "route" | "view" | "trans" | "env";

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
  providerId?: string;
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

export type PhpFrameworkScopedStringCompletionKind =
  | "authGuard"
  | "broadcastConnection"
  | "cacheStore"
  | "databaseConnection"
  | "gateAbility"
  | "logChannel"
  | "mailMailer"
  | "middlewareAlias"
  | "passwordBroker"
  | "queueConnection"
  | "redisConnection"
  | "storageDisk";

export interface PhpFrameworkScopedStringCompletion {
  kind: PhpFrameworkScopedStringCompletionKind;
  prefix: string;
}

export interface PhpFrameworkResolvedScopedStringCompletion extends PhpFrameworkScopedStringCompletion {
  insertText: (name: string) => string;
  providerId: string;
}

export interface PhpFrameworkScopedStringCompletionInsertTextContext {
  kind: PhpFrameworkScopedStringCompletionKind;
  name: string;
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

export interface PhpFrameworkLattePresenterLinkContext {
  offset: number;
  source: string;
}

/**
 * A Latte presenter-link target detected in a template construct (Nette's
 * `{link}`, `{plink}`, `n:href` today). Shape mirrors the Nette detector but
 * keeps central Latte navigation code off Nette-specific imports.
 */
export interface PhpFrameworkLattePresenterLink {
  target: string;
  targetEnd: number;
  targetStart: number;
}

/** Replace range for Latte presenter-link target completions. */
export interface PhpFrameworkLattePresenterLinkCompletion {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

/**
 * The structural decomposition of a presenter-link destination. Mirrors
 * Nette's `NetteLinkTarget` so the provider seam stays framework-neutral.
 */
export interface PhpFrameworkPresenterLinkTarget {
  absolute: boolean;
  action: string;
  isSignal: boolean;
  module: string | null;
  presenter: string | null;
}

export interface PhpFrameworkPresenterLinkTargetContext {
  target: string;
}

export interface PhpFrameworkPresenterActionMethodsContext {
  action: string;
  isSignal: boolean;
}

export interface PhpFrameworkPresenterClassCandidatesContext {
  currentRelativePath: string;
  target: PhpFrameworkPresenterLinkTarget;
}

export interface PhpFrameworkPresenterLinkTargetsContext {
  path: string;
  source: string;
}

export interface PhpFrameworkPresenterSourcePathContext {
  path: string;
}

export interface PhpFrameworkBladeSourceContext {
  offset: number;
  source: string;
}

export type PhpFrameworkBladeReferenceKind =
  "view" | "component" | "livewire" | "section" | "stack";

export interface PhpFrameworkBladeReference {
  kind: PhpFrameworkBladeReferenceKind;
  name: string;
  nameEnd: number;
  nameStart: number;
}

export interface PhpFrameworkBladeDirectiveCompletion {
  directivePrefix: string;
  start: number;
}

export interface PhpFrameworkBladeComponentCompletion {
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

export interface PhpFrameworkBladeComponentAttributeCompletion {
  componentName: string;
  existingAttributeNames: string[];
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

export interface PhpFrameworkBladeComponentNameContext {
  name: string;
}

export interface PhpFrameworkBladeReferenceCandidatesContext {
  reference: Pick<PhpFrameworkBladeReference, "kind" | "name">;
  workspaceRoot: string;
}

export interface PhpFrameworkBladeFileTarget {
  path: string;
  relativePath: string;
}

export type PhpFrameworkMissingTemplateReferenceDetector = (
  source: string,
  offset: number,
  language: "blade" | "php",
  templateNames: readonly string[],
) => { name: string; relativePath: string } | null;

export type PhpFrameworkTargetCollectionKind = "routes" | "viewData";

export interface PhpFrameworkTargetCollectionCapability {
  kind: PhpFrameworkTargetCollectionKind;
  searchQueries: readonly string[];
}

/**
 * Framework-owned active-document diagnostics registration.
 *
 * `kind` is the stable contribution identifier and `language` is the editor
 * language the contribution accepts. Both remain open strings so a new
 * framework can register diagnostics without changing the semantic core.
 */
export interface PhpFrameworkActiveDocumentDiagnosticsDescriptor<
  Kind extends string = string,
  Language extends string = string,
> {
  readonly kind: Kind;
  readonly language: Language;
}

export function definePhpFrameworkActiveDocumentDiagnostics<
  const Descriptors extends
    readonly PhpFrameworkActiveDocumentDiagnosticsDescriptor[],
>(descriptors: Descriptors): Descriptors {
  return descriptors;
}

export type PhpFrameworkFileChangeInvalidationDescriptor =
  | {
      kind: "bladeComponentNames";
    }
  | {
      kind: "bladeViewDataEntries";
    }
  | {
      kind: "latteExpressionData";
    }
  | {
      kind: "neonConfig";
    };

export interface PhpFrameworkNewFileSkeleton {
  importName: string;
  parentName: string;
}

export interface PhpFrameworkNewFileContext {
  path: string;
}

export interface PhpFrameworkProvider {
  id: string;
  presentation?: {
    /** Compact framework name shown alongside active IDE runtime status. */
    activityLabel?: string;
  };
  forProject?: (php: PhpProjectDescriptor) => PhpFrameworkProvider;
  /**
   * Plugin detection: returns true when this framework is present in the
   * project. Detection lives on the provider so registering a new framework
   * (Nette, Symfony, ...) never touches the dispatcher - the registry simply
   * asks each provider whether it applies.
   */
  appliesTo?: (php: PhpProjectDescriptor) => boolean;
  newFiles?: {
    skeletonForPath?: (
      context: PhpFrameworkNewFileContext,
    ) => PhpFrameworkNewFileSkeleton | null;
  };
  codeActions?: {
    missingTemplateFile?: {
      detectMissingReference: PhpFrameworkMissingTemplateReferenceDetector;
    };
    phpPresenterLinkMethod?: true;
  };
  completions?: {
    memberCompletionsFromSource?: (
      context: PhpFrameworkMemberCompletionContext,
    ) => PhpMethodCompletion[];
    /**
     * Provider-owned opt-in for Nette UI redraw snippet completions inside
     * `$this->redrawControl('...')` PHP method calls. Kept intentionally
     * narrow so generic method completion routing does not inherit broader
     * Nette/Latte semantics.
     */
    supportsNetteRedrawControlSnippetCompletions?: true;
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
     * neutral `framework-magic` marker; the Laravel provider declares
     * `laravel-magic` and the Nette provider `nette-magic` so downgraded hints
     * carry their framework's label. Read once per filter pass by
     * `phpLanguageServerDiagnosticFilters`; it never affects severity or WHICH
     * diagnostics are downgraded (that is driven purely by the predicates
     * above), only the label a user sees on the resulting soft hint.
     */
    magicSource?: string;
  };
  targetCollections?: readonly PhpFrameworkTargetCollectionCapability[];
  activeDocumentDiagnostics?: readonly PhpFrameworkActiveDocumentDiagnosticsDescriptor[];
  fileChangeInvalidations?: readonly PhpFrameworkFileChangeInvalidationDescriptor[];
  routes?: {
    referenceAt?: (
      context: PhpFrameworkRouteReferenceContext,
    ) => PhpFrameworkRouteReference | null;
    completionInsertText?: (
      context: PhpFrameworkRouteCompletionInsertTextContext,
    ) => string;
    missingTargetMessage?: (
      context: PhpFrameworkRouteMissingTargetMessageContext,
    ) => string;
    definitionsFromSource?: (
      context: PhpFrameworkRouteDefinitionsContext,
    ) => PhpFrameworkRouteDefinition[];
    modelBindingAt?: (
      context: PhpFrameworkRouteModelBindingContext,
    ) => PhpFrameworkRouteModelBinding | null;
    explicitModelBindingClassNameFromSource?: (
      context: PhpFrameworkExplicitRouteModelBindingContext,
    ) => string | null;
    modelNamespacePrefixes?: (
      context: PhpFrameworkModelNamespacePrefixesContext,
    ) => string[];
    /**
     * Text-search anchors that surface files declaring named routes outside the
     * active document (route files, `->name(...)` chains, resource
     * registrations). Owned by the provider so the controller's route collector
     * is framework-agnostic.
     */
    searchQueries?: readonly string[];
    /**
     * Text-search anchors that surface explicit route model-binding
     * declarations outside the active document. Owned by the provider so route
     * model navigation stays framework-agnostic.
     */
    explicitModelBindingSearchQueries?: readonly string[];
  };
  authorizationAbilities?: {
    definitionsFromSource?: (
      context: PhpFrameworkAuthorizationAbilityDefinitionsContext,
    ) => PhpFrameworkAuthorizationAbilityDefinition[];
    /**
     * Text-search anchors that surface files declaring authorization abilities
     * outside the active document. Owned by the provider so application
     * collectors do not depend on one framework's registration API.
     */
    searchQueries?: readonly string[];
  };
  middlewareAliases?: {
    definitionsFromSource?: (
      context: PhpFrameworkMiddlewareAliasDefinitionsContext,
    ) => PhpFrameworkMiddlewareAliasDefinition[];
    /**
     * Text-search anchors that surface files declaring middleware aliases
     * outside the active document. Owned by the provider so application
     * collectors do not depend on one framework's Kernel shape.
     */
    searchQueries?: readonly string[];
  };
  dispatch?: {
    eventListenerMapFromSource?: (
      context: PhpFrameworkEventListenerMapContext,
    ) => Map<string, string[]>;
    eventServiceProviderClassNames?: (
      context: PhpFrameworkEventServiceProviderClassNamesContext,
    ) => string[];
    targetAt?: (
      context: PhpFrameworkDispatchTargetContext,
    ) => PhpFrameworkDispatchTarget | null;
  };
  config?: {
    referenceAt?: (
      context: PhpFrameworkConfigReferenceContext,
    ) => PhpFrameworkConfigReference | null;
    completionInsertText?: (
      context: PhpFrameworkConfigCompletionInsertTextContext,
    ) => string;
    missingTargetMessage?: (
      context: PhpFrameworkConfigMissingTargetMessageContext,
    ) => string;
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
    completionInsertText?: (
      context: PhpFrameworkEnvCompletionInsertTextContext,
    ) => string;
    missingTargetMessage?: (
      context: PhpFrameworkEnvMissingTargetMessageContext,
    ) => string;
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
  inertia?: {
    appliesTo?: (php: PhpProjectDescriptor) => boolean;
    referenceAt?: (
      context: PhpFrameworkInertiaReferenceContext,
    ) => PhpFrameworkInertiaReference | null;
    resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
  };
  translations?: {
    referenceAt?: (
      context: PhpFrameworkTranslationReferenceContext,
    ) => PhpFrameworkTranslationReference | null;
    completionInsertText?: (
      context: PhpFrameworkTranslationCompletionInsertTextContext,
    ) => string;
    missingTargetMessage?: (
      context: PhpFrameworkTranslationMissingTargetMessageContext,
    ) => string;
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
    completionInsertText?: (
      context: PhpFrameworkViewCompletionInsertTextContext,
    ) => string;
    missingTargetMessage?: (
      context: PhpFrameworkViewMissingTargetMessageContext,
    ) => string;
    resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    templateNameFromRelativePath?: (
      context: PhpFrameworkTemplateNameFromRelativePathContext,
    ) => string | null;
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
    /**
     * Provider-owned opt-in for variables assigned through component/control
     * factory-created template instances (Nette `createComponent*` today).
     * The application layer owns file discovery and caching, but this gate
     * keeps the framework-specific scan behind the provider contract.
     */
    supportsComponentFactoryVariables?: true;
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
    helperNameCompletions?: () => readonly PhpFrameworkHelperNameCompletion[];
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
    scopedStringCompletionAt?: (
      context: PhpFrameworkPhpStringCompletionContext,
    ) => PhpFrameworkScopedStringCompletion | null;
    scopedStringCompletionInsertText?: (
      context: PhpFrameworkScopedStringCompletionInsertTextContext,
    ) => string;
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
  blade?: {
    componentAttributeCompletionAt?: (
      context: PhpFrameworkBladeSourceContext,
    ) => PhpFrameworkBladeComponentAttributeCompletion | null;
    componentCompletionAt?: (
      context: PhpFrameworkBladeSourceContext,
    ) => PhpFrameworkBladeComponentCompletion | null;
    componentNavigationCandidateRelativePaths?: (
      context: PhpFrameworkBladeComponentNameContext,
    ) => string[];
    directiveCompletionAt?: (
      context: PhpFrameworkBladeSourceContext,
    ) => PhpFrameworkBladeDirectiveCompletion | null;
    directiveNames?: readonly string[];
    isInsideComment?: (context: PhpFrameworkBladeSourceContext) => boolean;
    referenceAt?: (
      context: PhpFrameworkBladeSourceContext,
    ) => PhpFrameworkBladeReference | null;
    referenceCandidateWorkspacePaths?: (
      context: PhpFrameworkBladeReferenceCandidatesContext,
    ) => PhpFrameworkBladeFileTarget[];
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
    isPresenterSourcePath?: (
      context: PhpFrameworkPresenterSourcePathContext,
    ) => boolean;
    parsePresenterLinkTarget?: (
      context: PhpFrameworkPresenterLinkTargetContext,
    ) => PhpFrameworkPresenterLinkTarget | null;
    presenterActionMethodCandidates?: (
      context: PhpFrameworkPresenterActionMethodsContext,
    ) => string[];
    presenterClassCandidatePathsForLink?: (
      context: PhpFrameworkPresenterClassCandidatesContext,
    ) => string[];
    presenterLinkAt?: (
      context: PhpFrameworkLattePresenterLinkContext,
    ) => PhpFrameworkLattePresenterLink | null;
    presenterLinkCompletionAt?: (
      context: PhpFrameworkLattePresenterLinkContext,
    ) => PhpFrameworkLattePresenterLinkCompletion | null;
    presenterLinkTargetsFromSource?: (
      context: PhpFrameworkPresenterLinkTargetsContext,
    ) => string[];
    presenterScanDirectories?: readonly string[];
  };
  semantics?: PhpFrameworkSemanticCapabilities;
}


export type KnownPhpFrameworkProviderCapability =
  | "authorizationAbilities"
  | "config"
  | "containerBindingsFromSource"
  | "codeActions"
  | "dispatch"
  | "env"
  | "inertia"
  | "containerConcreteClassNamesFromSource"
  | "lattePresenterLinkIntelligence"
  | "latteTemplateIntelligence"
  | "middlewareAliases"
  | "neonConfigIntelligence"
  | "newFiles"
  | "phpPresenterLinks"
  | "routes"
  | "stringLiterals"
  | "translations"
  | "validation"
  | "viewData"
  | "viewDataComponentFactories"
  | "views";

/**
 * Backwards-compatible open capability seam. Existing capabilities retain
 * literal autocomplete while framework adapters may introduce new tokens
 * without editing this module.
 */
export type PhpFrameworkProviderCapability =
  | KnownPhpFrameworkProviderCapability
  | (PhpFrameworkCapabilityToken & Record<never, never>);

export interface PhpFrameworkProviderCapabilityRegistry
  extends PhpFrameworkCapabilityRegistry<PhpFrameworkProviderCapability> {
  supportsTargetCollection(kind: PhpFrameworkTargetCollectionKind): boolean;
}

export interface PhpFrameworkRouteCompletionContext {
  provider: PhpFrameworkProvider;
  reference: PhpFrameworkRouteReference;
}

export interface PhpFrameworkConfigCompletionContext {
  provider: PhpFrameworkProvider;
  reference: PhpFrameworkConfigReference;
}

export interface PhpFrameworkEnvCompletionContext {
  provider: PhpFrameworkProvider;
  reference: PhpFrameworkEnvReference;
}

export interface PhpFrameworkTranslationCompletionContext {
  provider: PhpFrameworkProvider;
  reference: PhpFrameworkTranslationReference;
}

export interface PhpFrameworkViewCompletionContext {
  provider: PhpFrameworkProvider;
  reference: PhpFrameworkViewReference;
}

export interface PhpFrameworkInertiaCompletionContext {
  provider: PhpFrameworkProvider;
  reference: PhpFrameworkInertiaReference;
}

export function createPhpFrameworkProviderCapabilityRegistry(
  providers: readonly PhpFrameworkProvider[],
  additionalDefinitions: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[] =
    [],
): PhpFrameworkProviderCapabilityRegistry {
  const registry = createPhpFrameworkCapabilityRegistry({
    definitions: [
      ...BUILT_IN_PHP_FRAMEWORK_CAPABILITIES,
      ...additionalDefinitions,
    ],
    providers,
  });

  return {
    ...registry,
    supportsTargetCollection: (kind) =>
      phpFrameworkSupportsTargetCollection(kind, providers),
  };
}

/**
 * Active provider set for a project: exclusive by construction (exactly zero or
 * one provider). It shares the single detection pass with the framework profile
 * via the neutral provider selector, so a project can never carry two active
 * frameworks at once.
 */
export function phpFrameworkProvidersForProject(
  php: PhpProjectDescriptor | null,
  registry: readonly PhpFrameworkProvider[],
): readonly PhpFrameworkProvider[] {
  return selectPhpFrameworkProvidersForProject(php, registry).providers;
}

export function phpFrameworkProviderSignature(
  providers: readonly PhpFrameworkProvider[],
): string {
  return phpFrameworkProviderCoreSignature(providers);
}

export function isPhpFrameworkProviderActive(
  providers: readonly PhpFrameworkProvider[],
  providerId: string,
): boolean {
  return hasPhpFrameworkProvider(providers, providerId);
}

export function phpFrameworkSupportsEnv(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "env");
}

/**
 * Whether any active provider ships a config capability - the framework-agnostic
 * gate that replaces the hardcoded `isLaravelFrameworkActive` config checks.
 */
export function phpFrameworkSupportsConfig(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "config");
}

/**
 * Whether any active provider ships a translations capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * translation checks.
 */
export function phpFrameworkSupportsTranslations(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "translations");
}

export function phpFrameworkSupportsInertia(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "inertia");
}

/**
 * Whether any active provider ships a templating capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * view checks.
 */
export function phpFrameworkSupportsViews(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "views");
}

/**
 * Whether any active provider ships a viewData capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * view-data checks.
 */
export function phpFrameworkSupportsViewData(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "viewData");
}

export function phpFrameworkSupportsViewDataComponentFactories(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(
    providers,
    "viewDataComponentFactories",
  );
}

/**
 * Whether any active provider ships a validation capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * validation checks.
 */
export function phpFrameworkSupportsValidation(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "validation");
}

export function phpFrameworkSupportsPhpPresenterLinks(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "phpPresenterLinks");
}

/**
 * Whether any active provider ships a stringLiterals capability - the
 * framework-agnostic gate that replaces the hardcoded `isLaravelFrameworkActive`
 * string-helper navigation checks.
 */
export function phpFrameworkSupportsStringLiterals(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(providers, "stringLiterals");
}

/**
 * Whether any active provider ships NEON config intelligence. Today this is a
 * Nette capability, but the application layer only asks the provider boundary.
 */
export function phpFrameworkSupportsNeonConfigIntelligence(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(
    providers,
    "neonConfigIntelligence",
  );
}

/**
 * Whether any active provider ships semantic Latte template intelligence. Today
 * this is a Nette capability, but the application layer only asks the provider
 * boundary.
 */
export function phpFrameworkSupportsLatteTemplateIntelligence(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(
    providers,
    "latteTemplateIntelligence",
  );
}

/**
 * Whether any active provider ships Nette-style Latte/PHP presenter-link
 * intelligence. Today Nette owns this capability; the application layer only
 * asks the provider boundary before resolving `{link}` / `n:href` /
 * `$this->link(...)` targets.
 */
export function phpFrameworkSupportsLattePresenterLinkIntelligence(
  providers: readonly PhpFrameworkProvider[],
): boolean {
  return phpFrameworkProvidersSupportCapability(
    providers,
    "lattePresenterLinkIntelligence",
  );
}

const BUILT_IN_PHP_FRAMEWORK_CAPABILITIES = [
  definePhpFrameworkCapability(
    "authorizationAbilities",
    (provider: PhpFrameworkProvider) =>
      provider.authorizationAbilities !== undefined,
  ),
  definePhpFrameworkCapability(
    "codeActions",
    (provider: PhpFrameworkProvider) => provider.codeActions !== undefined,
  ),
  definePhpFrameworkCapability(
    "config",
    (provider: PhpFrameworkProvider) => provider.config !== undefined,
  ),
  definePhpFrameworkCapability(
    "containerBindingsFromSource",
    (provider: PhpFrameworkProvider) =>
      provider.semantics?.containerBindingsFromSource !== undefined,
  ),
  definePhpFrameworkCapability(
    "containerConcreteClassNamesFromSource",
    (provider: PhpFrameworkProvider) =>
      provider.semantics?.containerConcreteClassNamesFromSource !== undefined,
  ),
  definePhpFrameworkCapability(
    "dispatch",
    (provider: PhpFrameworkProvider) => provider.dispatch !== undefined,
  ),
  definePhpFrameworkCapability(
    "env",
    (provider: PhpFrameworkProvider) => provider.env !== undefined,
  ),
  definePhpFrameworkCapability(
    "inertia",
    (provider: PhpFrameworkProvider) => provider.inertia !== undefined,
  ),
  definePhpFrameworkCapability(
    "lattePresenterLinkIntelligence",
    (provider: PhpFrameworkProvider) =>
      provider.latte?.supportsPresenterLinkIntelligence === true,
  ),
  definePhpFrameworkCapability(
    "latteTemplateIntelligence",
    (provider: PhpFrameworkProvider) =>
      provider.latte?.supportsTemplateIntelligence === true,
  ),
  definePhpFrameworkCapability(
    "middlewareAliases",
    (provider: PhpFrameworkProvider) =>
      provider.middlewareAliases !== undefined,
  ),
  definePhpFrameworkCapability(
    "neonConfigIntelligence",
    (provider: PhpFrameworkProvider) =>
      provider.neon?.supportsConfigIntelligence === true,
  ),
  definePhpFrameworkCapability(
    "newFiles",
    (provider: PhpFrameworkProvider) =>
      provider.newFiles?.skeletonForPath !== undefined,
  ),
  definePhpFrameworkCapability(
    "phpPresenterLinks",
    (provider: PhpFrameworkProvider) =>
      provider.php?.presenterLinkAt !== undefined ||
      provider.php?.presenterLinkCompletionAt !== undefined,
  ),
  definePhpFrameworkCapability(
    "routes",
    (provider: PhpFrameworkProvider) => provider.routes !== undefined,
  ),
  definePhpFrameworkCapability(
    "stringLiterals",
    (provider: PhpFrameworkProvider) => provider.stringLiterals !== undefined,
  ),
  definePhpFrameworkCapability(
    "translations",
    (provider: PhpFrameworkProvider) => provider.translations !== undefined,
  ),
  definePhpFrameworkCapability(
    "validation",
    (provider: PhpFrameworkProvider) => provider.validation !== undefined,
  ),
  definePhpFrameworkCapability(
    "viewData",
    (provider: PhpFrameworkProvider) => provider.viewData !== undefined,
  ),
  definePhpFrameworkCapability(
    "viewDataComponentFactories",
    (provider: PhpFrameworkProvider) =>
      provider.viewData?.supportsComponentFactoryVariables === true,
  ),
  definePhpFrameworkCapability(
    "views",
    (provider: PhpFrameworkProvider) => provider.templating !== undefined,
  ),
] as const;

const BUILT_IN_PHP_FRAMEWORK_CAPABILITIES_BY_TOKEN = new Map<
  PhpFrameworkProviderCapability,
  PhpFrameworkCapabilityDefinition<
    PhpFrameworkProvider,
    PhpFrameworkProviderCapability
  >
>();

for (const definition of BUILT_IN_PHP_FRAMEWORK_CAPABILITIES) {
  BUILT_IN_PHP_FRAMEWORK_CAPABILITIES_BY_TOKEN.set(
    definition.token,
    definition,
  );
}

function phpFrameworkProvidersSupportCapability(
  providers: readonly PhpFrameworkProvider[],
  capability: PhpFrameworkProviderCapability,
): boolean {
  const definition =
    BUILT_IN_PHP_FRAMEWORK_CAPABILITIES_BY_TOKEN.get(capability);

  if (!definition) {
    return false;
  }

  return providers.some(definition.isSupportedBy);
}

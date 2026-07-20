import type { PhpFrameworkProviderCore } from "./phpFrameworkProviderCore";
import type {
  PhpFrameworkConfigKey,
  PhpFrameworkConfigKeysContext,
  PhpFrameworkConfigReference,
  PhpFrameworkConfigReferenceContext,
  PhpFrameworkConfigTargetContext,
  PhpFrameworkEnvEntriesContext,
  PhpFrameworkEnvEntry,
  PhpFrameworkEnvReference,
  PhpFrameworkEnvReferenceContext,
  PhpFrameworkEnvTargetContext,
  PhpFrameworkInertiaReference,
  PhpFrameworkInertiaReferenceContext,
  PhpFrameworkLiteralTargetContext,
  PhpFrameworkMemberMethodContext,
  PhpFrameworkMemberPropertyContext,
  PhpFrameworkPhpPresenterLink,
  PhpFrameworkPhpPresenterLinkCompletion,
  PhpFrameworkPhpPresenterLinkContext,
  PhpFrameworkPhpStringCompletionContext,
  PhpFrameworkResolvedLiteralTarget,
  PhpFrameworkScopedStringCompletion,
  PhpFrameworkScopedStringCompletionInsertTextContext,
  PhpFrameworkStaticMethodContext,
  PhpFrameworkStringLiteralContext,
  PhpFrameworkStringLiteralHelperMatch,
  PhpFrameworkTargetCollectionCapability,
  PhpFrameworkTranslationKey,
  PhpFrameworkTranslationKeysContext,
  PhpFrameworkTranslationReference,
  PhpFrameworkTranslationReferenceContext,
  PhpFrameworkTranslationTargetContext,
  PhpFrameworkValidationRuleCompletion,
  PhpFrameworkValidationRuleCompletionContext,
  PhpFrameworkValidationRuleReference,
  PhpFrameworkValidationRuleReferenceContext,
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataEntryContext,
  PhpFrameworkViewReference,
  PhpFrameworkViewReferenceContext,
} from "./phpFrameworkProviders";

export interface PhpFrameworkLiteralCapabilityPort
  extends PhpFrameworkProviderCore {
  readonly routes?: {
    readonly missingTargetMessage?: (context: { name: string }) => string;
  };
  readonly config?: {
    readonly referenceAt?: (
      context: PhpFrameworkConfigReferenceContext,
    ) => PhpFrameworkConfigReference | null;
    readonly keysFromSource?: (
      context: PhpFrameworkConfigKeysContext,
    ) => PhpFrameworkConfigKey[];
    readonly targetFromSource?: (
      context: PhpFrameworkConfigTargetContext,
    ) => PhpFrameworkConfigKey | null;
    readonly resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    readonly missingTargetMessage?: (context: { key: string }) => string;
  };
  readonly env?: {
    readonly referenceAt?: (
      context: PhpFrameworkEnvReferenceContext,
    ) => PhpFrameworkEnvReference | null;
    readonly entriesFromSource?: (
      context: PhpFrameworkEnvEntriesContext,
    ) => PhpFrameworkEnvEntry[];
    readonly targetFromSource?: (
      context: PhpFrameworkEnvTargetContext,
    ) => PhpFrameworkEnvEntry | null;
    readonly resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    readonly missingTargetMessage?: (context: { name: string }) => string;
  };
  readonly translations?: {
    readonly referenceAt?: (
      context: PhpFrameworkTranslationReferenceContext,
    ) => PhpFrameworkTranslationReference | null;
    readonly keysFromSource?: (
      context: PhpFrameworkTranslationKeysContext,
    ) => PhpFrameworkTranslationKey[];
    readonly targetFromSource?: (
      context: PhpFrameworkTranslationTargetContext,
    ) => PhpFrameworkTranslationKey | null;
    readonly resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    readonly missingTargetMessage?: (context: { key: string }) => string;
    readonly jsonKeysFromSource?: (context: {
      source: string;
    }) => PhpFrameworkTranslationKey[];
    readonly jsonTargetFromSource?: (context: {
      key: string;
      source: string;
    }) => PhpFrameworkTranslationKey | null;
  };
  readonly inertia?: {
    readonly referenceAt?: (
      context: PhpFrameworkInertiaReferenceContext,
    ) => PhpFrameworkInertiaReference | null;
    readonly resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
  };
  readonly stringLiterals?: {
    readonly helperAt?: (
      context: PhpFrameworkStringLiteralContext,
    ) => PhpFrameworkStringLiteralHelperMatch | null;
  };
  readonly php?: {
    readonly isScopedStringCompletionContext?: (
      context: PhpFrameworkPhpStringCompletionContext,
    ) => boolean;
    readonly scopedStringCompletionAt?: (
      context: PhpFrameworkPhpStringCompletionContext,
    ) => PhpFrameworkScopedStringCompletion | null;
    readonly scopedStringCompletionInsertText?: (
      context: PhpFrameworkScopedStringCompletionInsertTextContext,
    ) => string;
  };
}

export interface PhpFrameworkMemberDiagnosticPort
  extends PhpFrameworkProviderCore {
  readonly diagnostics?: {
    readonly isKnownMemberMethod?: (
      context: PhpFrameworkMemberMethodContext,
    ) => boolean;
    readonly isKnownMemberProperty?: (
      context: PhpFrameworkMemberPropertyContext,
    ) => boolean;
    readonly isKnownStaticMethod?: (
      context: PhpFrameworkStaticMethodContext,
    ) => boolean;
    readonly magicSource?: string;
  };
}

export interface PhpFrameworkTargetSearchQueryPort {
  readonly targetCollections?: readonly PhpFrameworkTargetCollectionCapability[];
  readonly routes?: { readonly searchQueries?: readonly string[] };
  readonly viewData?: { readonly searchQueries?: readonly string[] };
}

export interface PhpFrameworkTemplateCapabilityPort
  extends PhpFrameworkProviderCore,
    PhpFrameworkTargetSearchQueryPort {
  readonly templating?: {
    readonly referenceAt?: (
      context: PhpFrameworkViewReferenceContext,
    ) => PhpFrameworkViewReference | null;
    readonly resolveLiteralTarget?: (
      context: PhpFrameworkLiteralTargetContext,
    ) => PhpFrameworkResolvedLiteralTarget | null;
    readonly missingTargetMessage?: (context: { name: string }) => string;
    readonly templateNameFromRelativePath?: (context: {
      relativePath: string;
    }) => string | null;
  };
  readonly viewData?: PhpFrameworkTargetSearchQueryPort["viewData"] & {
    readonly entryFromSource?: (
      context: PhpFrameworkViewDataEntryContext,
    ) => PhpFrameworkViewDataEntry;
  };
  readonly php?: {
    readonly presenterLinkAt?: (
      context: PhpFrameworkPhpPresenterLinkContext,
    ) => PhpFrameworkPhpPresenterLink | null;
    readonly presenterLinkCompletionAt?: (
      context: PhpFrameworkPhpPresenterLinkContext,
    ) => PhpFrameworkPhpPresenterLinkCompletion | null;
  };
}

export interface PhpFrameworkValidationCapabilityPort
  extends PhpFrameworkProviderCore {
  readonly validation?: {
    readonly ruleReferenceAt?: (
      context: PhpFrameworkValidationRuleReferenceContext,
    ) => PhpFrameworkValidationRuleReference | null;
    readonly ruleCompletions?: (
      context: PhpFrameworkValidationRuleCompletionContext,
    ) => PhpFrameworkValidationRuleCompletion[];
  };
}

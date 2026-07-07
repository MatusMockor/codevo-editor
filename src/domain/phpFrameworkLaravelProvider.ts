import { bladeViewDataEntryFromSource } from "./bladeViewVariables";
import { detectLaravelStringLiteralHelper } from "./laravelStringLiteralHelpers";
import {
  isLaravelApiResourceMemberMethod,
  isLaravelApiResourceStaticMethod,
  isLaravelEloquentBuilderMacroFromSource,
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentLocalScopeMemberMethod,
  isLaravelEloquentLocalScopeStaticMethod,
  isLaravelEloquentStaticBuilderReceiver,
  isLaravelMacroMemberMethodFromSource,
  phpLaravelApiResourceCompletionsFromSource,
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelMacroCompletionsFromSource,
  phpLaravelMethodCallReturnTypeFromSource,
  phpLaravelModelAttributeCompletionsFromSource,
  phpLaravelModelPropertyClassTypeFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
} from "./phpFrameworkLaravel";
import type { PhpFrameworkProvider } from "./phpFrameworkProviders";
import {
  phpLaravelConfigKeysFromSource,
  phpLaravelConfigReferenceContextAt,
  phpLaravelConfigTargetFromSource,
} from "./phpLaravelConfig";
import {
  phpLaravelEnvEntriesFromSource,
  phpLaravelEnvReferenceContextAt,
  phpLaravelEnvTargetFromSource,
} from "./phpLaravelEnv";
import {
  phpLaravelNamedRouteDefinitions,
  phpLaravelNamedRouteReferenceContextAt,
} from "./phpLaravelRoutes";
import { phpLaravelScopedStringCompletionContextAt } from "./phpLaravelScopedCompletions";
import {
  phpLaravelJsonTranslationKeysFromSource,
  phpLaravelJsonTranslationTargetFromSource,
  phpLaravelTranslationKeysFromSource,
  phpLaravelTranslationReferenceContextAt,
  phpLaravelTranslationTargetFromSource,
} from "./phpLaravelTranslations";
import {
  phpLaravelValidationRuleCompletions,
  phpLaravelValidationRuleStringContextAt,
} from "./phpLaravelValidation";
import { phpLaravelViewReferenceContextAt } from "./phpLaravelViews";
import type { PhpProjectDescriptor } from "./workspace";

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

/**
 * Text-search anchors for the sources feeding data into Blade views. Kept beside
 * the provider (not the controller) so view-data knowledge stays
 * framework-owned; a future provider ships its own anchors (Latte presenters).
 */
const laravelViewDataSearchQueries: readonly string[] = [
  "view(",
  "View::make",
  "->with(",
  "compact(",
];

export function isLaravelPhpProject(php: PhpProjectDescriptor): boolean {
  if (php.packageName === "laravel/laravel") {
    return true;
  }

  return php.packages.some(
    (composerPackage) => composerPackage.name === "laravel/framework",
  );
}

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
  targetCollections: [
    {
      kind: "routes",
      searchQueries: laravelRouteSearchQueries,
    },
    {
      kind: "viewData",
      searchQueries: laravelViewDataSearchQueries,
    },
  ],
  config: {
    referenceAt: ({ position, source }) =>
      phpLaravelConfigReferenceContextAt(source, position),
    keysFromSource: ({ fileName, source }) =>
      phpLaravelConfigKeysFromSource(source, fileName),
    targetFromSource: ({ fileName, key, source }) =>
      phpLaravelConfigTargetFromSource(source, fileName, key),
  },
  env: {
    referenceAt: ({ position, source }) =>
      phpLaravelEnvReferenceContextAt(source, position),
    entriesFromSource: ({ source }) => phpLaravelEnvEntriesFromSource(source),
    targetFromSource: ({ name, source }) =>
      phpLaravelEnvTargetFromSource(source, name),
  },
  translations: {
    referenceAt: ({ position, source }) =>
      phpLaravelTranslationReferenceContextAt(source, position),
    keysFromSource: ({ fileName, source }) =>
      phpLaravelTranslationKeysFromSource(source, fileName),
    targetFromSource: ({ fileName, key, source }) =>
      phpLaravelTranslationTargetFromSource(source, fileName, key),
    jsonKeysFromSource: ({ source }) =>
      phpLaravelJsonTranslationKeysFromSource(source),
    jsonTargetFromSource: ({ key, source }) =>
      phpLaravelJsonTranslationTargetFromSource(source, key),
  },
  templating: {
    referenceAt: ({ position, source }) =>
      phpLaravelViewReferenceContextAt(source, position),
  },
  viewData: {
    entryFromSource: ({ source }) => bladeViewDataEntryFromSource(source),
    searchQueries: laravelViewDataSearchQueries,
  },
  validation: {
    ruleReferenceAt: ({ position, source }) =>
      phpLaravelValidationRuleStringContextAt(source, position),
    ruleCompletions: ({ prefix }) =>
      phpLaravelValidationRuleCompletions(prefix),
  },
  stringLiterals: {
    helperAt: ({ offset, source }) =>
      detectLaravelStringLiteralHelper(source, offset),
  },
  php: {
    isScopedStringCompletionContext: ({ position, source }) =>
      phpLaravelScopedStringCompletionContextAt(source, position),
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

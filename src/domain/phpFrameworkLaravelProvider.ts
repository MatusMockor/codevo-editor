import { bladeViewDataEntryFromSource } from "./bladeViewVariables";
import { detectLaravelStringLiteralHelper } from "./laravelStringLiteralHelpers";
import { missingLaravelViewReferenceAt } from "./laravelDiagnostics";
import { phpLaravelGateAbilityDefinitions } from "./phpLaravelAuthorization";
import {
  resolveLaravelConfigTarget,
  resolveLaravelEnvTarget,
  resolveLaravelTransTarget,
  resolveLaravelViewTarget,
} from "./laravelPathResolution";
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
  detectLaravelRouteModelBindingAt,
  explicitLaravelRouteModelBindingClassName,
  phpModelNamespacePrefixes,
} from "./laravelRouteModelBinding";
import {
  phpEventServiceProviderClassNames,
  phpLaravelDispatchTargetAt,
  phpLaravelEventListenerMap,
} from "./phpLaravelDispatch";
import {
  phpLaravelConfigCompletionInsertText,
  phpLaravelConfigKeysFromSource,
  phpLaravelConfigReferenceContextAt,
  phpLaravelConfigTargetFromSource,
} from "./phpLaravelConfig";
import {
  phpLaravelEnvCompletionInsertText,
  phpLaravelEnvEntriesFromSource,
  phpLaravelEnvReferenceContextAt,
  phpLaravelEnvTargetFromSource,
} from "./phpLaravelEnv";
import {
  phpLaravelNamedRouteDefinitions,
  phpLaravelNamedRouteReferenceContextAt,
} from "./phpLaravelRoutes";
import { resolveLaravelLivewireTarget } from "./phpLaravelLivewire";
import {
  phpLaravelInertiaReferenceContextAt,
  resolveLaravelInertiaComponentTarget,
} from "./phpLaravelInertia";
import {
  phpLaravelScopedStringCompletionAt,
  phpLaravelScopedStringCompletionContextAt,
  phpLaravelScopedStringCompletionInsertText,
} from "./phpLaravelScopedCompletions";
import {
  phpLaravelJsonTranslationCompletionInsertText,
  phpLaravelJsonTranslationKeysFromSource,
  phpLaravelJsonTranslationTargetFromSource,
  phpLaravelTranslationCompletionInsertText,
  phpLaravelTranslationKeysFromSource,
  phpLaravelTranslationReferenceContextAt,
  phpLaravelTranslationTargetFromSource,
} from "./phpLaravelTranslations";
import { phpLaravelMiddlewareAliasDefinitions } from "./phpLaravelMiddleware";
import {
  phpLaravelValidationRuleCompletions,
  phpLaravelValidationRuleStringContextAt,
} from "./phpLaravelValidation";
import {
  phpLaravelViewCompletionInsertText,
  phpLaravelViewNameFromRelativePath,
  phpLaravelViewReferenceContextAt,
} from "./phpLaravelViews";
import type { PhpProjectDescriptor } from "./workspace";
import { phpLaravelQueryCallbackContextForVariable } from "./phpLaravelQueryCallbackContext";

interface PhpLaravelFrameworkProvider extends PhpFrameworkProvider {
  livewire?: {
    resolveLiteralTarget?: (context: {
      literal: string;
    }) => object | null;
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

const laravelExplicitRouteModelBindingSearchQueries: readonly string[] = [
  "Route::model",
  "Route::bind",
];

const laravelAuthorizationAbilitySearchQueries: readonly string[] = [
  "Gate::define",
];

const laravelMiddlewareAliasSearchQueries: readonly string[] = [
  "middlewareAliases",
  "routeMiddleware",
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

const laravelStringLiteralHelperNameCompletions = [
  {
    detail: "Laravel helper",
    insertText: "old()",
    label: "old",
  },
  {
    detail: "Laravel helper",
    insertText: "route()",
    label: "route",
  },
  {
    detail: "Laravel helper",
    insertText: "asset()",
    label: "asset",
  },
  {
    detail: "Laravel helper",
    insertText: "config()",
    label: "config",
  },
  {
    detail: "Laravel translation helper",
    insertText: "__()",
    label: "__",
  },
  {
    detail: "Laravel helper",
    insertText: "csrf_field()",
    label: "csrf_field",
  },
] as const;

function isLaravelContainerBindingCandidatePath(path: string): boolean {
  const normalizedPath = path.split("\\").join("/").toLowerCase();

  return (
    /(?:^|\/)app\/providers\/[^/]+\.php$/.test(normalizedPath) ||
    /(?:^|\/)bootstrap\/app\.php$/.test(normalizedPath)
  );
}

export function isLaravelPhpProject(php: PhpProjectDescriptor): boolean {
  if (php.packageName === "laravel/laravel") {
    return true;
  }

  return php.packages.some(
    (composerPackage) => composerPackage.name === "laravel/framework",
  );
}

export function isLaravelInertiaPhpProject(
  php: PhpProjectDescriptor,
): boolean {
  return php.packages.some(
    (composerPackage) => composerPackage.name === "inertiajs/inertia-laravel",
  );
}

const laravelInertiaCapability: NonNullable<
  PhpFrameworkProvider["inertia"]
> = {
  appliesTo: (php) => isLaravelInertiaPhpProject(php),
  referenceAt: ({ position, source }) =>
    phpLaravelInertiaReferenceContextAt(source, position),
  resolveLiteralTarget: ({ literal }) =>
    resolveLaravelInertiaComponentTarget(literal),
};

export const phpLaravelFrameworkProvider: PhpLaravelFrameworkProvider = {
  id: "laravel",
  presentation: { activityLabel: "Laravel" },
  appliesTo: (php) => isLaravelPhpProject(php),
  newFiles: {
    skeletonForPath: ({ path }) => {
      if (path.startsWith("app/Models/")) {
        return {
          importName: "Illuminate\\Database\\Eloquent\\Model",
          parentName: "Model",
        };
      }

      if (!path.startsWith("app/Http/Requests/")) {
        return null;
      }

      return {
        importName: "Illuminate\\Foundation\\Http\\FormRequest",
        parentName: "FormRequest",
      };
    },
  },
  codeActions: {
    missingTemplateFile: {
      detectMissingReference: missingLaravelViewReferenceAt,
    },
  },
  forProject: (php) => {
    if (!laravelInertiaCapability.appliesTo?.(php)) {
      return phpLaravelFrameworkProvider;
    }

    return {
      ...phpLaravelFrameworkProvider,
      inertia: laravelInertiaCapability,
    };
  },
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
    completionInsertText: ({ name, prefix }) =>
      phpLaravelNamedRouteCompletionInsertText(name, prefix),
    definitionsFromSource: ({ source }) =>
      phpLaravelNamedRouteDefinitions(source),
    explicitModelBindingClassNameFromSource: ({ parameterName, source }) =>
      explicitLaravelRouteModelBindingClassName(source, parameterName),
    modelBindingAt: ({ offset, source }) =>
      detectLaravelRouteModelBindingAt(source, offset),
    modelNamespacePrefixes: ({ php }) => phpModelNamespacePrefixes(php),
    referenceAt: ({ position, source }) =>
      phpLaravelNamedRouteReferenceContextAt(source, position),
    searchQueries: laravelRouteSearchQueries,
    explicitModelBindingSearchQueries:
      laravelExplicitRouteModelBindingSearchQueries,
  },
  dispatch: {
    eventListenerMapFromSource: ({ source }) => phpLaravelEventListenerMap(source),
    eventServiceProviderClassNames: ({ php }) =>
      phpEventServiceProviderClassNames(php),
    targetAt: ({ offset, source }) => phpLaravelDispatchTargetAt(source, offset),
  },
  authorizationAbilities: {
    definitionsFromSource: ({ source }) =>
      phpLaravelGateAbilityDefinitions(source),
    searchQueries: laravelAuthorizationAbilitySearchQueries,
  },
  middlewareAliases: {
    definitionsFromSource: ({ source }) =>
      phpLaravelMiddlewareAliasDefinitions(source),
    searchQueries: laravelMiddlewareAliasSearchQueries,
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
    completionInsertText: ({ key, prefix }) =>
      phpLaravelConfigCompletionInsertText(key, prefix),
    referenceAt: ({ position, source }) =>
      phpLaravelConfigReferenceContextAt(source, position),
    resolveLiteralTarget: ({ literal }) => resolveLaravelConfigTarget(literal),
    keysFromSource: ({ fileName, source }) =>
      phpLaravelConfigKeysFromSource(source, fileName),
    targetFromSource: ({ fileName, key, source }) =>
      phpLaravelConfigTargetFromSource(source, fileName, key),
  },
  env: {
    completionInsertText: ({ name }) => phpLaravelEnvCompletionInsertText(name),
    referenceAt: ({ position, source }) =>
      phpLaravelEnvReferenceContextAt(source, position),
    resolveLiteralTarget: ({ literal }) => resolveLaravelEnvTarget(literal),
    entriesFromSource: ({ source }) => phpLaravelEnvEntriesFromSource(source),
    targetFromSource: ({ name, source }) =>
      phpLaravelEnvTargetFromSource(source, name),
  },
  translations: {
    completionInsertText: ({ key, prefix, relativePath }) =>
      relativePath.endsWith(".json")
        ? phpLaravelJsonTranslationCompletionInsertText(key, prefix)
        : phpLaravelTranslationCompletionInsertText(key, prefix),
    referenceAt: ({ position, source }) =>
      phpLaravelTranslationReferenceContextAt(source, position),
    resolveLiteralTarget: ({ literal }) => resolveLaravelTransTarget(literal),
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
    completionInsertText: ({ name, prefix }) =>
      phpLaravelViewCompletionInsertText(name, prefix),
    referenceAt: ({ position, source }) =>
      phpLaravelViewReferenceContextAt(source, position),
    resolveLiteralTarget: ({ literal }) => resolveLaravelViewTarget(literal),
    templateNameFromRelativePath: ({ relativePath }) =>
      phpLaravelViewNameFromRelativePath(relativePath),
  },
  livewire: {
    resolveLiteralTarget: ({ literal }) => resolveLaravelLivewireTarget(literal),
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
    helperNameCompletions: () => laravelStringLiteralHelperNameCompletions,
  },
  php: {
    isScopedStringCompletionContext: ({ position, source }) =>
      phpLaravelScopedStringCompletionContextAt(source, position),
    scopedStringCompletionAt: ({ position, source }) =>
      phpLaravelScopedStringCompletionAt(source, position),
    scopedStringCompletionInsertText: ({ kind, name }) =>
      phpLaravelScopedStringCompletionInsertText(kind, name),
  },
  semantics: {
    suppressesSameSourceMethodReturnFallback: ({ methodName }) =>
      methodName === "findOrFail",
    queryCallbackContextForVariable: ({ position, source, variableName }) =>
      phpLaravelQueryCallbackContextForVariable(source, position, variableName),
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
    isContainerBindingCandidatePath: ({ path }) =>
      isLaravelContainerBindingCandidatePath(path),
  },
};

function phpLaravelNamedRouteCompletionInsertText(
  routeName: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return routeName;
  }

  return routeName.slice(lastDotIndex + 1);
}

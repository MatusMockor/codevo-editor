import {
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentBuilderMacroFromSource,
  isLaravelEloquentLocalScopeMemberMethod,
  isLaravelEloquentLocalScopeStaticMethod,
  isLaravelEloquentStaticBuilderReceiver,
  phpLaravelEloquentBuilderModelTypeFromExpression,
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  phpLaravelMacroCompletionsFromSource,
  phpLaravelMethodCallReturnTypeFromSource,
  phpLaravelModelAttributeCompletionsFromSource,
  phpLaravelModelPropertyClassTypeFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
} from "./phpFrameworkLaravel";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
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

export interface PhpFrameworkProvider {
  id: string;
  completions?: {
    memberCompletionsFromSource?: (
      context: PhpFrameworkMemberCompletionContext,
    ) => PhpMethodCompletion[];
  };
  diagnostics?: {
    isKnownMemberMethod?: (context: PhpFrameworkMemberMethodContext) => boolean;
    isKnownStaticMethod?: (context: PhpFrameworkStaticMethodContext) => boolean;
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

export const phpLaravelFrameworkProvider: PhpFrameworkProvider = {
  id: "laravel",
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
    ],
  },
  diagnostics: {
    isKnownMemberMethod: ({
      methodName,
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
      isLaravelEloquentLocalScopeMemberMethod(
        source,
        receiverExpression,
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
      isLaravelEloquentLocalScopeStaticMethod(source, className, methodName),
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

export const defaultPhpFrameworkProviders: readonly PhpFrameworkProvider[] = [];

export function phpFrameworkProvidersForProject(
  php: PhpProjectDescriptor | null,
): readonly PhpFrameworkProvider[] {
  if (!php) {
    return [];
  }

  return isLaravelPhpProject(php) ? [phpLaravelFrameworkProvider] : [];
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
): boolean {
  return providers.some(
    (provider) =>
      provider.diagnostics?.isKnownMemberMethod?.({
        methodName,
        receiverExpression,
        source,
        sourceContext,
      }) ?? false,
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

export function phpFrameworkContainerBindingsFromSource(
  source: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): PhpFrameworkContainerBinding[] {
  return providers.flatMap(
    (provider) =>
      provider.semantics?.containerBindingsFromSource?.({ source }) ?? [],
  );
}

function isLaravelPhpProject(php: PhpProjectDescriptor): boolean {
  if (php.packageName === "laravel/laravel") {
    return true;
  }

  return php.packages.some(
    (composerPackage) => composerPackage.name === "laravel/framework",
  );
}

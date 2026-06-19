import {
  isLaravelEloquentBuilderMethodName,
  isLaravelEloquentStaticBuilderReceiver,
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  phpLaravelMethodCallReturnTypeFromSource,
  phpLaravelModelAttributeClassTypeFromSource,
  phpLaravelModelAttributeCompletionsFromSource,
  phpLaravelRelationPropertyCompletionsFromSource,
} from "./phpFrameworkLaravel";
import type { PhpMethodCompletion } from "./phpMethodCompletions";
import type { PhpProjectDescriptor } from "./workspace";

export interface PhpFrameworkMemberCompletionContext {
  declaringClassName: string;
  source: string;
}

export interface PhpFrameworkStaticMethodContext {
  className: string;
  methodName: string;
  source: string;
}

export interface PhpFrameworkPropertyTypeContext {
  propertyName: string;
  source: string;
}

export interface PhpFrameworkMethodCallReturnTypeContext {
  methodName: string;
  receiverExpression: string | null;
  receiverType: string | null;
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

export interface PhpFrameworkProvider {
  id: string;
  completions?: {
    memberCompletionsFromSource?: (
      context: PhpFrameworkMemberCompletionContext,
    ) => PhpMethodCompletion[];
  };
  diagnostics?: {
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
    memberCompletionsFromSource: ({ declaringClassName, source }) => [
      ...phpLaravelModelAttributeCompletionsFromSource(source, declaringClassName),
      ...phpLaravelRelationPropertyCompletionsFromSource(
        source,
        declaringClassName,
      ),
    ],
  },
  diagnostics: {
    isKnownStaticMethod: ({ className, methodName, source }) =>
      isLaravelEloquentBuilderMethodName(methodName) &&
      isLaravelEloquentStaticBuilderReceiver(source, className),
  },
  semantics: {
    propertyTypeFromSource: ({ propertyName, source }) =>
      phpLaravelModelAttributeClassTypeFromSource(source, propertyName),
    methodCallReturnTypeFromSource: ({
      methodName,
      receiverExpression,
      receiverType,
      source,
    }) =>
      phpLaravelMethodCallReturnTypeFromSource(
        source,
        methodName,
        receiverType,
        receiverExpression,
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
): PhpMethodCompletion[] {
  return providers.flatMap(
    (provider) =>
      provider.completions?.memberCompletionsFromSource?.({
        declaringClassName,
        source,
      }) ??
      [],
  );
}

export function isKnownPhpFrameworkStaticMethod(
  source: string,
  className: string,
  methodName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): boolean {
  return providers.some(
    (provider) =>
      provider.diagnostics?.isKnownStaticMethod?.({
        className,
        methodName,
        source,
      }) ?? false,
  );
}

export function phpFrameworkPropertyTypeFromSource(
  source: string,
  propertyName: string,
  providers: readonly PhpFrameworkProvider[] = defaultPhpFrameworkProviders,
): string | null {
  for (const provider of providers) {
    const propertyType = provider.semantics?.propertyTypeFromSource?.({
      propertyName,
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
): string | null {
  for (const provider of providers) {
    const returnType = provider.semantics?.methodCallReturnTypeFromSource?.({
      methodName,
      receiverExpression,
      receiverType,
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

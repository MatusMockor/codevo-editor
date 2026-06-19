import {
  isLaravelEloquentBuilderMethodName,
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
    isKnownStaticMethod: ({ methodName }) =>
      isLaravelEloquentBuilderMethodName(methodName),
  },
};

export const defaultPhpFrameworkProviders: readonly PhpFrameworkProvider[] = [
  phpLaravelFrameworkProvider,
];

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

function isLaravelPhpProject(php: PhpProjectDescriptor): boolean {
  if (php.packageName === "laravel/laravel") {
    return true;
  }

  return php.packages.some(
    (composerPackage) => composerPackage.name === "laravel/framework",
  );
}

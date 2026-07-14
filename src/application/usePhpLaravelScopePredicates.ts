import { useCallback } from "react";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { phpLaravelLocalScopeCompletionsFromMethods } from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface UsePhpLaravelScopePredicatesOptions {
  collectPhpFrameworkSyntheticMethodsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  frameworkRuntime: PhpFrameworkRuntimeContext;
}

export function usePhpLaravelScopePredicates({
  collectPhpFrameworkSyntheticMethodsForClass,
  collectPhpMethodsForClass,
  frameworkRuntime,
}: UsePhpLaravelScopePredicatesOptions) {
  const hasLaravelProvider = frameworkRuntime.hasProvider("laravel");

  const phpClassHasLaravelDynamicWhere = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      if (!hasLaravelProvider) {
        return false;
      }

      const methodLookup = methodName.toLowerCase();
      const dynamicWhereCompletions =
        await collectPhpFrameworkSyntheticMethodsForClass(className);

      return dynamicWhereCompletions.some(
        (method) => method.name.toLowerCase() === methodLookup,
      );
    },
    [collectPhpFrameworkSyntheticMethodsForClass, hasLaravelProvider],
  );

  const phpClassHasLaravelLocalScope = useCallback(
    async (className: string, scopeName: string): Promise<boolean> => {
      if (!hasLaravelProvider) {
        return false;
      }

      const scopeLookup = scopeName.toLowerCase();
      const scopeCompletions = phpLaravelLocalScopeCompletionsFromMethods(
        await collectPhpMethodsForClass(className),
      );

      return scopeCompletions.some(
        (scope) => scope.name.toLowerCase() === scopeLookup,
      );
    },
    [collectPhpMethodsForClass, hasLaravelProvider],
  );

  return {
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
  };
}

import { useCallback } from "react";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { phpLaravelLocalScopeCompletionsFromMethods } from "../domain/phpFrameworkLaravel";

interface UsePhpLaravelScopePredicatesOptions {
  collectPhpLaravelDynamicWhereMethodsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  isLaravelFrameworkActive: boolean;
}

export function usePhpLaravelScopePredicates({
  collectPhpLaravelDynamicWhereMethodsForClass,
  collectPhpMethodsForClass,
  isLaravelFrameworkActive,
}: UsePhpLaravelScopePredicatesOptions) {
  const phpClassHasLaravelDynamicWhere = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      const methodLookup = methodName.toLowerCase();
      const dynamicWhereCompletions =
        await collectPhpLaravelDynamicWhereMethodsForClass(className);

      return dynamicWhereCompletions.some(
        (method) => method.name.toLowerCase() === methodLookup,
      );
    },
    [collectPhpLaravelDynamicWhereMethodsForClass],
  );

  const phpClassHasLaravelLocalScope = useCallback(
    async (className: string, scopeName: string): Promise<boolean> => {
      if (!isLaravelFrameworkActive) {
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
    [collectPhpMethodsForClass, isLaravelFrameworkActive],
  );

  return {
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
  };
}

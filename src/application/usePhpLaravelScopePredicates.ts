import { useCallback } from "react";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import { phpLaravelLocalScopeCompletionsFromMethods } from "../domain/phpFrameworkLaravel";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

interface UsePhpLaravelScopePredicatesOptions {
  collectPhpLaravelDynamicWhereMethodsForClass(
    className: string,
  ): Promise<PhpMethodCompletion[]>;
  collectPhpMethodsForClass(className: string): Promise<PhpMethodCompletion[]>;
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
}

export function usePhpLaravelScopePredicates({
  collectPhpLaravelDynamicWhereMethodsForClass,
  collectPhpMethodsForClass,
  frameworkRuntime,
  isLaravelFrameworkActive: legacyIsLaravelFrameworkActive = false,
}: UsePhpLaravelScopePredicatesOptions) {
  const isLaravelFrameworkActive =
    frameworkRuntime?.isLaravel ?? legacyIsLaravelFrameworkActive;

  const phpClassHasLaravelDynamicWhere = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      if (!isLaravelFrameworkActive) {
        return false;
      }

      const methodLookup = methodName.toLowerCase();
      const dynamicWhereCompletions =
        await collectPhpLaravelDynamicWhereMethodsForClass(className);

      return dynamicWhereCompletions.some(
        (method) => method.name.toLowerCase() === methodLookup,
      );
    },
    [collectPhpLaravelDynamicWhereMethodsForClass, isLaravelFrameworkActive],
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

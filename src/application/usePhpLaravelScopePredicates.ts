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
  const phpClassHasLaravelDynamicWhere = useCallback(
    async (className: string, methodName: string): Promise<boolean> => {
      if (!frameworkRuntime.isLaravel) {
        return false;
      }

      const methodLookup = methodName.toLowerCase();
      const dynamicWhereCompletions =
        await collectPhpFrameworkSyntheticMethodsForClass(className);

      return dynamicWhereCompletions.some(
        (method) => method.name.toLowerCase() === methodLookup,
      );
    },
    [collectPhpFrameworkSyntheticMethodsForClass, frameworkRuntime.isLaravel],
  );

  const phpClassHasLaravelLocalScope = useCallback(
    async (className: string, scopeName: string): Promise<boolean> => {
      if (!frameworkRuntime.isLaravel) {
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
    [collectPhpMethodsForClass, frameworkRuntime.isLaravel],
  );

  return {
    phpClassHasLaravelDynamicWhere,
    phpClassHasLaravelLocalScope,
  };
}

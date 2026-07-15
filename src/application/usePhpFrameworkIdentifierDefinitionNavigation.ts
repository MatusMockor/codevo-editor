import { useCallback } from "react";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  goToPhpFrameworkIdentifierDefinition as goToPhpFrameworkIdentifierDefinitionForContext,
  type PhpFrameworkIdentifierDefinitionHandler,
  type PhpFrameworkIdentifierDefinitionNavigationAdapter,
} from "./phpFrameworkIdentifierDefinitionNavigation";
import type { NavigationRequest } from "./navigationRequest";

export interface PhpFrameworkIdentifierDefinitionNavigationDependencies {
  adapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
  contextualAdapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
}

export interface PhpFrameworkIdentifierDefinitionNavigation {
  goToPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
  goToContextualPhpFrameworkIdentifierDefinition: PhpFrameworkIdentifierDefinitionHandler;
}

export function usePhpFrameworkIdentifierDefinitionNavigation({
  adapters,
  contextualAdapters,
}: PhpFrameworkIdentifierDefinitionNavigationDependencies): PhpFrameworkIdentifierDefinitionNavigation {
  const goToPhpFrameworkIdentifierDefinition = useCallback(
    async (
      context: PhpIdentifierContext,
      request?: NavigationRequest,
    ): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(
        context,
        { adapters },
        request,
      ),
    [adapters],
  );

  const goToContextualPhpFrameworkIdentifierDefinition = useCallback(
    async (
      context: PhpIdentifierContext,
      request?: NavigationRequest,
    ): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(
        context,
        { adapters: contextualAdapters },
        request,
      ),
    [contextualAdapters],
  );

  return {
    goToContextualPhpFrameworkIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
  };
}

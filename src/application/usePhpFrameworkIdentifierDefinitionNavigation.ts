import { useCallback } from "react";
import type { PhpIdentifierContext } from "../domain/phpNavigation";
import {
  goToPhpFrameworkIdentifierDefinition as goToPhpFrameworkIdentifierDefinitionForContext,
  type PhpFrameworkIdentifierDefinitionHandler,
  type PhpFrameworkIdentifierDefinitionNavigationAdapter,
} from "./phpFrameworkIdentifierDefinitionNavigation";

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
    async (context: PhpIdentifierContext): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(context, { adapters }),
    [adapters],
  );

  const goToContextualPhpFrameworkIdentifierDefinition = useCallback(
    async (context: PhpIdentifierContext): Promise<boolean> =>
      goToPhpFrameworkIdentifierDefinitionForContext(context, {
        adapters: contextualAdapters,
      }),
    [contextualAdapters],
  );

  return {
    goToContextualPhpFrameworkIdentifierDefinition,
    goToPhpFrameworkIdentifierDefinition,
  };
}

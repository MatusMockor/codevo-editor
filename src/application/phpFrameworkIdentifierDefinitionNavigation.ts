import type { PhpIdentifierContext } from "../domain/phpNavigation";
import { canNavigate, type NavigationRequest } from "./navigationRequest";

export type PhpFrameworkIdentifierDefinitionHandler = (
  context: PhpIdentifierContext,
  request?: NavigationRequest,
) => Promise<boolean>;

export interface PhpFrameworkIdentifierDefinitionNavigationAdapter {
  goToDefinition: PhpFrameworkIdentifierDefinitionHandler;
}

export interface PhpFrameworkIdentifierDefinitionNavigationDependencies {
  adapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
}

export async function goToPhpFrameworkIdentifierDefinition(
  context: PhpIdentifierContext,
  {
    adapters,
  }: PhpFrameworkIdentifierDefinitionNavigationDependencies,
  request?: NavigationRequest,
): Promise<boolean> {
  for (const adapter of adapters) {
    if (!canNavigate(request)) {
      return false;
    }

    const handled = request
      ? await adapter.goToDefinition(context, request)
      : await adapter.goToDefinition(context);

    if (!canNavigate(request)) {
      return false;
    }

    if (handled) {
      return true;
    }
  }

  return false;
}

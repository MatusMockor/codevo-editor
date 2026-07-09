import type { PhpIdentifierContext } from "../domain/phpNavigation";

export type PhpFrameworkIdentifierDefinitionHandler = (
  context: PhpIdentifierContext,
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
): Promise<boolean> {
  for (const adapter of adapters) {
    const handled = await adapter.goToDefinition(context);

    if (handled) {
      return true;
    }
  }

  return false;
}

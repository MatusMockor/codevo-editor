import type { PhpFrameworkIdentifierNavigationActivationAdapter } from "./phpFrameworkIdentifierNavigationAdapters";
import {
  createPhpNetteIdentifierDefinitionNavigationAdapter,
  type PhpNetteIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpNetteIdentifierDefinitionNavigationAdapter";

export function createPhpNetteIdentifierNavigationActivationAdapter(
  dependencies: PhpNetteIdentifierDefinitionNavigationAdapterDependencies,
): PhpFrameworkIdentifierNavigationActivationAdapter {
  return {
    providerId: "nette",
    create: () => {
      const adapter =
        createPhpNetteIdentifierDefinitionNavigationAdapter(dependencies);

      return {
        adapters: [adapter],
        contextualAdapters: [adapter],
      };
    },
  };
}

import type { PhpFrameworkIdentifierNavigationActivationAdapter } from "./phpFrameworkIdentifierNavigationAdapters";
import {
  createPhpLaravelIdentifierDefinitionNavigationAdapter,
  type PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpLaravelIdentifierDefinitionNavigationAdapter";

export function createPhpLaravelIdentifierNavigationActivationAdapter({
  openPhpClassTarget,
  ...dependencies
}: PhpLaravelIdentifierDefinitionNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationActivationAdapter {
  return {
    providerId: "laravel",
    create: () => ({
      adapters: [
        createPhpLaravelIdentifierDefinitionNavigationAdapter(dependencies),
      ],
      contextualAdapters: [
        createPhpLaravelIdentifierDefinitionNavigationAdapter({
          ...dependencies,
          openPhpClassTarget,
        }),
      ],
    }),
  };
}

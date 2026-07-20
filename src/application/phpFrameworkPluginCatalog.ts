import { phpLaravelFrameworkProvider } from "../domain/phpFrameworkLaravelProvider";
import { phpNetteFrameworkProvider } from "../domain/phpFrameworkNetteProvider";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import { assertUniquePhpFrameworkRegistrationIds } from "./phpFrameworkExtensionRegistry";

export function createPhpFrameworkPluginCatalog(
  providers: readonly PhpFrameworkProvider[],
): readonly PhpFrameworkProvider[] {
  assertUniquePhpFrameworkRegistrationIds(
    providers,
    "PHP framework plugin catalog",
  );
  return Object.freeze([...providers]);
}

export const phpFrameworkPluginCatalog = createPhpFrameworkPluginCatalog([
  phpLaravelFrameworkProvider,
  phpNetteFrameworkProvider,
]);

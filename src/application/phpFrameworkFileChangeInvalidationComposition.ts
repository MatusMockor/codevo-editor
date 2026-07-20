import {
  createPhpBladeFileChangeInvalidationContributions,
  type PhpBladeFileChangeInvalidationDependencies,
} from "./phpBladeFileChangeInvalidationContributions";
import {
  createPhpFrameworkFileChangeInvalidationContributionCatalog,
  type PhpFrameworkFileChangeInvalidationContributionCatalog,
} from "./phpFrameworkFileChangeInvalidationContributionCatalog";
import {
  createPhpNetteFileChangeInvalidationContributions,
  type PhpNetteFileChangeInvalidationDependencies,
} from "./phpNetteFileChangeInvalidationContributions";

export type PhpFrameworkFileChangeInvalidationCompositionDependencies =
  PhpBladeFileChangeInvalidationDependencies &
    PhpNetteFileChangeInvalidationDependencies;

export function composePhpFrameworkFileChangeInvalidationContributions(
  dependencies: PhpFrameworkFileChangeInvalidationCompositionDependencies,
): PhpFrameworkFileChangeInvalidationContributionCatalog {
  return createPhpFrameworkFileChangeInvalidationContributionCatalog([
    ...createPhpBladeFileChangeInvalidationContributions(dependencies),
    ...createPhpNetteFileChangeInvalidationContributions(dependencies),
  ]);
}

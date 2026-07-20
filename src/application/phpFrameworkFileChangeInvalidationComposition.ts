import {
  createPhpFrameworkFileChangeInvalidationContributionCatalog,
  type PhpFrameworkFileChangeInvalidationContributionCatalog,
} from "./phpFrameworkFileChangeInvalidationContributionCatalog";
import type {
  PhpFrameworkPlugin,
} from "./phpFrameworkPlugin";
import type { PhpBladeFileChangeInvalidationDependencies } from "./phpBladeFileChangeInvalidationContributions";
import type { PhpNetteFileChangeInvalidationDependencies } from "./phpNetteFileChangeInvalidationContributions";
import {
  phpFrameworkPluginContributions,
  phpFrameworkPlugins,
} from "./phpFrameworkPluginCatalog";

export type PhpFrameworkFileChangeInvalidationCompositionDependencies =
  PhpBladeFileChangeInvalidationDependencies &
    PhpNetteFileChangeInvalidationDependencies;

export function composePhpFrameworkFileChangeInvalidationContributions(
  dependencies: PhpFrameworkFileChangeInvalidationCompositionDependencies,
  plugins: readonly PhpFrameworkPlugin[] = phpFrameworkPlugins,
): PhpFrameworkFileChangeInvalidationContributionCatalog {
  return createPhpFrameworkFileChangeInvalidationContributionCatalog(
    phpFrameworkPluginContributions(
      plugins,
      (plugin) => plugin.invalidations,
      {
        invalidateComponentNames:
          dependencies.invalidateBladeComponentNamesForPath,
        invalidateConfiguration: dependencies.invalidateNeonConfigForPath,
        invalidateTemplateExpressions:
          dependencies.invalidateLatteExpressionDataForPath,
        invalidateTemplateViewData:
          dependencies.invalidateBladeViewDataEntriesForPath,
      },
      "PHP framework file-change invalidation catalog",
    ),
  );
}

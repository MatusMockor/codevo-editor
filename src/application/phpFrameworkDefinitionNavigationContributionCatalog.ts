import {
  createPhpFrameworkDefinitionNavigationRegistry,
  type PhpFrameworkDefinitionNavigationProvider,
} from "./phpFrameworkDefinitionNavigationContributions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkActivationContext } from "./phpFrameworkExtensionRegistry";
import type {
  PhpFrameworkPlugin,
  PhpFrameworkPluginNavigationDependencies,
} from "./phpFrameworkPlugin";
import {
  phpFrameworkPluginContributions,
  phpFrameworkPlugins,
} from "./phpFrameworkPluginCatalog";

export interface PhpFrameworkDefinitionNavigationContributionCatalogDependencies
  extends PhpFrameworkPluginNavigationDependencies {
  activation: PhpFrameworkActivationContext;
  frameworkRuntime: Pick<
    PhpFrameworkRuntimeContext,
    "hasProvider" | "supports"
  >;
  plugins?: readonly PhpFrameworkPlugin[];
}

export function createPhpFrameworkDefinitionNavigationContributionCatalog({
  activation,
  frameworkRuntime,
  plugins = phpFrameworkPlugins,
  ...dependencies
}: PhpFrameworkDefinitionNavigationContributionCatalogDependencies): PhpFrameworkDefinitionNavigationProvider {
  return createPhpFrameworkDefinitionNavigationRegistry({
    activation,
    frameworkRuntime,
    contributions: phpFrameworkPluginContributions(
      plugins,
      (plugin) => plugin.navigation,
      dependencies,
      "PHP framework definition navigation catalog",
    ),
  });
}

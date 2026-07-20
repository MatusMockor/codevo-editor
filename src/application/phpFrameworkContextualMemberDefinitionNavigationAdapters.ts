import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkSemanticAdapter,
  type PhpFrameworkSemanticAdapterContribution,
} from "./phpFrameworkSemanticAdapterRegistry";
import {
  genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  type PhpFrameworkContextualMemberDefinitionNavigationAdapter,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";
import type {
  PhpFrameworkPlugin,
  PhpFrameworkPluginContextualMemberNavigationDependencies,
} from "./phpFrameworkPlugin";
import { phpFrameworkPlugins } from "./phpFrameworkPluginCatalog";

export type PhpFrameworkContextualMemberDefinitionNavigationContribution =
  PhpFrameworkSemanticAdapterContribution<PhpFrameworkContextualMemberDefinitionNavigationAdapter>;

export interface PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  dependencies?: PhpFrameworkPluginContextualMemberNavigationDependencies;
  plugins?: readonly PhpFrameworkPlugin[];
  providerContributions?: readonly PhpFrameworkContextualMemberDefinitionNavigationContribution[];
}

export function createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
  frameworkRuntime,
  dependencies,
  plugins = phpFrameworkPlugins,
  providerContributions = [],
}: PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  const pluginContributions = dependencies
    ? plugins.flatMap((plugin) =>
        plugin.semantics?.contextualMemberNavigation
          ? [plugin.semantics.contextualMemberNavigation(dependencies)]
          : [],
      )
    : [];

  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    [...pluginContributions, ...providerContributions],
    genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  );
}

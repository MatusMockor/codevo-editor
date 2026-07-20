import type { PhpFrameworkCodeActionContributionAdapter } from "./phpFrameworkCodeActionContributions";
import type {
  PhpFrameworkPlugin,
} from "./phpFrameworkPlugin";
import type { PhpMissingTemplateFileCodeActionDependencies } from "./phpMissingTemplateFileCodeActionContribution";
import {
  phpFrameworkPluginContributions,
  phpFrameworkPlugins,
} from "./phpFrameworkPluginCatalog";

/** Application composition root for framework-owned PHP code actions. */
export function createPhpFrameworkCodeActionContributionCatalog(
  dependencies: PhpMissingTemplateFileCodeActionDependencies,
  plugins: readonly PhpFrameworkPlugin[] = phpFrameworkPlugins,
): readonly PhpFrameworkCodeActionContributionAdapter[] {
  return phpFrameworkPluginContributions(
    plugins,
    (plugin) => plugin.codeActions,
    {
      collectTemplateTargets: dependencies.collectViewTargets,
      readFileIfExists: dependencies.readTestFileIfExists,
      workspaceRoot: dependencies.workspaceRoot,
    },
    "PHP framework code-action contribution catalog",
  );
}

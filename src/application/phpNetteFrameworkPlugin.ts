import {
  phpNetteFrameworkProvider,
} from "../domain/phpFrameworkNetteProvider";
import { definePhpFrameworkCapability } from "../domain/phpFrameworkCapabilityRegistry";
import type { PhpFrameworkPluginProject } from "../domain/phpFrameworkProviderFeatures";
import type { PhpFrameworkPluginSnapshot } from "./phpFrameworkPlugin";
import {
  createPhpNetteLattePresenterLinkDiagnosticsContribution,
  createPhpNetteLatteTemplateReferenceDiagnosticsContribution,
} from "./phpNetteActiveDocumentDiagnosticsContributions";
import { createPhpNetteDatabaseDefinitionNavigationContribution } from "./phpNetteDatabaseDefinitionNavigationContribution";
import { createPhpNetteFileChangeInvalidationContributions } from "./phpNetteFileChangeInvalidationContributions";
import { phpNettePresenterLinkCodeActionContribution } from "./phpNettePresenterLinkCodeActionContribution";
import {
  phpFrameworkLegacyFeatures,
  projectPhpFrameworkLegacyProvider,
} from "./phpFrameworkLegacyProviderAdapter";

const netteProviderProjection = projectPhpFrameworkLegacyProvider(
  phpNetteFrameworkProvider,
);

const phpNetteFrameworkPluginCapabilityDefinitions = [
  definePhpFrameworkCapability(
    "netteDatabaseSemantics",
    (project: PhpFrameworkPluginProject) =>
      phpFrameworkLegacyFeatures(project)?.semantics
        ?.supportsNetteDatabaseSemantics === true,
  ),
  definePhpFrameworkCapability(
    "netteRedrawControlSnippetCompletions",
    (project: PhpFrameworkPluginProject) =>
      phpFrameworkLegacyFeatures(project)?.completions
        ?.supportsNetteRedrawControlSnippetCompletions === true,
  ),
] as const;

export const phpNetteFrameworkPlugin: PhpFrameworkPluginSnapshot = {
  capabilityDefinitions: phpNetteFrameworkPluginCapabilityDefinitions,
  codeActions: () => [phpNettePresenterLinkCodeActionContribution],
  diagnostics: ({
    collectTemplateRelativePaths,
    provideTemplateLinkDiagnostics,
  }) => [
    createPhpNetteLatteTemplateReferenceDiagnosticsContribution(
      collectTemplateRelativePaths,
    ),
    createPhpNetteLattePresenterLinkDiagnosticsContribution(
      provideTemplateLinkDiagnostics,
    ),
  ],
  invalidations: ({ invalidateConfiguration, invalidateTemplateExpressions }) =>
    createPhpNetteFileChangeInvalidationContributions({
      invalidateLatteExpressionDataForPath: invalidateTemplateExpressions,
      invalidateNeonConfigForPath: invalidateConfiguration,
    }),
  navigation: (dependencies) => [
    createPhpNetteDatabaseDefinitionNavigationContribution(dependencies),
  ],
  features: netteProviderProjection.features,
  provider: netteProviderProjection.provider,
};

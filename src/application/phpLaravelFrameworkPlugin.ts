import {
  phpLaravelFrameworkProvider,
  phpLaravelFrameworkProviderForProject,
} from "../domain/phpFrameworkLaravelProvider";
import { definePhpFrameworkCapability } from "../domain/phpFrameworkCapabilityRegistry";
import type { PhpFrameworkPluginProject } from "../domain/phpFrameworkProviderFeatures";
import { createPhpBladeViewReferenceDiagnosticsContribution } from "./phpBladeActiveDocumentDiagnosticsContribution";
import { createPhpBladeFileChangeInvalidationContributions } from "./phpBladeFileChangeInvalidationContributions";
import type { PhpFrameworkPluginSnapshot } from "./phpFrameworkPlugin";
import { createPhpLaravelMethodCompletionSemanticsAdapter } from "./phpLaravelMethodCompletionSemanticsAdapter";
import { createPhpLaravelModelSemanticsSourceAdapter } from "./phpLaravelModelSemanticsSourceAdapter";
import { createPhpLaravelContextualMemberDefinitionNavigationContribution } from "./phpLaravelContextualMemberDefinitionNavigationAdapter";
import { createPhpMissingTemplateFileCodeActionContribution } from "./phpMissingTemplateFileCodeActionContribution";
import { phpLaravelMemberCompletionContribution } from "./phpLaravelMemberCompletionContribution";
import {
  phpFrameworkLegacyFeatures,
  projectPhpFrameworkLegacyProvider,
} from "./phpFrameworkLegacyProviderAdapter";

const laravelProviderProjection = projectPhpFrameworkLegacyProvider(
  phpLaravelFrameworkProvider,
);

const phpLaravelFrameworkPluginCapabilityDefinitions = [
  definePhpFrameworkCapability(
    "eloquentModelSemantics",
    (project: PhpFrameworkPluginProject) =>
      phpFrameworkLegacyFeatures(project)?.semantics
        ?.supportsEloquentModelSemantics === true,
  ),
] as const;

export const phpLaravelFrameworkPlugin: PhpFrameworkPluginSnapshot = {
  capabilityDefinitions: phpLaravelFrameworkPluginCapabilityDefinitions,
  codeActions: ({ collectTemplateTargets, readFileIfExists, workspaceRoot }) => [
    createPhpMissingTemplateFileCodeActionContribution({
      collectViewTargets: collectTemplateTargets,
      readTestFileIfExists: readFileIfExists,
      workspaceRoot,
    }),
  ],
  diagnostics: ({ collectTemplateTargets }) => [
    createPhpBladeViewReferenceDiagnosticsContribution(collectTemplateTargets),
  ],
  invalidations: ({ invalidateComponentNames, invalidateTemplateViewData }) =>
    createPhpBladeFileChangeInvalidationContributions({
      invalidateBladeComponentNamesForPath: invalidateComponentNames,
      invalidateBladeViewDataEntriesForPath: invalidateTemplateViewData,
    }),
  memberCompletions: [phpLaravelMemberCompletionContribution],
  features: laravelProviderProjection.features,
  forProject: (php) =>
    projectPhpFrameworkLegacyProvider(
      phpLaravelFrameworkProviderForProject(php),
    ),
  provider: laravelProviderProjection.provider,
  semantics: {
    contextualMemberNavigation: ({
      openDirectMethodTarget,
      openDynamicMethodTarget,
      resolveBuilderModelType,
      resolveExpressionType,
      resolveRelationPathOwnerType,
    }) =>
      createPhpLaravelContextualMemberDefinitionNavigationContribution({
        openDirectPhpMethodTarget: openDirectMethodTarget,
        openPhpLaravelDynamicWhereTarget: openDynamicMethodTarget,
        resolvePhpEloquentBuilderModelType: resolveBuilderModelType,
        resolvePhpExpressionType: resolveExpressionType,
        resolvePhpLaravelRelationPathOwnerType: resolveRelationPathOwnerType,
      }),
    methodCompletion: ({
      collectPhpFrameworkSyntheticMethodsForClass,
      resolvePhpFrameworkBuilderModelType,
    }) => ({
      capability: "eloquentModelSemantics",
      id: "laravel-method-completion-semantics",
      priority: 100,
      createAdapter: () =>
        createPhpLaravelMethodCompletionSemanticsAdapter({
          collectPhpFrameworkSyntheticMethodsForClass,
          resolvePhpEloquentBuilderModelType:
            resolvePhpFrameworkBuilderModelType,
        }),
    }),
    modelSource: {
      capability: "eloquentModelSemantics",
      id: "laravel-model-source-semantics",
      priority: 100,
      createAdapter: createPhpLaravelModelSemanticsSourceAdapter,
    },
  },
};

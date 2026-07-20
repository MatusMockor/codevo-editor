import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { EditorPosition } from "../domain/languageServerFeatures";
import type { PhpFrameworkProviderCore } from "../domain/phpFrameworkProviderCore";
import type {
  PhpFrameworkFeatureBag,
  PhpFrameworkPluginProject,
} from "../domain/phpFrameworkProviderFeatures";
import type { PhpProjectDescriptor } from "../domain/workspace";
import type { PhpFrameworkCapabilityDefinition } from "../domain/phpFrameworkCapabilityRegistry";
import type { PhpMethodCompletion } from "../domain/phpMethodCompletions";
import type { NavigationRequest } from "./navigationRequest";
import type { PhpFrameworkActiveDocumentDiagnosticsContribution } from "./phpFrameworkActiveDocumentDiagnosticsContributions";
import type { PhpFrameworkCodeActionContributionAdapter } from "./phpFrameworkCodeActionContributions";
import type { PhpFrameworkContextualMemberDefinitionNavigationAdapter } from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";
import type { PhpFrameworkDefinitionNavigationContribution } from "./phpFrameworkDefinitionNavigationContributions";
import type { PhpFrameworkFileChangeInvalidationContribution } from "./phpFrameworkFileChangeInvalidationContributions";
import type { PhpFrameworkMethodCompletionSemanticsAdapter } from "./phpFrameworkMethodCompletionSemantics";
import type { PhpFrameworkSemanticAdapterContribution } from "./phpFrameworkSemanticAdapterRegistry";
import type { PhpModelSourceSemanticsAdapter } from "./phpModelSemanticsAdapter";
import type { PhpMemberCompletionContribution } from "./phpMemberCompletionContribution";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export type PhpFrameworkPluginContributionFactory<
  TDependencies,
  TContribution,
> = (dependencies: TDependencies) => readonly TContribution[];

export interface PhpFrameworkPluginNavigationDependencies {
  openPhpClassTarget(
    className: string,
    label: string,
    request?: NavigationRequest,
  ): Promise<boolean>;
  readNavigationFileContent(
    path: string,
    signal?: AbortSignal,
  ): Promise<string>;
  resolvePhpClassSourcePaths(
    className: string,
    signal?: AbortSignal,
  ): Promise<readonly string[]>;
  resolvePhpExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export interface PhpFrameworkPluginDiagnosticsDependencies {
  collectTemplateRelativePaths: () => Promise<readonly string[]>;
  collectTemplateTargets: PhpFrameworkTargets["collectViewTargets"];
  provideTemplateLinkDiagnostics: (
    source: string,
    currentTemplateRelativePath: string,
  ) => Promise<LanguageServerDiagnostic[]>;
}

export interface PhpFrameworkPluginCodeActionDependencies {
  collectTemplateTargets: () => Promise<ReadonlyArray<{ name: string }>>;
  readFileIfExists(path: string): Promise<string | null>;
  workspaceRoot: string | null;
}

export interface PhpFrameworkPluginInvalidationDependencies {
  invalidateComponentNames(rootPath: string, path: string): void;
  invalidateConfiguration(rootPath: string, path: string): void;
  invalidateTemplateExpressions(rootPath: string, path: string): void;
  invalidateTemplateViewData(rootPath: string, path: string): void;
}

export interface PhpFrameworkPluginMethodCompletionSemanticsDependencies {
  collectPhpFrameworkSyntheticMethodsForClass(
    className: string,
    options?: { isStatic?: boolean },
  ): Promise<PhpMethodCompletion[]>;
  resolvePhpFrameworkBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
}

export interface PhpFrameworkPluginSemantics {
  readonly contextualMemberNavigation?: (
    dependencies: PhpFrameworkPluginContextualMemberNavigationDependencies,
  ) => PhpFrameworkSemanticAdapterContribution<PhpFrameworkContextualMemberDefinitionNavigationAdapter>;
  readonly methodCompletion?: (
    dependencies: PhpFrameworkPluginMethodCompletionSemanticsDependencies,
  ) => PhpFrameworkSemanticAdapterContribution<PhpFrameworkMethodCompletionSemanticsAdapter>;
  readonly modelSource?: PhpFrameworkSemanticAdapterContribution<PhpModelSourceSemanticsAdapter>;
}

export interface PhpFrameworkPluginContextualMemberNavigationDependencies {
  openDirectMethodTarget(className: string, methodName: string): Promise<boolean>;
  openDynamicMethodTarget(className: string, methodName: string): Promise<boolean>;
  resolveBuilderModelType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolveExpressionType(
    source: string,
    position: EditorPosition,
    expression: string,
  ): Promise<string | null>;
  resolveRelationPathOwnerType(
    ownerType: string,
    relationPath: readonly string[],
  ): Promise<string | null>;
}

export interface PhpFrameworkPlugin {
  readonly provider: PhpFrameworkProviderCore;
  /** Empty objects remain accepted for contribution-only legacy plugins. */
  readonly features: PhpFrameworkFeatureBag | Readonly<Record<string, never>>;
  readonly forProject?: (
    php: PhpProjectDescriptor,
  ) => PhpFrameworkPluginProject;
  readonly capabilityDefinitions?: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkPluginProject>[];
  readonly memberCompletions?: readonly PhpMemberCompletionContribution[];
  readonly navigation?: PhpFrameworkPluginContributionFactory<
    PhpFrameworkPluginNavigationDependencies,
    PhpFrameworkDefinitionNavigationContribution
  >;
  readonly diagnostics?: PhpFrameworkPluginContributionFactory<
    PhpFrameworkPluginDiagnosticsDependencies,
    PhpFrameworkActiveDocumentDiagnosticsContribution
  >;
  readonly codeActions?: PhpFrameworkPluginContributionFactory<
    PhpFrameworkPluginCodeActionDependencies,
    PhpFrameworkCodeActionContributionAdapter
  >;
  readonly invalidations?: PhpFrameworkPluginContributionFactory<
    PhpFrameworkPluginInvalidationDependencies,
    PhpFrameworkFileChangeInvalidationContribution
  >;
  readonly semantics?: PhpFrameworkPluginSemantics;
}

export type PhpFrameworkPluginSnapshot = Omit<
  PhpFrameworkPlugin,
  "features"
> & {
  readonly features: PhpFrameworkFeatureBag;
};

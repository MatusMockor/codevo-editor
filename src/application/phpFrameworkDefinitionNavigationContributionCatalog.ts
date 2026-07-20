import type { EditorPosition } from "../domain/languageServerFeatures";
import {
  createPhpFrameworkDefinitionNavigationRegistry,
  type PhpFrameworkDefinitionNavigationProvider,
} from "./phpFrameworkDefinitionNavigationContributions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { NavigationRequest } from "./navigationRequest";
import type { PhpFrameworkActivationContext } from "./phpFrameworkExtensionRegistry";
import { createPhpNetteDatabaseDefinitionNavigationContribution } from "./phpNetteDatabaseDefinitionNavigationContribution";

export interface PhpFrameworkDefinitionNavigationContributionCatalogDependencies {
  activation: PhpFrameworkActivationContext;
  frameworkRuntime: Pick<
    PhpFrameworkRuntimeContext,
    "hasProvider" | "supports"
  >;
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

export function createPhpFrameworkDefinitionNavigationContributionCatalog({
  activation,
  frameworkRuntime,
  ...dependencies
}: PhpFrameworkDefinitionNavigationContributionCatalogDependencies): PhpFrameworkDefinitionNavigationProvider {
  return createPhpFrameworkDefinitionNavigationRegistry({
    activation,
    frameworkRuntime,
    contributions: [
      createPhpNetteDatabaseDefinitionNavigationContribution(dependencies),
    ],
  });
}

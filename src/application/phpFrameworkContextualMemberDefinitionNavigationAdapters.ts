import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkSemanticAdapter,
  type PhpFrameworkSemanticAdapterContribution,
} from "./phpFrameworkSemanticAdapterRegistry";
import {
  genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  type PhpFrameworkContextualMemberDefinitionNavigationAdapter,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";

export type PhpFrameworkContextualMemberDefinitionNavigationContribution =
  PhpFrameworkSemanticAdapterContribution<PhpFrameworkContextualMemberDefinitionNavigationAdapter>;

export interface PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  providerContributions?: readonly PhpFrameworkContextualMemberDefinitionNavigationContribution[];
}

export function createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
  frameworkRuntime,
  providerContributions = [],
}: PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  return activePhpFrameworkSemanticAdapter(
    frameworkRuntime,
    providerContributions,
    genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  );
}

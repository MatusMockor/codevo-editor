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
  frameworkRuntime?: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  isLaravelFrameworkActive?: boolean;
  providerContributions?: readonly PhpFrameworkContextualMemberDefinitionNavigationContribution[];
}

export function createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
  frameworkRuntime,
  isLaravelFrameworkActive = false,
  providerContributions = [],
}: PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  if (frameworkRuntime) {
    return activePhpFrameworkSemanticAdapter(
      frameworkRuntime,
      providerContributions,
      genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
    );
  }

  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkContextualMemberDefinitionNavigationAdapter;
  }

  const laravelContribution = providerContributions.find(
    ({ providerId }) => providerId === "laravel",
  );

  if (!laravelContribution) {
    return genericPhpFrameworkContextualMemberDefinitionNavigationAdapter;
  }

  return laravelContribution.createAdapter();
}

import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  type PhpFrameworkContextualMemberDefinitionNavigationAdapter,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";

export interface PhpFrameworkContextualMemberDefinitionNavigationContribution {
  readonly providerId: string;
  createAdapter(): PhpFrameworkContextualMemberDefinitionNavigationAdapter;
}

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
  const activeContribution = providerContributions.find(({ providerId }) => {
    if (frameworkRuntime) {
      return frameworkRuntime.hasProvider(providerId);
    }

    return providerId === "laravel" && isLaravelFrameworkActive;
  });

  if (!activeContribution) {
    return genericPhpFrameworkContextualMemberDefinitionNavigationAdapter;
  }

  return activeContribution.createAdapter();
}

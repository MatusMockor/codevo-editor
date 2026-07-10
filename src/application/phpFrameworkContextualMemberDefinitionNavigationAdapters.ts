import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  type PhpFrameworkContextualMemberDefinitionNavigationAdapter,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";
import {
  createPhpLaravelContextualMemberDefinitionNavigationAdapter,
  type PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies,
} from "./phpLaravelContextualMemberDefinitionNavigationAdapter";

export interface PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions {
  frameworkRuntime?: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  isLaravelFrameworkActive?: boolean;
  laravelDependencies?: PhpLaravelContextualMemberDefinitionNavigationAdapterDependencies;
}

export function createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
  frameworkRuntime,
  isLaravelFrameworkActive = false,
  laravelDependencies,
}: PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  const isLaravelActive = frameworkRuntime
    ? frameworkRuntime.hasProvider("laravel")
    : isLaravelFrameworkActive;

  if (!isLaravelActive || !laravelDependencies) {
    return genericPhpFrameworkContextualMemberDefinitionNavigationAdapter;
  }

  return createPhpLaravelContextualMemberDefinitionNavigationAdapter(
    laravelDependencies,
  );
}

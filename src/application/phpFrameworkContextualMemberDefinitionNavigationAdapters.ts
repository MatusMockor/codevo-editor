import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  genericPhpFrameworkContextualMemberDefinitionNavigationAdapter,
  type PhpFrameworkContextualMemberDefinitionNavigationAdapter,
} from "./phpFrameworkContextualMemberDefinitionNavigationAdapter";
import {
  phpLaravelContextualMemberDefinitionNavigationAdapter,
} from "./phpLaravelContextualMemberDefinitionNavigationAdapter";

export interface PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions {
  frameworkRuntime?: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  isLaravelFrameworkActive?: boolean;
}

export function createPhpFrameworkContextualMemberDefinitionNavigationAdapters({
  frameworkRuntime,
  isLaravelFrameworkActive = false,
}: PhpFrameworkContextualMemberDefinitionNavigationAdaptersOptions): PhpFrameworkContextualMemberDefinitionNavigationAdapter {
  if (frameworkRuntime) {
    if (!frameworkRuntime.hasProvider("laravel")) {
      return genericPhpFrameworkContextualMemberDefinitionNavigationAdapter;
    }

    return phpLaravelContextualMemberDefinitionNavigationAdapter;
  }

  if (!isLaravelFrameworkActive) {
    return genericPhpFrameworkContextualMemberDefinitionNavigationAdapter;
  }

  return phpLaravelContextualMemberDefinitionNavigationAdapter;
}

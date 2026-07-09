import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkIdentifierDefinitionNavigationAdapter } from "./phpFrameworkIdentifierDefinitionNavigation";
import {
  createPhpLaravelIdentifierDefinitionNavigationAdapter,
  type PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpLaravelIdentifierDefinitionNavigationAdapter";

export interface PhpFrameworkIdentifierNavigationAdapterDependencies
  extends PhpLaravelIdentifierDefinitionNavigationAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export interface PhpFrameworkIdentifierNavigationAdapters {
  adapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
  contextualAdapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
}

export function createPhpFrameworkIdentifierNavigationAdapters({
  frameworkRuntime,
  openPhpClassTarget,
  ...laravelDependencies
}: PhpFrameworkIdentifierNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationAdapters {
  if (!frameworkRuntime.hasProvider("laravel")) {
    return {
      adapters: [],
      contextualAdapters: [],
    };
  }

  return {
    adapters: [
      createPhpLaravelIdentifierDefinitionNavigationAdapter(
        laravelDependencies,
      ),
    ],
    contextualAdapters: [
      createPhpLaravelIdentifierDefinitionNavigationAdapter({
        ...laravelDependencies,
        openPhpClassTarget,
      }),
    ],
  };
}

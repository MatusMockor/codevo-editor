import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkIdentifierDefinitionNavigationAdapter } from "./phpFrameworkIdentifierDefinitionNavigation";

export interface PhpFrameworkIdentifierNavigationAdapters {
  adapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
  contextualAdapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
}

export interface PhpFrameworkIdentifierNavigationActivationAdapter {
  readonly providerId: string;
  create(): PhpFrameworkIdentifierNavigationAdapters;
}

export function activePhpFrameworkIdentifierNavigationAdapters(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">,
  activationAdapters: readonly PhpFrameworkIdentifierNavigationActivationAdapter[],
): PhpFrameworkIdentifierNavigationAdapters {
  const activeAdapters = activationAdapters
    .filter((adapter) => frameworkRuntime.hasProvider(adapter.providerId))
    .map((adapter) => adapter.create());

  return {
    adapters: activeAdapters.flatMap((adapter) => adapter.adapters),
    contextualAdapters: activeAdapters.flatMap(
      (adapter) => adapter.contextualAdapters,
    ),
  };
}

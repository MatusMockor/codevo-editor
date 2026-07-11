import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkIdentifierDefinitionNavigationAdapter } from "./phpFrameworkIdentifierDefinitionNavigation";
import {
  createPhpLaravelIdentifierDefinitionNavigationAdapter,
  type PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpLaravelIdentifierDefinitionNavigationAdapter";
import {
  createPhpNetteIdentifierDefinitionNavigationAdapter,
  type PhpNetteIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpNetteIdentifierDefinitionNavigationAdapter";

export interface PhpFrameworkIdentifierNavigationAdapterDependencies
  extends PhpLaravelIdentifierDefinitionNavigationAdapterDependencies {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  netteDependencies?: Omit<
    PhpNetteIdentifierDefinitionNavigationAdapterDependencies,
    "activeDocument"
  >;
}

export interface PhpFrameworkIdentifierNavigationAdapters {
  adapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
  contextualAdapters: readonly PhpFrameworkIdentifierDefinitionNavigationAdapter[];
}

export function createPhpFrameworkIdentifierNavigationAdapters({
  activeDocument,
  frameworkRuntime,
  netteDependencies,
  openPhpClassTarget,
  ...laravelDependencies
}: PhpFrameworkIdentifierNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationAdapters {
  const adapters: PhpFrameworkIdentifierDefinitionNavigationAdapter[] = [];
  const contextualAdapters: PhpFrameworkIdentifierDefinitionNavigationAdapter[] = [];

  if (frameworkRuntime.hasProvider("laravel")) {
    adapters.push(
      createPhpLaravelIdentifierDefinitionNavigationAdapter({
        ...laravelDependencies,
        activeDocument,
      }),
    );
    contextualAdapters.push(
      createPhpLaravelIdentifierDefinitionNavigationAdapter({
        ...laravelDependencies,
        activeDocument,
        openPhpClassTarget,
      }),
    );
  }

  if (frameworkRuntime.hasProvider("nette") && netteDependencies) {
    const netteAdapter = createPhpNetteIdentifierDefinitionNavigationAdapter({
      ...netteDependencies,
      activeDocument,
    });
    adapters.push(netteAdapter);
    contextualAdapters.push(netteAdapter);
  }

  return { adapters, contextualAdapters };
}

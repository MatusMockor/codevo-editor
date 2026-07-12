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

export function createPhpFrameworkIdentifierNavigationAdapters({
  activeDocument,
  frameworkRuntime,
  netteDependencies,
  openPhpClassTarget,
  ...laravelDependencies
}: PhpFrameworkIdentifierNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationAdapters {
  const activationAdapters: PhpFrameworkIdentifierNavigationActivationAdapter[] = [
    {
      providerId: "laravel",
      create: () => ({
        adapters: [
          createPhpLaravelIdentifierDefinitionNavigationAdapter({
            ...laravelDependencies,
            activeDocument,
          }),
        ],
        contextualAdapters: [
          createPhpLaravelIdentifierDefinitionNavigationAdapter({
            ...laravelDependencies,
            activeDocument,
            openPhpClassTarget,
          }),
        ],
      }),
    },
  ];

  if (netteDependencies) {
    activationAdapters.push({
      providerId: "nette",
      create: () => {
        const netteAdapter =
          createPhpNetteIdentifierDefinitionNavigationAdapter({
            ...netteDependencies,
            activeDocument,
          });

        return {
          adapters: [netteAdapter],
          contextualAdapters: [netteAdapter],
        };
      },
    });
  }

  return activePhpFrameworkIdentifierNavigationAdapters(
    frameworkRuntime,
    activationAdapters,
  );
}

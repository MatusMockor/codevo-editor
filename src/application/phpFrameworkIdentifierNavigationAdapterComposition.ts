import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkIdentifierNavigationAdapters,
  type PhpFrameworkIdentifierNavigationActivationAdapter,
  type PhpFrameworkIdentifierNavigationAdapters,
} from "./phpFrameworkIdentifierNavigationAdapters";
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

export function createPhpFrameworkIdentifierNavigationAdapters({
  activeDocument,
  frameworkRuntime,
  netteDependencies,
  openPhpClassTarget,
  ...laravelDependencies
}: PhpFrameworkIdentifierNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationAdapters {
  return activePhpFrameworkIdentifierNavigationAdapters(
    frameworkRuntime,
    createPhpFrameworkIdentifierNavigationActivationAdapters({
      activeDocument,
      netteDependencies,
      openPhpClassTarget,
      ...laravelDependencies,
    }),
  );
}

function createPhpFrameworkIdentifierNavigationActivationAdapters({
  activeDocument,
  netteDependencies,
  openPhpClassTarget,
  ...laravelDependencies
}: Omit<
  PhpFrameworkIdentifierNavigationAdapterDependencies,
  "frameworkRuntime"
>): readonly PhpFrameworkIdentifierNavigationActivationAdapter[] {
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

  if (!netteDependencies) {
    return activationAdapters;
  }

  activationAdapters.push({
    providerId: "nette",
    create: () => {
      const netteAdapter = createPhpNetteIdentifierDefinitionNavigationAdapter({
        ...netteDependencies,
        activeDocument,
      });

      return {
        adapters: [netteAdapter],
        contextualAdapters: [netteAdapter],
      };
    },
  });

  return activationAdapters;
}

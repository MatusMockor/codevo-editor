import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import {
  activePhpFrameworkIdentifierNavigationAdapters,
  type PhpFrameworkIdentifierNavigationActivationAdapter,
  type PhpFrameworkIdentifierNavigationAdapters,
} from "./phpFrameworkIdentifierNavigationAdapters";
import {
  createPhpLaravelIdentifierNavigationActivationAdapter,
} from "./phpLaravelIdentifierNavigationActivationAdapter";
import type {
  PhpLaravelIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpLaravelIdentifierDefinitionNavigationAdapter";
import {
  createPhpNetteIdentifierNavigationActivationAdapter,
} from "./phpNetteIdentifierNavigationActivationAdapter";
import type {
  PhpNetteIdentifierDefinitionNavigationAdapterDependencies,
} from "./phpNetteIdentifierDefinitionNavigationAdapter";

export interface PhpFrameworkIdentifierNavigationAdapterDependencies {
  activationAdapters: readonly PhpFrameworkIdentifierNavigationActivationAdapter[];
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
}

export interface DefaultPhpFrameworkIdentifierNavigationActivationAdapterDependencies {
  laravel: PhpLaravelIdentifierDefinitionNavigationAdapterDependencies;
  nette: PhpNetteIdentifierDefinitionNavigationAdapterDependencies;
}

export function createDefaultPhpFrameworkIdentifierNavigationActivationAdapters({
  laravel,
  nette,
}: DefaultPhpFrameworkIdentifierNavigationActivationAdapterDependencies): readonly PhpFrameworkIdentifierNavigationActivationAdapter[] {
  return [
    createPhpLaravelIdentifierNavigationActivationAdapter(laravel),
    createPhpNetteIdentifierNavigationActivationAdapter(nette),
  ];
}

export function createPhpFrameworkIdentifierNavigationAdapters({
  activationAdapters,
  frameworkRuntime,
}: PhpFrameworkIdentifierNavigationAdapterDependencies): PhpFrameworkIdentifierNavigationAdapters {
  return activePhpFrameworkIdentifierNavigationAdapters(
    frameworkRuntime,
    activationAdapters,
  );
}

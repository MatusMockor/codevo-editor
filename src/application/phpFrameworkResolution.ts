import type {
  PhpFrameworkCapabilityDefinition,
  PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  selectPhpFrameworkProvidersForProject,
  type PhpFrameworkProviderSelection,
} from "../domain/phpFrameworkProviderSelection";
import type { PhpProjectDescriptor } from "../domain/workspace";

export type FrameworkProfile = "laravel" | "nette" | "generic";

export interface PhpFrameworkResolution
  extends PhpFrameworkProviderSelection<PhpFrameworkProvider> {
  readonly capabilityDefinitions?: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[];
  readonly profile: FrameworkProfile;
}

interface PhpFrameworkProviderCatalog extends ReadonlyArray<PhpFrameworkProvider> {
  readonly capabilityDefinitions?: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[];
}

export function frameworkProfileFromProviderId(
  providerId: string | null,
): FrameworkProfile {
  if (providerId === "laravel") {
    return "laravel";
  }

  if (providerId === "nette") {
    return "nette";
  }

  return "generic";
}

export function resolvePhpFrameworkProfile(
  php: PhpProjectDescriptor | null,
  registry: PhpFrameworkProviderCatalog,
): PhpFrameworkResolution {
  const selection = selectPhpFrameworkProvidersForProject(php, registry);

  return {
    ...selection,
    capabilityDefinitions: registry.capabilityDefinitions,
    profile: frameworkProfileFromProviderId(
      selection.matchedProviderIds[0] ?? null,
    ),
  };
}

export function frameworkProfileForProject(
  php: PhpProjectDescriptor | null | undefined,
  registry: readonly PhpFrameworkProvider[],
): FrameworkProfile {
  return resolvePhpFrameworkProfile(php ?? null, registry).profile;
}

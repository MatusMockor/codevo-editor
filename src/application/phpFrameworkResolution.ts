import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import {
  selectPhpFrameworkProvidersForProject,
  type PhpFrameworkProviderSelection,
} from "../domain/phpFrameworkProviderSelection";
import type { PhpProjectDescriptor } from "../domain/workspace";

export type FrameworkProfile = "laravel" | "nette" | "generic";

export interface PhpFrameworkResolution
  extends PhpFrameworkProviderSelection<PhpFrameworkProvider> {
  readonly profile: FrameworkProfile;
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
  registry: readonly PhpFrameworkProvider[],
): PhpFrameworkResolution {
  const selection = selectPhpFrameworkProvidersForProject(php, registry);

  return {
    ...selection,
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

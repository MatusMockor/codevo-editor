import type {
  FrameworkProfile,
  PhpFrameworkProvider,
  PhpFrameworkResolution,
} from "../domain/phpFrameworkProviders";

/**
 * Application-layer view of the active PHP framework intelligence. The domain
 * registry remains the source of truth; hooks receive this typed boundary
 * instead of separate Laravel/Nette booleans plus a provider array.
 */
export interface PhpFrameworkIntelligence {
  readonly matchedProviderIds: readonly string[];
  readonly profile: FrameworkProfile;
  readonly providers: readonly PhpFrameworkProvider[];
  readonly isLaravel: boolean;
  readonly isNette: boolean;
}

export function createPhpFrameworkIntelligence(
  resolution: PhpFrameworkResolution,
): PhpFrameworkIntelligence {
  return {
    matchedProviderIds: resolution.matchedProviderIds,
    profile: resolution.profile,
    providers: resolution.providers,
    isLaravel: resolution.profile === "laravel",
    isNette: resolution.profile === "nette",
  };
}

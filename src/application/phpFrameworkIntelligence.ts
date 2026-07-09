import {
  createPhpFrameworkProviderCapabilityRegistry,
  phpFrameworkProviderSignature,
  type FrameworkProfile,
  type PhpFrameworkProviderCapabilityRegistry,
  type PhpFrameworkProvider,
  type PhpFrameworkResolution,
} from "../domain/phpFrameworkProviders";

/**
 * Application-layer view of the active PHP framework intelligence. The domain
 * registry remains the source of truth; hooks receive this typed boundary
 * instead of separate Laravel/Nette booleans plus a provider array.
 */
export interface PhpFrameworkIntelligence {
  readonly matchedProviderIds: readonly string[];
  readonly profile: FrameworkProfile;
  readonly providerIds: readonly string[];
  readonly providerSignature: string;
  readonly providers: readonly PhpFrameworkProvider[];
  readonly capabilities: PhpFrameworkProviderCapabilityRegistry;
  readonly isLaravel: boolean;
  readonly isNette: boolean;
  hasProvider(providerId: string): boolean;
}

export function createPhpFrameworkIntelligence(
  resolution: PhpFrameworkResolution,
): PhpFrameworkIntelligence {
  const providerIds = resolution.providers.map((provider) => provider.id);

  return {
    matchedProviderIds: resolution.matchedProviderIds,
    profile: resolution.profile,
    providerIds,
    providerSignature: phpFrameworkProviderSignature(resolution.providers),
    providers: resolution.providers,
    capabilities: createPhpFrameworkProviderCapabilityRegistry(
      resolution.providers,
    ),
    isLaravel: resolution.profile === "laravel",
    isNette: resolution.profile === "nette",
    hasProvider: (providerId) => providerIds.includes(providerId),
  };
}

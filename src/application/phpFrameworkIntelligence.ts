import {
  createPhpFrameworkProviderCapabilityRegistry,
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
  readonly activityLabel: string | null;
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
  const capabilities = createPhpFrameworkProviderCapabilityRegistry(
    resolution.providers,
  );

  return {
    activityLabel:
      resolution.activityLabel ??
      resolution.providers[0]?.presentation?.activityLabel ??
      null,
    matchedProviderIds: resolution.matchedProviderIds,
    profile: resolution.profile,
    providerIds,
    providerSignature: capabilities.providerSignature,
    providers: resolution.providers,
    capabilities,
    isLaravel: capabilities.hasProvider("laravel"),
    isNette: capabilities.hasProvider("nette"),
    hasProvider: (providerId) => capabilities.hasProvider(providerId),
  };
}

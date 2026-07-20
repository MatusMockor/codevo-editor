import {
  createPhpFrameworkProviderCapabilityRegistry,
  type PhpFrameworkCapabilityDefinition,
  type PhpFrameworkProviderCapabilityRegistry,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import { phpFrameworkPluginCapabilityDefinitions } from "./phpFrameworkPluginCatalog";
import type {
  FrameworkProfile,
} from "./phpFrameworkResolution";

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
  hasProvider(providerId: string): boolean;
}

export interface PhpFrameworkIntelligenceSource {
  readonly activityLabel?: string | null;
  readonly capabilityDefinitions?: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[];
  readonly matchedProviderIds: readonly string[];
  readonly profile: FrameworkProfile;
  readonly providers: readonly PhpFrameworkProvider[];
}

export function createPhpFrameworkIntelligence(
  resolution: PhpFrameworkIntelligenceSource,
): PhpFrameworkIntelligence {
  const providerIds = resolution.providers.map((provider) => provider.id);
  const capabilities = createPhpFrameworkProviderCapabilityRegistry(
    resolution.providers,
    resolution.capabilityDefinitions ?? phpFrameworkPluginCapabilityDefinitions,
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
    hasProvider: (providerId) => capabilities.hasProvider(providerId),
  };
}

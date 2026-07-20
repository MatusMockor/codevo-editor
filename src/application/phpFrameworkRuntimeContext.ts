import type {
  PhpFrameworkProviderCapability,
  PhpFrameworkProviderCapabilityRegistry,
  PhpFrameworkProvider,
  PhpFrameworkTargetCollectionKind,
} from "../domain/phpFrameworkProviders";
import type { PhpFrameworkIntelligence } from "./phpFrameworkIntelligence";

export interface PhpFrameworkRuntimeContext {
  readonly capabilities: PhpFrameworkProviderCapabilityRegistry;
  readonly providers: readonly PhpFrameworkProvider[];
  readonly profile: PhpFrameworkIntelligence["profile"];
  hasProvider(providerId: string): boolean;
  supports(capability: PhpFrameworkProviderCapability): boolean;
  supportsTargetCollection(kind: PhpFrameworkTargetCollectionKind): boolean;
}

export function createPhpFrameworkRuntimeContext(
  intelligence: PhpFrameworkIntelligence,
): PhpFrameworkRuntimeContext {
  return {
    capabilities: intelligence.capabilities,
    providers: intelligence.providers,
    profile: intelligence.profile,
    hasProvider: (providerId) => intelligence.hasProvider(providerId),
    supports: (capability) => intelligence.capabilities.supports(capability),
    supportsTargetCollection: (kind) =>
      intelligence.capabilities.supportsTargetCollection(kind),
  };
}

import {
  createPhpFrameworkProviderCapabilityRegistry,
  type FrameworkProfile,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkRuntimeDependencies {
  activePhpFrameworkProviders?: readonly PhpFrameworkProvider[];
  frameworkRuntime?: PhpFrameworkRuntimeContext;
  isLaravelFrameworkActive?: boolean;
}

const EMPTY_PHP_FRAMEWORK_PROVIDERS: readonly PhpFrameworkProvider[] = [];

export function phpFrameworkRuntimeContextFromDependencies(
  dependencies: PhpFrameworkRuntimeDependencies,
): PhpFrameworkRuntimeContext {
  if (dependencies.frameworkRuntime) {
    return dependencies.frameworkRuntime;
  }

  const isLaravel = dependencies.isLaravelFrameworkActive === true;
  const providers = isLaravel
    ? (dependencies.activePhpFrameworkProviders ?? EMPTY_PHP_FRAMEWORK_PROVIDERS)
    : EMPTY_PHP_FRAMEWORK_PROVIDERS;
  const providerIds = providers.map((provider) => provider.id);
  const capabilities = createPhpFrameworkProviderCapabilityRegistry(providers);
  const profile: FrameworkProfile = isLaravel ? "laravel" : "generic";

  return {
    capabilities,
    providers,
    profile,
    isLaravel,
    isNette: false,
    hasProvider: (providerId) => providerIds.includes(providerId),
    supports: (capability) => capabilities.supports(capability),
    supportsTargetCollection: (kind) =>
      capabilities.supportsTargetCollection(kind),
  };
}

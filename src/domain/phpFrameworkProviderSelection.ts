import type { PhpFrameworkProviderCore } from "./phpFrameworkProviderCore";
import type { PhpProjectDescriptor } from "./workspace";

export interface PhpFrameworkProviderSelection<TProvider> {
  readonly activityLabel: string | null;
  readonly matchedProviderIds: readonly string[];
  readonly providers: readonly TProvider[];
}

interface PhpFrameworkProjectSpecializer {
  readonly owner: object;
  readonly specialize: (
    php: PhpProjectDescriptor,
  ) => PhpFrameworkProviderCore;
}

const projectSpecializerByProvider = new WeakMap<
  PhpFrameworkProviderCore,
  PhpFrameworkProjectSpecializer
>();
const projectOwnerByProvider = new WeakMap<PhpFrameworkProviderCore, object>();

export function registerPhpFrameworkProviderProjectSpecializer<
  TProvider extends PhpFrameworkProviderCore,
>(
  provider: TProvider,
  specialize: (php: PhpProjectDescriptor) => TProvider,
): void {
  const owner = projectOwnerByProvider.get(provider) ?? Object.freeze({});
  projectOwnerByProvider.set(provider, owner);
  projectSpecializerByProvider.set(provider, { owner, specialize });
}

export function specializePhpFrameworkProviderForProject<
  TProvider extends PhpFrameworkProviderCore,
>(provider: TProvider, php: PhpProjectDescriptor): TProvider;
export function specializePhpFrameworkProviderForProject(
  provider: PhpFrameworkProviderCore,
  php: PhpProjectDescriptor,
): PhpFrameworkProviderCore {
  const registration = projectSpecializerByProvider.get(provider);

  if (!registration) {
    return provider;
  }

  const projectProvider = registration.specialize(php);

  if (projectProvider.id !== provider.id) {
    throw new Error(
      `PHP framework project specialization changed provider id from "${provider.id}" to "${projectProvider.id}".`,
    );
  }

  const existingOwner = projectOwnerByProvider.get(projectProvider);

  if (existingOwner && existingOwner !== registration.owner) {
    throw new Error(
      `PHP framework project specialization returned provider "${projectProvider.id}" owned by another registration.`,
    );
  }

  projectOwnerByProvider.set(projectProvider, registration.owner);
  return projectProvider;
}

/**
 * Selects one active provider while retaining every matching provider ID for
 * ambiguity reporting. Detection happens exactly once per registry entry and
 * project specialization happens exactly once for the winning provider.
 */
export function selectPhpFrameworkProvidersForProject<
  TProvider extends PhpFrameworkProviderCore,
>(
  php: PhpProjectDescriptor | null,
  registry: readonly TProvider[],
  specializeProvider?: (
    provider: TProvider,
    php: PhpProjectDescriptor,
  ) => TProvider,
): PhpFrameworkProviderSelection<TProvider> {
  if (!php) {
    return {
      activityLabel: null,
      matchedProviderIds: [],
      providers: [],
    };
  }

  const matches: TProvider[] = [];

  for (const provider of registry) {
    if (provider.appliesTo?.(php) ?? false) {
      matches.push(provider);
    }
  }

  const [winner] = matches;

  if (!winner) {
    return {
      activityLabel: null,
      matchedProviderIds: [],
      providers: [],
    };
  }

  const projectProvider = specializeProvider
    ? specializeProvider(winner, php)
    : specializePhpFrameworkProviderForProject(winner, php);

  return {
    activityLabel: projectProvider.presentation?.activityLabel ?? null,
    matchedProviderIds: matches.map((provider) => provider.id),
    providers: [projectProvider],
  };
}

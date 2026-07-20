import {
  createPhpFrameworkProviderCapabilityRegistry,
  type PhpFrameworkProvider,
} from "../domain/phpFrameworkProviders";
import {
  cloneAndFreezePhpFrameworkSnapshot,
  createPhpFrameworkFeatureBag,
  isPhpFrameworkFeatureBag,
} from "../domain/phpFrameworkProviderFeatures";
import {
  definePhpFrameworkCapability,
  type PhpFrameworkCapabilityDefinition,
} from "../domain/phpFrameworkCapabilityRegistry";
import {
  assertUniquePhpFrameworkRegistrationIds,
  type PhpFrameworkRegistration,
} from "./phpFrameworkExtensionRegistry";
import type {
  PhpFrameworkPlugin,
  PhpFrameworkPluginContributionFactory,
  PhpFrameworkPluginSnapshot,
} from "./phpFrameworkPlugin";
import {
  composePhpFrameworkLegacyProvider,
  projectPhpFrameworkLegacyProvider,
} from "./phpFrameworkLegacyProviderAdapter";
import { phpLaravelFrameworkPlugin } from "./phpLaravelFrameworkPlugin";
import { phpNetteFrameworkPlugin } from "./phpNetteFrameworkPlugin";

export interface PhpFrameworkPluginCatalog
  extends ReadonlyArray<PhpFrameworkProvider> {
  readonly capabilityDefinitions: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[];
}

export function createPhpFrameworkPluginRegistry(
  plugins: readonly PhpFrameworkPlugin[],
): readonly PhpFrameworkPluginSnapshot[] {
  assertUniquePhpFrameworkRegistrationIds(
    plugins.map(({ provider }) => provider),
    "PHP framework plugin catalog",
  );
  return Object.freeze(plugins.map(freezePhpFrameworkPluginSnapshot));
}

function freezePhpFrameworkPluginSnapshot(
  plugin: PhpFrameworkPlugin,
): PhpFrameworkPluginSnapshot {
  const provider = cloneAndFreezePhpFrameworkSnapshot(plugin.provider);
  const features = isPhpFrameworkFeatureBag(plugin.features)
    ? plugin.features
    : createPhpFrameworkFeatureBag(provider, []);

  if (features.ownerId !== provider.id) {
    throw new Error(
      `PHP framework feature owner "${features.ownerId}" does not match provider "${provider.id}".`,
    );
  }

  return Object.freeze({
    ...plugin,
    capabilityDefinitions: plugin.capabilityDefinitions
      ? cloneAndFreezePhpFrameworkSnapshot(plugin.capabilityDefinitions)
      : undefined,
    features,
    memberCompletions: plugin.memberCompletions
      ? cloneAndFreezePhpFrameworkSnapshot(plugin.memberCompletions)
      : undefined,
    provider,
    semantics: plugin.semantics
      ? cloneAndFreezePhpFrameworkSnapshot(plugin.semantics)
      : undefined,
  });
}

export function createPhpFrameworkPluginCatalog(
  providers: readonly PhpFrameworkProvider[],
  capabilityDefinitions: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[] = [],
): PhpFrameworkPluginCatalog {
  assertUniquePhpFrameworkRegistrationIds(
    providers,
    "PHP framework plugin catalog",
  );
  assertValidPhpFrameworkCapabilityDefinitions(capabilityDefinitions);

  const catalog = providers.map((provider) =>
    Object.isFrozen(provider)
      ? provider
      : cloneAndFreezePhpFrameworkSnapshot(provider),
  );
  Object.defineProperty(catalog, "capabilityDefinitions", {
    value: cloneAndFreezePhpFrameworkSnapshot(capabilityDefinitions),
  });

  return Object.freeze(catalog) as PhpFrameworkPluginCatalog;
}

export function composePhpFrameworkPluginCatalog(
  plugins: readonly PhpFrameworkPlugin[],
): PhpFrameworkPluginCatalog {
  const registry = createPhpFrameworkPluginRegistry(plugins);
  const providers = registry.map((plugin) =>
    composePhpFrameworkLegacyProvider(
      { features: plugin.features, provider: plugin.provider },
      plugin.forProject,
    ),
  );

  return createPhpFrameworkPluginCatalog(
    providers,
    phpFrameworkCapabilityDefinitionsForPlugins(registry),
  );
}

function assertValidPhpFrameworkCapabilityDefinitions(
  definitions: readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[],
): void {
  createPhpFrameworkProviderCapabilityRegistry([], definitions);
}

export function phpFrameworkPluginContributions<
  TDependencies,
  TContribution extends PhpFrameworkRegistration,
>(
  plugins: readonly PhpFrameworkPlugin[],
  select: (
    plugin: PhpFrameworkPlugin,
  ) =>
    | PhpFrameworkPluginContributionFactory<TDependencies, TContribution>
    | undefined,
  dependencies: TDependencies,
  catalogName: string,
): readonly TContribution[] {
  const contributions = plugins.flatMap(
    (plugin) => select(plugin)?.(dependencies) ?? [],
  );

  assertUniquePhpFrameworkRegistrationIds(contributions, catalogName);
  return Object.freeze([...contributions]);
}

export const phpFrameworkPlugins = createPhpFrameworkPluginRegistry([
  phpLaravelFrameworkPlugin,
  phpNetteFrameworkPlugin,
]);

export const phpFrameworkPluginCatalog =
  composePhpFrameworkPluginCatalog(phpFrameworkPlugins);

export function phpFrameworkCapabilityDefinitionsForPlugins(
  plugins: readonly PhpFrameworkPlugin[],
): readonly PhpFrameworkCapabilityDefinition<PhpFrameworkProvider>[] {
  return Object.freeze(
    plugins.flatMap((plugin) =>
      (plugin.capabilityDefinitions ?? []).map((definition) =>
        definePhpFrameworkCapability(
          definition.token,
          (provider: PhpFrameworkProvider) => {
            if (provider.id !== plugin.provider.id) {
              return false;
            }

            return definition.isSupportedBy(
              projectPhpFrameworkLegacyProvider(provider),
            );
          },
        ),
      ),
    ),
  );
}

export const phpFrameworkPluginCapabilityDefinitions =
  phpFrameworkCapabilityDefinitionsForPlugins(phpFrameworkPlugins);

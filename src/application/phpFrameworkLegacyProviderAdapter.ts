import type { PhpFrameworkProviderCore } from "../domain/phpFrameworkProviderCore";
import {
  cloneAndFreezePhpFrameworkSnapshot,
  createPhpFrameworkFeatureBag,
  definePhpFrameworkFeature,
  registerPhpFrameworkFeature,
  type PhpFrameworkPluginProject,
} from "../domain/phpFrameworkProviderFeatures";
import type { PhpFrameworkProvider } from "../domain/phpFrameworkProviders";
import type { PhpProjectDescriptor } from "../domain/workspace";
import {
  registerPhpFrameworkProviderProjectSpecializer,
  specializePhpFrameworkProviderForProject,
} from "../domain/phpFrameworkProviderSelection";

export type PhpFrameworkLegacyProviderProjection = PhpFrameworkPluginProject;

type PhpFrameworkLegacyProviderFeatures = Omit<
  PhpFrameworkProvider,
  keyof PhpFrameworkProviderCore
>;

export const phpFrameworkLegacyProviderFeature =
  definePhpFrameworkFeature<PhpFrameworkLegacyProviderFeatures>(
    "legacy-provider-features",
  );

function projectCore(
  provider: PhpFrameworkProvider,
): PhpFrameworkProviderCore {
  return Object.freeze({
    id: provider.id,
    appliesTo: provider.appliesTo,
    presentation: provider.presentation
      ? cloneAndFreezePhpFrameworkSnapshot(provider.presentation)
      : undefined,
  });
}

function projectFeatures(
  provider: PhpFrameworkProvider,
): PhpFrameworkLegacyProviderFeatures {
  const {
    appliesTo: _appliesTo,
    id: _id,
    presentation: _presentation,
    ...features
  } = provider;

  return cloneAndFreezePhpFrameworkSnapshot(features);
}

function assertProjectOwner(
  project: PhpFrameworkPluginProject,
  expectedOwnerId: string,
): void {
  if (project.provider.id !== expectedOwnerId) {
    throw new Error(
      `PHP framework project specialization changed provider id from "${expectedOwnerId}" to "${project.provider.id}".`,
    );
  }

  if (project.features.ownerId !== expectedOwnerId) {
    throw new Error(
      `PHP framework feature owner "${project.features.ownerId}" does not match provider "${expectedOwnerId}".`,
    );
  }
}

export function projectPhpFrameworkLegacyProvider(
  provider: PhpFrameworkProvider,
): PhpFrameworkLegacyProviderProjection {
  const core = projectCore(provider);
  const features = createPhpFrameworkFeatureBag(core, [
    registerPhpFrameworkFeature(
      phpFrameworkLegacyProviderFeature,
      projectFeatures(provider),
    ),
  ]);

  return Object.freeze({ features, provider: core });
}

export function phpFrameworkLegacyFeatures(
  project: PhpFrameworkPluginProject,
): PhpFrameworkLegacyProviderFeatures | undefined {
  if (project.features.ownerId !== project.provider.id) {
    return undefined;
  }

  return project.features.get(phpFrameworkLegacyProviderFeature);
}

export function composePhpFrameworkLegacyProvider(
  project: PhpFrameworkPluginProject,
  forProject?: (
    php: PhpProjectDescriptor,
  ) => PhpFrameworkPluginProject,
): PhpFrameworkProvider {
  assertProjectOwner(project, project.provider.id);

  const features = phpFrameworkLegacyFeatures(project) ?? {};
  const provider = Object.freeze({
    ...cloneAndFreezePhpFrameworkSnapshot(features),
    ...cloneAndFreezePhpFrameworkSnapshot(project.provider),
  });

  if (forProject) {
    registerLegacyProjectSpecializer(provider, project.provider.id, forProject);
  }

  return provider;
}

function registerLegacyProjectSpecializer(
  provider: PhpFrameworkProvider,
  ownerId: string,
  specialize: (php: PhpProjectDescriptor) => PhpFrameworkPluginProject,
): void {
  registerPhpFrameworkProviderProjectSpecializer(provider, (php) => {
    const project = specialize(php);
    assertProjectOwner(project, ownerId);
    return composePhpFrameworkLegacyProvider(project);
  });
}

export function specializePhpFrameworkLegacyProvider(
  provider: PhpFrameworkProvider,
  php: PhpProjectDescriptor,
): PhpFrameworkProvider {
  return specializePhpFrameworkProviderForProject(provider, php);
}

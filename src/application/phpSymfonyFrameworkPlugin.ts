import { phpSymfonyFrameworkProvider } from "../domain/phpFrameworkSymfonyProvider";
import type { PhpFrameworkPluginSnapshot } from "./phpFrameworkPlugin";
import { projectPhpFrameworkLegacyProvider } from "./phpFrameworkLegacyProviderAdapter";

const symfonyProviderProjection = projectPhpFrameworkLegacyProvider(
  phpSymfonyFrameworkProvider,
);

export const phpSymfonyFrameworkPlugin: PhpFrameworkPluginSnapshot = {
  features: symfonyProviderProjection.features,
  provider: symfonyProviderProjection.provider,
};

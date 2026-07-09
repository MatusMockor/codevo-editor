import {
  createPhpFrameworkProviderCapabilityRegistry,
  type PhpFrameworkProvider,
  type PhpFrameworkProviderCapability,
  type PhpFrameworkTargetCollectionKind,
} from "../domain/phpFrameworkProviders";

export function phpFrameworkSupportsCapability(
  providers: readonly PhpFrameworkProvider[],
  capability: PhpFrameworkProviderCapability,
): boolean {
  return createPhpFrameworkProviderCapabilityRegistry(providers).supports(
    capability,
  );
}

export function phpFrameworkSupportsCollection(
  providers: readonly PhpFrameworkProvider[],
  kind: PhpFrameworkTargetCollectionKind,
): boolean {
  return createPhpFrameworkProviderCapabilityRegistry(
    providers,
  ).supportsTargetCollection(kind);
}

import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { NavigationRequest } from "./navigationRequest";
import {
  PhpFrameworkScopedRegistry,
  type PhpFrameworkActivationContext,
  type PhpFrameworkExecutionScope,
  type PhpFrameworkOwnershipContext,
} from "./phpFrameworkExtensionRegistry";

export interface PhpFrameworkDefinitionNavigationProvider {
  provideDefinition(
    source: string,
    offset: number,
    request?: NavigationRequest,
    scope?: PhpFrameworkExecutionScope,
  ): Promise<boolean>;
  abort?(): void;
}

export interface PhpFrameworkDefinitionNavigationContribution {
  readonly id: string;
  readonly priority?: number;
  supports(
    frameworkRuntime: Pick<
      PhpFrameworkRuntimeContext,
      "hasProvider" | "supports"
    >,
  ): boolean;
  createProvider(): PhpFrameworkDefinitionNavigationProvider;
}

export interface PhpFrameworkDefinitionNavigationRegistryOptions {
  activation: PhpFrameworkActivationContext;
  frameworkRuntime: Pick<
    PhpFrameworkRuntimeContext,
    "hasProvider" | "supports"
  >;
  contributions: readonly PhpFrameworkDefinitionNavigationContribution[];
}

export function createPhpFrameworkDefinitionNavigationRegistry({
  activation,
  frameworkRuntime,
  contributions,
}: PhpFrameworkDefinitionNavigationRegistryOptions): PhpFrameworkDefinitionNavigationProvider {
  const providers = new Map<string, PhpFrameworkDefinitionNavigationProvider>();
  const disposeProviders = (): void => {
    const instantiatedProviders = [...providers.values()];
    providers.clear();

    for (const provider of instantiatedProviders) {
      try {
        provider.abort?.();
      } catch {
        continue;
      }
    }
  };
  const registry = new PhpFrameworkScopedRegistry({
    activation,
    catalogName: "PHP framework definition navigation catalog",
    onDispose: disposeProviders,
    registrations: contributions,
  });
  const providerFor = (
    contribution: PhpFrameworkDefinitionNavigationContribution,
  ): PhpFrameworkDefinitionNavigationProvider => {
    const existing = providers.get(contribution.id);

    if (existing) {
      return existing;
    }

    const provider = contribution.createProvider();
    providers.set(contribution.id, provider);
    return provider;
  };

  return {
    abort() {
      registry.abort();
    },
    async provideDefinition(source, offset, request, requestedScope) {
      const ownership: PhpFrameworkOwnershipContext =
        requestedScope ?? activation;
      const handled = await registry.resolveFirst<boolean>(
        ownership,
        (contribution) => contribution.supports(frameworkRuntime),
        (contribution, scope) =>
          providerFor(contribution).provideDefinition(
            source,
            offset,
            request,
            scope,
          ),
        (result) => result,
      );

      return handled ?? false;
    },
  };
}

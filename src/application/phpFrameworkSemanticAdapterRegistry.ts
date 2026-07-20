import type { PhpFrameworkProviderCapability } from "../domain/phpFrameworkProviders";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpFrameworkContributionCatalog } from "./phpFrameworkContributionCatalog";
import { orderPhpFrameworkRegistrationsByPriority } from "./phpFrameworkRegistrationOrdering";

export interface PhpFrameworkSemanticAdapterContribution<TAdapter> {
  readonly id: string;
  readonly priority?: number;
  readonly capability?: PhpFrameworkProviderCapability;
  readonly providerId?: string;
  createAdapter(): TAdapter;
}

export function activePhpFrameworkSemanticAdapter<TAdapter>(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider"> &
    Partial<Pick<PhpFrameworkRuntimeContext, "supports">>,
  contributions: readonly PhpFrameworkSemanticAdapterContribution<TAdapter>[],
  fallback: TAdapter,
): TAdapter {
  const catalog = createPhpFrameworkContributionCatalog(contributions, {
    duplicateIdMessage: (id) =>
      `Duplicate PHP framework semantic contribution id "${id}".`,
  });
  const contribution = orderPhpFrameworkRegistrationsByPriority(catalog).find(
    (candidate) =>
      phpFrameworkSemanticAdapterContributionActive(frameworkRuntime, candidate),
  );

  if (!contribution) {
    return fallback;
  }

  return contribution.createAdapter();
}

function phpFrameworkSemanticAdapterContributionActive<TAdapter>(
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider"> &
    Partial<Pick<PhpFrameworkRuntimeContext, "supports">>,
  contribution: PhpFrameworkSemanticAdapterContribution<TAdapter>,
): boolean {
  if (contribution.capability) {
    return frameworkRuntime.supports?.(contribution.capability) === true;
  }

  return contribution.providerId !== undefined
    ? frameworkRuntime.hasProvider(contribution.providerId)
    : false;
}

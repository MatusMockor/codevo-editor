import type {
  PhpFrameworkProvider,
  PhpFrameworkProviderCapability,
} from "../domain/phpFrameworkProviders";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

type PhpFrameworkContributionSelector<TContribution> = (
  provider: PhpFrameworkProvider,
) => readonly TContribution[] | undefined;

export type CollectActiveContributionsOptions<TContribution> =
  | {
      capability?: never;
      frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers">;
      select: PhpFrameworkContributionSelector<TContribution>;
    }
  | {
      capability: PhpFrameworkProviderCapability;
      frameworkRuntime: Pick<
        PhpFrameworkRuntimeContext,
        "providers" | "supports"
      >;
      select: PhpFrameworkContributionSelector<TContribution>;
    };

export function collectActiveContributions<TContribution>(
  options: CollectActiveContributionsOptions<TContribution>,
): TContribution[] {
  return activeContributionProviders(options).flatMap(
    (provider) => options.select(provider) ?? [],
  );
}

function activeContributionProviders<TContribution>(
  options: CollectActiveContributionsOptions<TContribution>,
): readonly PhpFrameworkProvider[] {
  if (options.capability === undefined) {
    return options.frameworkRuntime.providers;
  }

  if (!options.frameworkRuntime.supports(options.capability)) {
    return [];
  }

  return options.frameworkRuntime.providers;
}

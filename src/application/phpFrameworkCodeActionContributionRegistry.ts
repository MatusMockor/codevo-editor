import { collectActiveContributions } from "./phpFrameworkContributionRegistry";
import type {
  ActivePhpFrameworkCodeActionContribution,
  PhpFrameworkCodeActionContributionAdapter,
} from "./phpFrameworkCodeActionContributions";
import { assertUniquePhpFrameworkRegistrationIds } from "./phpFrameworkExtensionRegistry";
import { orderPhpFrameworkRegistrationsByPriority } from "./phpFrameworkRegistrationOrdering";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkCodeActionContribution } from "./phpCodeActionWorkspaceCollector";

export interface ActivePhpFrameworkCodeActions {
  readonly contributions: readonly PhpFrameworkCodeActionContribution[];
}

export function activePhpFrameworkCodeActions({
  contributionAdapters,
  frameworkRuntime,
}: {
  contributionAdapters: readonly PhpFrameworkCodeActionContributionAdapter[];
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers" | "supports">;
}): ActivePhpFrameworkCodeActions {
  assertUniquePhpFrameworkRegistrationIds(
    contributionAdapters,
    "PHP framework code-action contribution catalog",
  );
  const activeContributions = collectActiveContributions({
    capability: "codeActions",
    frameworkRuntime,
    select: (provider) =>
      contributionAdapters.flatMap((adapter) =>
        adapter.contributionsFor(provider).map((contribution) => ({
          ...contribution,
          priority: contribution.priority ?? adapter.priority ?? 0,
        })),
      ),
  });
  const orderedContributions =
    orderActiveCodeActionContributions(activeContributions);

  return {
    contributions: orderedContributions.map(
      (contribution) => contribution.providePhpCodeAction,
    ),
  };
}

function orderActiveCodeActionContributions(
  contributions: readonly ActivePhpFrameworkCodeActionContribution[],
): readonly ActivePhpFrameworkCodeActionContribution[] {
  assertUniquePhpFrameworkRegistrationIds(
    contributions,
    "active PHP framework code-action contributions",
  );

  return orderPhpFrameworkRegistrationsByPriority(contributions, (left, right) =>
    left.registration.id.localeCompare(right.registration.id),
  );
}

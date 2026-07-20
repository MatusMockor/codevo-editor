import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import { createPhpFrameworkContributionCatalog } from "./phpFrameworkContributionCatalog";
import type { PhpMemberCompletionContribution } from "./phpMemberCompletionContribution";
import {
  phpFrameworkPlugins,
} from "./phpFrameworkPluginCatalog";
import type { PhpFrameworkPlugin } from "./phpFrameworkPlugin";
import { orderPhpFrameworkRegistrationsByPriority } from "./phpFrameworkRegistrationOrdering";

export interface PhpFrameworkMemberCompletionContributionRegistration {
  readonly contribution: PhpMemberCompletionContribution;
  readonly id: string;
  readonly providerId: string;
}

export function phpFrameworkMemberCompletionContributions(
  runtime: PhpFrameworkRuntimeContext,
  registrations: readonly PhpFrameworkMemberCompletionContributionRegistration[] =
    phpFrameworkMemberCompletionContributionRegistrations(phpFrameworkPlugins),
): readonly PhpMemberCompletionContribution[] {
  const registeredProviderIds = new Set(
    registrations.map(({ providerId }) => providerId),
  );
  const legacyContributions: PhpMemberCompletionContribution[] =
    runtime.providers.flatMap((provider) => {
      const collect = provider.completions?.memberCompletionsFromSource;

      if (
        !runtime.hasProvider(provider.id) ||
        !collect ||
        registeredProviderIds.has(provider.id)
      ) {
        return [];
      }

      return [
        {
          id: `${provider.id}.legacy-member-completions`,
          collect: ({ declaringClassName, source, workspaceSources }) =>
            collect({
              declaringClassName,
              source,
              sourceContext:
                workspaceSources.length > 0 ? { workspaceSources } : undefined,
            }),
        } satisfies PhpMemberCompletionContribution,
      ];
    });

  return orderPhpFrameworkRegistrationsByPriority(
    [
      ...registrations
        .filter(({ providerId }) => runtime.hasProvider(providerId))
        .map(({ contribution }) => contribution),
      ...legacyContributions,
    ],
  );
}

export function phpFrameworkMemberCompletionContributionRegistrations(
  plugins: readonly PhpFrameworkPlugin[],
): readonly PhpFrameworkMemberCompletionContributionRegistration[] {
  return createPhpFrameworkContributionCatalog(
    plugins.flatMap(({ memberCompletions = [], provider }) =>
      memberCompletions.map((contribution) => ({
        contribution,
        id: contribution.id,
        providerId: provider.id,
      })),
    ),
    {
      duplicateIdMessage: (id) =>
        `Duplicate PHP member completion contribution id: ${id}`,
    },
  );
}

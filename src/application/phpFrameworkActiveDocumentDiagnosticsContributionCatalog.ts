import type {
  PhpFrameworkActiveDocumentDiagnosticsContribution,
  PhpFrameworkActiveDocumentDiagnosticsDescriptorLike,
} from "./phpFrameworkActiveDocumentDiagnosticsContributions";
import { orderPhpFrameworkRegistrationsByPriority } from "./phpFrameworkRegistrationOrdering";

export type PhpFrameworkActiveDocumentDiagnosticsContributionCatalog =
  readonly PhpFrameworkActiveDocumentDiagnosticsContribution[];

export function createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog(
  contributions: readonly PhpFrameworkActiveDocumentDiagnosticsContribution[],
): PhpFrameworkActiveDocumentDiagnosticsContributionCatalog {
  assertUniqueContributionIds(contributions);

  return Object.freeze([...contributions]);
}

export function activeDocumentDiagnosticsContributionForDescriptor(
  catalog: PhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
  descriptor: PhpFrameworkActiveDocumentDiagnosticsDescriptorLike,
): PhpFrameworkActiveDocumentDiagnosticsContribution | null {
  const matching = orderPhpFrameworkRegistrationsByPriority(
    catalog.filter((contribution) => contribution.supports(descriptor)),
  );

  return matching[0] ?? null;
}

function assertUniqueContributionIds(
  contributions: readonly PhpFrameworkActiveDocumentDiagnosticsContribution[],
): void {
  const seen = new Set<string>();

  for (const contribution of contributions) {
    if (seen.has(contribution.id)) {
      throw new Error(
        `Duplicate PHP active-document diagnostics contribution id: ${contribution.id}`,
      );
    }

    seen.add(contribution.id);
  }
}

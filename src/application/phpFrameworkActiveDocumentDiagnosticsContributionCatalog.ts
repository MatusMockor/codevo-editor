import type {
  PhpFrameworkActiveDocumentDiagnosticsContribution,
  PhpFrameworkActiveDocumentDiagnosticsDescriptorLike,
} from "./phpFrameworkActiveDocumentDiagnosticsContributions";
import {
  createPhpFrameworkContributionCatalog,
  firstPhpFrameworkContributionForDescriptor,
} from "./phpFrameworkContributionCatalog";

export type PhpFrameworkActiveDocumentDiagnosticsContributionCatalog =
  readonly PhpFrameworkActiveDocumentDiagnosticsContribution[];

export function createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog(
  contributions: readonly PhpFrameworkActiveDocumentDiagnosticsContribution[],
): PhpFrameworkActiveDocumentDiagnosticsContributionCatalog {
  return createPhpFrameworkContributionCatalog(contributions, {
    duplicateIdMessage: (id) =>
      `Duplicate PHP active-document diagnostics contribution id: ${id}`,
  });
}

export function activeDocumentDiagnosticsContributionForDescriptor(
  catalog: PhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
  descriptor: PhpFrameworkActiveDocumentDiagnosticsDescriptorLike,
): PhpFrameworkActiveDocumentDiagnosticsContribution | null {
  return firstPhpFrameworkContributionForDescriptor(catalog, descriptor);
}

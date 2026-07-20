import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { createPhpBladeViewReferenceDiagnosticsContribution } from "./phpBladeActiveDocumentDiagnosticsContribution";
import {
  createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
  type PhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
} from "./phpFrameworkActiveDocumentDiagnosticsContributionCatalog";
import {
  createPhpNetteLattePresenterLinkDiagnosticsContribution,
  createPhpNetteLatteTemplateReferenceDiagnosticsContribution,
} from "./phpNetteActiveDocumentDiagnosticsContributions";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export interface PhpFrameworkActiveDocumentDiagnosticsCompositionDependencies {
  collectCompleteLatteTemplateRelativePaths: () => Promise<readonly string[]>;
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"];
  provideLattePresenterLinkDiagnostics: (
    source: string,
    currentTemplateRelativePath: string,
  ) => Promise<LanguageServerDiagnostic[]>;
}

export function composePhpFrameworkActiveDocumentDiagnosticsContributions({
  collectCompleteLatteTemplateRelativePaths,
  collectViewTargets,
  provideLattePresenterLinkDiagnostics,
}: PhpFrameworkActiveDocumentDiagnosticsCompositionDependencies): PhpFrameworkActiveDocumentDiagnosticsContributionCatalog {
  return createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog([
    createPhpBladeViewReferenceDiagnosticsContribution(collectViewTargets),
    createPhpNetteLatteTemplateReferenceDiagnosticsContribution(
      collectCompleteLatteTemplateRelativePaths,
    ),
    createPhpNetteLattePresenterLinkDiagnosticsContribution(
      provideLattePresenterLinkDiagnostics,
    ),
  ]);
}

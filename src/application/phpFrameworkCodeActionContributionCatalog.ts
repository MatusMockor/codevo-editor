import type { PhpFrameworkCodeActionContributionAdapter } from "./phpFrameworkCodeActionContributions";
import {
  createPhpMissingTemplateFileCodeActionContribution,
  type PhpMissingTemplateFileCodeActionDependencies,
} from "./phpMissingTemplateFileCodeActionContribution";
import { phpNettePresenterLinkCodeActionContribution } from "./phpNettePresenterLinkCodeActionContribution";

/** Application composition root for framework-owned PHP code actions. */
export function createPhpFrameworkCodeActionContributionCatalog(
  dependencies: PhpMissingTemplateFileCodeActionDependencies,
): readonly PhpFrameworkCodeActionContributionAdapter[] {
  return [
    createPhpMissingTemplateFileCodeActionContribution(dependencies),
    phpNettePresenterLinkCodeActionContribution,
  ];
}

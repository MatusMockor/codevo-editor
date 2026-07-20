import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { netteLatteReferenceDiagnostics } from "../domain/netteTemplateDiagnostics";
import type { PhpFrameworkActiveDocumentDiagnosticsContribution } from "./phpFrameworkActiveDocumentDiagnosticsContributions";

export function createPhpNetteLatteTemplateReferenceDiagnosticsContribution(
  collectCompleteLatteTemplateRelativePaths: () => Promise<readonly string[]>,
): PhpFrameworkActiveDocumentDiagnosticsContribution {
  return {
    id: "latteTemplateReferences",
    supports: (descriptor) => descriptor.kind === "latteTemplateReferences",
    provideDiagnostics: async ({ document }) => {
      const templateRelativePaths =
        await collectCompleteLatteTemplateRelativePaths();

      return netteLatteReferenceDiagnostics(
        document.content,
        document.path,
        templateRelativePaths,
      );
    },
  };
}

export function createPhpNetteLattePresenterLinkDiagnosticsContribution(
  provideLattePresenterLinkDiagnostics: (
    source: string,
    currentTemplateRelativePath: string,
  ) => Promise<LanguageServerDiagnostic[]>,
): PhpFrameworkActiveDocumentDiagnosticsContribution {
  return {
    id: "lattePresenterLinks",
    supports: (descriptor) => descriptor.kind === "lattePresenterLinks",
    provideDiagnostics: ({ document }) =>
      provideLattePresenterLinkDiagnostics(document.content, document.path),
  };
}

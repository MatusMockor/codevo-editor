import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { bladeLaravelReferenceDiagnostics } from "../domain/laravelDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export interface PhpFrameworkActiveDocumentDiagnosticsDependencies {
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"];
}

interface PhpFrameworkActiveDocumentDiagnosticsContribution {
  readonly providerId: string;
  supportsDocument(document: EditorDocument): boolean;
  provideDiagnostics(
    document: EditorDocument,
    dependencies: PhpFrameworkActiveDocumentDiagnosticsDependencies,
  ): Promise<LanguageServerDiagnostic[]>;
}

const PHP_FRAMEWORK_ACTIVE_DOCUMENT_DIAGNOSTICS_CONTRIBUTIONS: readonly PhpFrameworkActiveDocumentDiagnosticsContribution[] =
  [
    {
      providerId: "laravel",
      supportsDocument: (document) => document.language === "blade",
      provideDiagnostics: async (document, { collectViewTargets }) => {
        const viewTargets = await collectViewTargets();

        return bladeLaravelReferenceDiagnostics(document.content, {
          viewNames: viewTargets.map((target) => target.name),
        });
      },
    },
  ];

export interface PhpFrameworkActiveDocumentDiagnosticsProvider {
  provideDiagnostics(): Promise<LanguageServerDiagnostic[]>;
}

export function activePhpFrameworkDocumentDiagnosticsProvider({
  frameworkRuntime,
  document,
  ...dependencies
}: PhpFrameworkActiveDocumentDiagnosticsDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  document: EditorDocument;
}): PhpFrameworkActiveDocumentDiagnosticsProvider | null {
  const contributions =
    PHP_FRAMEWORK_ACTIVE_DOCUMENT_DIAGNOSTICS_CONTRIBUTIONS.filter(
      (contribution) =>
        frameworkRuntime.hasProvider(contribution.providerId) &&
        contribution.supportsDocument(document),
    );

  if (contributions.length === 0) {
    return null;
  }

  return {
    provideDiagnostics: async () => {
      const diagnostics = await Promise.all(
        contributions.map((contribution) =>
          contribution.provideDiagnostics(document, dependencies),
        ),
      );

      return diagnostics.flat();
    },
  };
}

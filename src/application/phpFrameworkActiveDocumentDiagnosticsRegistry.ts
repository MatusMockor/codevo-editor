import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { bladeLaravelReferenceDiagnostics } from "../domain/laravelDiagnostics";
import { netteLatteReferenceDiagnostics } from "../domain/netteTemplateDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export interface PhpFrameworkActiveDocumentDiagnosticsDependencies {
  collectCompleteLatteTemplateRelativePaths: () => Promise<readonly string[]>;
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
    {
      providerId: "nette",
      supportsDocument: (document) => document.language === "latte",
      provideDiagnostics: async (
        document,
        { collectCompleteLatteTemplateRelativePaths },
      ) => {
        const templateRelativePaths =
          await collectCompleteLatteTemplateRelativePaths();

        return netteLatteReferenceDiagnostics(
          document.content,
          document.path,
          templateRelativePaths,
        );
      },
    },
  ];

export interface PhpFrameworkActiveDocumentDiagnosticsProvider {
  provideDiagnostics(): Promise<LanguageServerDiagnostic[]>;
}

export function activePhpFrameworkDocumentDiagnosticsProvider({
  frameworkRuntime,
  document,
  workspaceRoot,
  ...dependencies
}: PhpFrameworkActiveDocumentDiagnosticsDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "hasProvider">;
  document: EditorDocument;
  workspaceRoot: string;
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
      const diagnosticDocument = documentWithWorkspaceRelativePath(
        document,
        workspaceRoot,
      );
      const diagnostics = await Promise.all(
        contributions.map((contribution) =>
          contribution.provideDiagnostics(diagnosticDocument, dependencies),
        ),
      );

      return diagnostics.flat();
    },
  };
}

function documentWithWorkspaceRelativePath(
  document: EditorDocument,
  workspaceRoot: string,
): EditorDocument {
  const normalizedRoot = normalizePathSeparators(workspaceRoot).replace(/\/+$/, "");
  const normalizedPath = normalizePathSeparators(document.path);
  const prefix = `${normalizedRoot}/`;

  if (!normalizedPath.startsWith(prefix)) {
    return document;
  }

  return {
    ...document,
    path: normalizedPath.slice(prefix.length),
  };
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, "/");
}

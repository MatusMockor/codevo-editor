import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { EditorDocument } from "../domain/workspace";
import { collectActiveContributions } from "./phpFrameworkContributionRegistry";
import {
  activeDocumentDiagnosticsContributionForDescriptor,
  type PhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
} from "./phpFrameworkActiveDocumentDiagnosticsContributionCatalog";
import type {
  PhpFrameworkActiveDocumentDiagnosticsContribution,
  PhpFrameworkActiveDocumentDiagnosticsDescriptorLike,
} from "./phpFrameworkActiveDocumentDiagnosticsContributions";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";

export interface PhpFrameworkActiveDocumentDiagnosticsProvider {
  provideDiagnostics(): Promise<LanguageServerDiagnostic[]>;
}

export function activePhpFrameworkDocumentDiagnosticsProvider({
  frameworkRuntime,
  document,
  workspaceRoot,
  contributions,
}: {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers">;
  document: EditorDocument;
  workspaceRoot: string;
  contributions: PhpFrameworkActiveDocumentDiagnosticsContributionCatalog;
}): PhpFrameworkActiveDocumentDiagnosticsProvider | null {
  const descriptors = collectActiveContributions({
    frameworkRuntime,
    select: (provider) =>
      provider.activeDocumentDiagnostics?.filter(
        (descriptor) => descriptor.language === document.language,
      ),
  });

  const activeContributions = diagnosticsContributionsForDescriptors(
    descriptors,
    contributions,
  );

  if (activeContributions.length === 0) {
    return null;
  }

  return {
    provideDiagnostics: async () => {
      const diagnosticDocument = documentWithWorkspaceRelativePath(
        document,
        workspaceRoot,
      );
      const diagnostics = await Promise.all(
        activeContributions.map((contribution) =>
          contribution.provideDiagnostics({
            document: diagnosticDocument,
          }),
        ),
      );

      return diagnostics.flat();
    },
  };
}

function diagnosticsContributionsForDescriptors(
  descriptors: readonly PhpFrameworkActiveDocumentDiagnosticsDescriptorLike[],
  catalog: PhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
): readonly PhpFrameworkActiveDocumentDiagnosticsContribution[] {
  const seen = new Set<string>();
  const contributions: PhpFrameworkActiveDocumentDiagnosticsContribution[] = [];

  for (const descriptor of descriptors) {
    const contribution = activeDocumentDiagnosticsContributionForDescriptor(
      catalog,
      descriptor,
    );

    if (!contribution || seen.has(contribution.id)) {
      continue;
    }

    seen.add(contribution.id);
    contributions.push(contribution);
  }

  return contributions;
}

function documentWithWorkspaceRelativePath(
  document: EditorDocument,
  workspaceRoot: string,
): EditorDocument {
  const normalizedRoot = normalizePathSeparators(workspaceRoot).replace(
    /\/+$/,
    "",
  );
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

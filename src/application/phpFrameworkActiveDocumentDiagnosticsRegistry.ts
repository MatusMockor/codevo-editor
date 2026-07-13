import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import { bladeLaravelReferenceDiagnostics } from "../domain/laravelDiagnostics";
import { netteLatteReferenceDiagnostics } from "../domain/netteTemplateDiagnostics";
import type { PhpFrameworkActiveDocumentDiagnosticsDescriptor } from "../domain/phpFrameworkProviders";
import type { EditorDocument } from "../domain/workspace";
import type { PhpFrameworkRuntimeContext } from "./phpFrameworkRuntimeContext";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";

export interface PhpFrameworkActiveDocumentDiagnosticsDependencies {
  collectCompleteLatteTemplateRelativePaths: () => Promise<readonly string[]>;
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"];
  provideLattePresenterLinkDiagnostics: (
    source: string,
    currentTemplateRelativePath: string,
  ) => Promise<LanguageServerDiagnostic[]>;
}

export interface PhpFrameworkActiveDocumentDiagnosticsProvider {
  provideDiagnostics(): Promise<LanguageServerDiagnostic[]>;
}

export function activePhpFrameworkDocumentDiagnosticsProvider({
  frameworkRuntime,
  document,
  workspaceRoot,
  ...dependencies
}: PhpFrameworkActiveDocumentDiagnosticsDependencies & {
  frameworkRuntime: Pick<PhpFrameworkRuntimeContext, "providers">;
  document: EditorDocument;
  workspaceRoot: string;
}): PhpFrameworkActiveDocumentDiagnosticsProvider | null {
  const descriptors = frameworkRuntime.providers.flatMap((provider) =>
    (provider.activeDocumentDiagnostics ?? []).filter(
      (descriptor) => descriptor.language === document.language,
    ),
  );

  if (descriptors.length === 0) {
    return null;
  }

  return {
    provideDiagnostics: async () => {
      const diagnosticDocument = documentWithWorkspaceRelativePath(
        document,
        workspaceRoot,
      );
      const diagnostics = await Promise.all(
        descriptors.map((descriptor) =>
          provideDescriptorDiagnostics(
            descriptor,
            diagnosticDocument,
            dependencies,
          ),
        ),
      );

      return diagnostics.flat();
    },
  };
}

async function provideDescriptorDiagnostics(
  descriptor: PhpFrameworkActiveDocumentDiagnosticsDescriptor,
  document: EditorDocument,
  dependencies: PhpFrameworkActiveDocumentDiagnosticsDependencies,
): Promise<LanguageServerDiagnostic[]> {
  switch (descriptor.kind) {
    case "bladeViewReferences":
      return bladeViewReferenceDiagnostics(document, dependencies);
    case "lattePresenterLinks":
      return dependencies.provideLattePresenterLinkDiagnostics(
        document.content,
        document.path,
      );
    case "latteTemplateReferences":
      return latteTemplateReferenceDiagnostics(document, dependencies);
  }
}

async function bladeViewReferenceDiagnostics(
  document: EditorDocument,
  { collectViewTargets }: PhpFrameworkActiveDocumentDiagnosticsDependencies,
): Promise<LanguageServerDiagnostic[]> {
  const viewTargets = await collectViewTargets();

  return bladeLaravelReferenceDiagnostics(document.content, {
    viewNames: viewTargets.map((target) => target.name),
  });
}

async function latteTemplateReferenceDiagnostics(
  document: EditorDocument,
  {
    collectCompleteLatteTemplateRelativePaths,
  }: PhpFrameworkActiveDocumentDiagnosticsDependencies,
): Promise<LanguageServerDiagnostic[]> {
  const templateRelativePaths =
    await collectCompleteLatteTemplateRelativePaths();

  return netteLatteReferenceDiagnostics(
    document.content,
    document.path,
    templateRelativePaths,
  );
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

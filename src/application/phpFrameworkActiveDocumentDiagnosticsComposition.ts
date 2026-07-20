import {
  createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
  type PhpFrameworkActiveDocumentDiagnosticsContributionCatalog,
} from "./phpFrameworkActiveDocumentDiagnosticsContributionCatalog";
import type {
  PhpFrameworkPlugin,
} from "./phpFrameworkPlugin";
import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { PhpFrameworkTargets } from "./usePhpFrameworkTargets";
import {
  phpFrameworkPluginContributions,
  phpFrameworkPlugins,
} from "./phpFrameworkPluginCatalog";

export interface PhpFrameworkActiveDocumentDiagnosticsCompositionDependencies {
  collectCompleteLatteTemplateRelativePaths(): Promise<readonly string[]>;
  collectViewTargets: PhpFrameworkTargets["collectViewTargets"];
  provideLattePresenterLinkDiagnostics(
    source: string,
    currentTemplateRelativePath: string,
  ): Promise<LanguageServerDiagnostic[]>;
}

export function composePhpFrameworkActiveDocumentDiagnosticsContributions(
  dependencies: PhpFrameworkActiveDocumentDiagnosticsCompositionDependencies,
  plugins: readonly PhpFrameworkPlugin[] = phpFrameworkPlugins,
): PhpFrameworkActiveDocumentDiagnosticsContributionCatalog {
  return createPhpFrameworkActiveDocumentDiagnosticsContributionCatalog(
    phpFrameworkPluginContributions(
      plugins,
      (plugin) => plugin.diagnostics,
      {
        collectTemplateRelativePaths:
          dependencies.collectCompleteLatteTemplateRelativePaths,
        collectTemplateTargets: dependencies.collectViewTargets,
        provideTemplateLinkDiagnostics:
          dependencies.provideLattePresenterLinkDiagnostics,
      },
      "PHP framework active-document diagnostics catalog",
    ),
  );
}

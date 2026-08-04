import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import type {
  LanguageServerDocumentSymbol,
  LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import {
  defaultLargeSmartDocumentPolicy,
  isLargeSmartDocumentContent,
} from "../domain/largeDocumentPolicy";
import type { EditorDocument } from "../domain/workspace";

type BreadcrumbFeaturesGateway = Pick<LanguageServerFeaturesGateway, "documentSymbols">;

export function editorSurfaceBreadcrumbFeaturesGateway(
  document: EditorDocument,
  gateways: {
    javaScriptTypeScript: BreadcrumbFeaturesGateway;
    php: BreadcrumbFeaturesGateway;
  },
): BreadcrumbFeaturesGateway | null {
  if (isJavaScriptTypeScriptLanguageServerDocument(document)) {
    return policyGatedBreadcrumbFeaturesGateway(document, gateways.javaScriptTypeScript);
  }
  return isLanguageServerDocument(document) ? gateways.php : null;
}

function policyGatedBreadcrumbFeaturesGateway(
  document: EditorDocument,
  gateway: BreadcrumbFeaturesGateway,
): BreadcrumbFeaturesGateway {
  return {
    documentSymbols: (rootPath: string, path: string) => {
      if (path !== document.path) {
        return emptyBreadcrumbSymbols();
      }

      if (typeof document.content !== "string") {
        return emptyBreadcrumbSymbols();
      }

      if (isLargeSmartDocumentContent(document.content, defaultLargeSmartDocumentPolicy)) {
        return emptyBreadcrumbSymbols();
      }

      return gateway.documentSymbols(rootPath, path);
    },
  };
}

function emptyBreadcrumbSymbols(): Promise<LanguageServerDocumentSymbol[]> {
  return Promise.resolve([]);
}

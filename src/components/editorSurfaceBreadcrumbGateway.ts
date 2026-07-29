import {
  isJavaScriptTypeScriptLanguageServerDocument,
  isLanguageServerDocument,
} from "../domain/languageServerDocumentSync";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
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
    return gateways.javaScriptTypeScript;
  }
  return isLanguageServerDocument(document) ? gateways.php : null;
}

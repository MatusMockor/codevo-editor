import type { LanguageServerDiagnostic } from "../domain/languageServerDiagnostics";
import type { EditorDocument } from "../domain/workspace";

export interface PhpFrameworkActiveDocumentDiagnosticsDescriptorLike {
  readonly kind: string;
  readonly language: string;
}

export interface PhpFrameworkActiveDocumentDiagnosticsRequest {
  readonly document: EditorDocument;
}

export interface PhpFrameworkActiveDocumentDiagnosticsContribution {
  readonly id: string;
  readonly priority?: number;
  supports(
    descriptor: PhpFrameworkActiveDocumentDiagnosticsDescriptorLike,
  ): boolean;
  provideDiagnostics(
    request: PhpFrameworkActiveDocumentDiagnosticsRequest,
  ): Promise<readonly LanguageServerDiagnostic[]>;
}

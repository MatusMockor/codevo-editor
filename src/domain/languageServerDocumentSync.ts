import type { EditorDocument } from "./workspace";

export interface LanguageServerTextDocument {
  path: string;
  languageId: string;
  version: number;
  text: string;
}

export interface LanguageServerDocumentSyncGateway {
  didOpen(document: LanguageServerTextDocument): Promise<void>;
  didChange(document: LanguageServerTextDocument): Promise<void>;
  didSave(document: LanguageServerTextDocument): Promise<void>;
  didClose(path: string): Promise<void>;
}

export function isLanguageServerDocument(document: EditorDocument): boolean {
  return document.language === "php";
}

export function createLanguageServerTextDocument(
  document: EditorDocument,
  version: number,
): LanguageServerTextDocument {
  return {
    languageId: document.language,
    path: document.path,
    text: document.content,
    version,
  };
}

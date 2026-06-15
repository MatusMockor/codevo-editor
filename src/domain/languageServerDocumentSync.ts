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

export function fileUriFromPath(path: string): string {
  const normalized = path.split("\\").join("/");
  const encoded = encodeUriPath(normalized);

  if (encoded.startsWith("/")) {
    return `file://${encoded}`;
  }

  return `file:///${encoded}`;
}

function encodeUriPath(path: string): string {
  let encoded = "";

  for (const character of path) {
    if (isUriPathCharacter(character)) {
      encoded += character;
      continue;
    }

    encoded += encodeURIComponent(character);
  }

  return encoded;
}

function isUriPathCharacter(character: string): boolean {
  return /^[A-Za-z0-9/:._~!$&'()*+,;=-]$/.test(character);
}

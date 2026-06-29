import type { EditorDocument } from "./workspace";

export interface LanguageServerTextDocument {
  path: string;
  languageId: string;
  version: number;
  text: string;
}

export interface LanguageServerDocumentSyncGateway {
  didOpen(rootPath: string, document: LanguageServerTextDocument): Promise<void>;
  didChange(rootPath: string, document: LanguageServerTextDocument): Promise<void>;
  didSave(rootPath: string, document: LanguageServerTextDocument): Promise<void>;
  didClose(rootPath: string, path: string): Promise<void>;
}

export function isLanguageServerDocument(document: EditorDocument): boolean {
  return document.language === "php";
}

export function isJavaScriptTypeScriptLanguageServerDocument(
  document: EditorDocument,
): boolean {
  const extension = document.path.split(".").pop()?.toLowerCase();

  return (
    document.language === "javascript" ||
    document.language === "javascriptreact" ||
    document.language === "typescript" ||
    document.language === "typescriptreact" ||
    document.language === "vue" ||
    extension === "jsx" ||
    extension === "tsx"
  );
}

export function createLanguageServerTextDocument(
  document: EditorDocument,
  version: number,
): LanguageServerTextDocument {
  return {
    languageId: languageServerLanguageIdForDocument(document),
    path: document.path,
    text: document.content,
    version,
  };
}

export function languageServerLanguageIdForDocument(
  document: Pick<EditorDocument, "language" | "path">,
): string {
  const extension = document.path.split(".").pop()?.toLowerCase();

  if (extension === "jsx") {
    return "javascriptreact";
  }

  if (extension === "tsx") {
    return "typescriptreact";
  }

  return document.language;
}

export function fileUriFromPath(path: string): string {
  const normalized = path.split("\\").join("/");
  const encoded = encodeUriPath(normalized);

  if (encoded.startsWith("/")) {
    return `file://${encoded}`;
  }

  return `file:///${encoded}`;
}

const WORKSPACE_SYNC_KEY_SEPARATOR = "\u0000";

export function languageServerDocumentSyncKey(
  rootPath: string,
  path: string,
): string {
  return [
    normalizedWorkspaceSyncPath(rootPath),
    normalizedWorkspaceSyncPath(path),
  ].join(WORKSPACE_SYNC_KEY_SEPARATOR);
}

export function languageServerUriSyncKey(rootPath: string, uri: string): string {
  return [normalizedWorkspaceSyncPath(rootPath), uri].join(
    WORKSPACE_SYNC_KEY_SEPARATOR,
  );
}

export function languageServerPathFromDocumentSyncKey(
  rootPath: string,
  key: string,
): string | null {
  const prefix = [normalizedWorkspaceSyncPath(rootPath), ""].join(
    WORKSPACE_SYNC_KEY_SEPARATOR,
  );

  if (!key.startsWith(prefix)) {
    return null;
  }

  return key.slice(prefix.length);
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

function normalizedWorkspaceSyncPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

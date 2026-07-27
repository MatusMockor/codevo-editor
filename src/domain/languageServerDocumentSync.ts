import type { EditorDocument } from "./workspace";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type CanonicalFileUri,
  type WorkspacePathKey,
  type WorkspaceRootDescriptor,
} from "./workspacePath";

export interface LanguageServerTextDocument {
  path: string;
  languageId: string;
  version: number;
  text: string;
}

export interface LanguageServerDocumentSyncGateway {
  didOpen(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void>;
  didChange(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void>;
  didSave(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void>;
  didClose(rootPath: string, path: string, expectedSessionId: number): Promise<void>;
}

export const sessionBoundLanguageServerDocumentSyncGateway = Symbol(
  "sessionBoundLanguageServerDocumentSyncGateway",
);

export interface SessionBoundLanguageServerDocumentSyncGateway {
  readonly [sessionBoundLanguageServerDocumentSyncGateway]: true;
  didOpen(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void>;
  didChange(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void>;
  didSave(
    rootPath: string,
    document: LanguageServerTextDocument,
    expectedSessionId: number,
  ): Promise<void>;
  didClose(rootPath: string, path: string, expectedSessionId: number): Promise<void>;
}

export function isLanguageServerDocument(document: EditorDocument): boolean {
  return document.language === "php";
}

export function isJavaScriptTypeScriptLanguageServerDocument(document: EditorDocument): boolean {
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
  const workspacePath = createWorkspaceRootFromPath(path);

  if (!workspacePath.ok) {
    throw new TypeError(`Invalid local file path: ${path}`);
  }

  return workspacePath.value.fileUri.replace(/^file:\/\/\/([A-Za-z])%3A\//, "file:///$1:/");
}

export function fileUriFromWorkspacePath(
  root: WorkspaceRootDescriptor,
  path: string,
): CanonicalFileUri | null {
  const workspacePath = parseWorkspacePath(root, path);

  return workspacePath.ok ? workspacePath.value.fileUri : null;
}

export function languageServerDocumentSyncKey(rootPath: string, path: string): WorkspacePathKey {
  return workspacePathKey(rootPath, path) ?? legacySyncKey(rootPath, path);
}

/**
 * Unscoped compatibility wrapper for callers not yet migrated to nullable keys.
 * Prefer tryLanguageServerUriSyncKey at server trust boundaries.
 */
export function languageServerUriSyncKey(rootPath: string, uri: string): WorkspacePathKey {
  return tryLanguageServerUriSyncKey(rootPath, uri) ?? legacySyncKey(rootPath, uri);
}

export function tryLanguageServerUriSyncKey(
  rootPath: string,
  uri: string,
): WorkspacePathKey | null {
  return workspacePathKey(rootPath, uri);
}

export function languageServerPathFromDocumentSyncKey(
  rootPath: string,
  key: string,
): string | null {
  const root = workspaceRoot(rootPath);

  if (!root) {
    return legacyPathFromSyncKey(rootPath, key);
  }

  const keyParts = workspacePathKeyParts(key);
  const rootPathIdentity = parseWorkspacePath(root, root.nativePath);
  const rootKeyParts = rootPathIdentity.ok
    ? workspacePathKeyParts(rootPathIdentity.value.key)
    : null;

  if (!keyParts || !rootKeyParts || rootKeyParts.some((part, index) => keyParts[index] !== part)) {
    return null;
  }

  const path = [root.nativePath, ...keyParts.slice(rootKeyParts.length)].join("/");
  const workspacePath = parseWorkspacePath(root, path);

  if (!workspacePath.ok || workspacePath.value.key !== key) {
    return null;
  }

  return root.flavor === "windows-drive"
    ? workspacePath.value.nativePath.slice(1)
    : workspacePath.value.nativePath;
}

function workspacePathKey(rootPath: string, pathOrUri: string): WorkspacePathKey | null {
  const root = workspaceRoot(rootPath);

  if (!root) {
    return null;
  }

  const path = parseWorkspacePath(root, pathOrUri);

  return path.ok ? path.value.key : null;
}

function workspaceRoot(rootPath: string): WorkspaceRootDescriptor | null {
  const normalizedRootPath = rootPath.trim().split("\\").join("/");
  const root = createWorkspaceRootFromPath(normalizedRootPath);

  return root.ok ? root.value : null;
}

function workspacePathKeyParts(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(key);

    if (!Array.isArray(value) || !value.every((part) => typeof part === "string")) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

const LEGACY_SYNC_KEY_SEPARATOR = "\u0000";

function legacySyncKey(rootPath: string, path: string): WorkspacePathKey {
  return [normalizedLegacySyncPath(rootPath), normalizedLegacySyncPath(path)].join(
    LEGACY_SYNC_KEY_SEPARATOR,
  ) as WorkspacePathKey;
}

function legacyPathFromSyncKey(rootPath: string, key: string): string | null {
  const prefix = `${normalizedLegacySyncPath(rootPath)}${LEGACY_SYNC_KEY_SEPARATOR}`;

  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function normalizedLegacySyncPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

import type { EditorDocument } from "./workspace";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type CanonicalFileUri,
  type WorkspacePath,
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
  const absolutePath = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  const workspacePath = localWorkspacePath(absolutePath);

  if (!workspacePath) {
    throw new TypeError(`Invalid local file path: ${path}`);
  }

  return workspacePath.fileUri.replace(
    /^file:\/\/\/([A-Za-z])%3A\//,
    "file:///$1:/",
  );
}

export function fileUriFromWorkspacePath(
  root: WorkspaceRootDescriptor,
  path: string,
): CanonicalFileUri | null {
  const workspacePath = parseWorkspacePath(root, path);

  return workspacePath.ok ? workspacePath.value.fileUri : null;
}

export function languageServerDocumentSyncKey(
  rootPath: string,
  path: string,
): WorkspacePathKey {
  return workspacePathKey(rootPath, path) ?? legacySyncKey(rootPath, path);
}

/**
 * Unscoped compatibility wrapper for callers not yet migrated to nullable keys.
 * Prefer tryLanguageServerUriSyncKey at server trust boundaries.
 */
export function languageServerUriSyncKey(
  rootPath: string,
  uri: string,
): WorkspacePathKey {
  return tryLanguageServerUriSyncKey(rootPath, uri) ?? legacySyncKey(rootPath, uri);
}

export function tryLanguageServerUriSyncKey(
  rootPath: string,
  uri: string,
): WorkspacePathKey | null {
  const normalizedRoot = normalizedLegacySyncPath(rootPath);

  if (isWindowsDrivePath(normalizedRoot)) {
    const documentPath = windowsPathFromFileUri(uri);

    if (!documentPath || !isSameOrChildPath(normalizedRoot, documentPath)) {
      return null;
    }

    return legacySyncKey(normalizedRoot, documentPath);
  }

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

  if (!keyParts || keyParts[0] !== root.workspaceId) {
    return null;
  }

  const path = [root.nativePath, ...keyParts.slice(1)].join("/");
  const workspacePath = parseWorkspacePath(root, path);

  if (!workspacePath.ok || workspacePath.value.key !== key) {
    return null;
  }

  return workspacePath.value.nativePath;
}

function workspacePathKey(
  rootPath: string,
  pathOrUri: string,
): WorkspacePathKey | null {
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

function localWorkspacePath(pathOrUri: string): WorkspacePath | null {
  const root = createWorkspaceRootFromPath("/");

  if (!root.ok) {
    return null;
  }

  const path = parseWorkspacePath(root.value, pathOrUri);

  return path.ok ? path.value : null;
}

function workspacePathKeyParts(key: string): string[] | null {
  try {
    const value: unknown = JSON.parse(key);

    if (
      !Array.isArray(value) ||
      !value.every((part) => typeof part === "string")
    ) {
      return null;
    }

    return value;
  } catch {
    return null;
  }
}

const LEGACY_SYNC_KEY_SEPARATOR = "\u0000";

function legacySyncKey(rootPath: string, path: string): WorkspacePathKey {
  return [
    normalizedLegacySyncPath(rootPath),
    normalizedLegacySyncPath(path),
  ].join(LEGACY_SYNC_KEY_SEPARATOR) as WorkspacePathKey;
}

function legacyPathFromSyncKey(rootPath: string, key: string): string | null {
  const prefix = `${normalizedLegacySyncPath(rootPath)}${LEGACY_SYNC_KEY_SEPARATOR}`;

  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

function normalizedLegacySyncPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

function isWindowsDrivePath(path: string): boolean {
  return /^[A-Za-z]:\//.test(path);
}

function windowsPathFromFileUri(uri: string): string | null {
  if (
    !uri.toLowerCase().startsWith("file:") ||
    uri.includes("?") ||
    uri.includes("#") ||
    uri.includes("\\") ||
    /%(?:2f|5c)/i.test(uri)
  ) {
    return null;
  }

  const match = /^file:(?:\/\/([^/]*))?(\/.*)$/i.exec(uri);

  if (!match) {
    return null;
  }

  const authority = match[1] ?? "";

  if (authority && authority.toLowerCase() !== "localhost") {
    return null;
  }

  try {
    const decodedPath = decodeURIComponent(match[2] ?? "").slice(1);

    if (!isWindowsDrivePath(decodedPath) || decodedPath.includes("\0")) {
      return null;
    }

    return normalizedLegacySyncPath(decodedPath);
  } catch {
    return null;
  }
}

function isSameOrChildPath(rootPath: string, path: string): boolean {
  return path === rootPath || path.startsWith(`${rootPath}/`);
}

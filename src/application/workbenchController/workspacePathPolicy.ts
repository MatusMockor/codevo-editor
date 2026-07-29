import { isSessionPathInWorkspace } from "../documentSessionState";
import {
  detectLanguage,
  getFileName,
  getParentPath,
  type EditorDocument,
} from "../../domain/workspace";
import { isJavaScriptTypeScriptLanguageServerDocument } from "../../domain/languageServerDocumentSync";
import { normalizedWorkspaceRootKey } from "../../domain/workspaceRootKey";

export function relativeWorkspacePath(workspaceRoot: string, path: string): string {
  const normalizedRoot = workspaceRoot.replace(/\/+$/, "");
  const normalizedPath = path.split("\\").join("/");

  if (normalizedPath === normalizedRoot) {
    return getFileName(path);
  }

  if (normalizedPath.startsWith(`${normalizedRoot}/`)) {
    return normalizedPath.slice(normalizedRoot.length + 1);
  }

  return path;
}

export function workspacePathBelongsToRoot(
  path: string,
  workspaceRoot: string | null | undefined,
): boolean {
  const normalizedRoot = normalizedWorkspaceRootKey(workspaceRoot);
  const normalizedPath = normalizedWorkspaceRootKey(path);

  if (!normalizedRoot) return false;

  return (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`) ||
    normalizedPath.startsWith(`${normalizedRoot}\\`)
  );
}

export function isPhpPath(path: string): boolean {
  return path.toLowerCase().endsWith(".php");
}

export function parentDirectoriesInWorkspace(rootPath: string, path: string): string[] {
  if (!isSessionPathInWorkspace(rootPath, path)) {
    return [];
  }

  const root = normalizedSessionPath(rootPath);
  const directories: string[] = [];
  let current = normalizedSessionPath(getParentPath(path));

  while (isSessionPathInWorkspace(root, current)) {
    directories.unshift(current);

    if (current === root) {
      break;
    }

    const parent = normalizedSessionPath(getParentPath(current));

    if (parent === current) {
      break;
    }

    current = parent;
  }

  return directories;
}

export function isBlockedByManuallyCollapsedDirectory(
  directory: string,
  manuallyCollapsedDirectories: Set<string>,
): boolean {
  const normalizedDirectory = normalizedSessionPath(directory);

  for (const collapsedDirectory of manuallyCollapsedDirectories) {
    const normalizedCollapsedDirectory = normalizedSessionPath(collapsedDirectory);

    if (
      normalizedDirectory === normalizedCollapsedDirectory ||
      normalizedDirectory.startsWith(`${normalizedCollapsedDirectory}/`)
    ) {
      return true;
    }
  }

  return false;
}

export function isJavaScriptTypeScriptDocumentSyncableForRoot(
  rootPath: string,
  document: EditorDocument,
): boolean {
  return (
    document.readOnly !== true &&
    isJavaScriptTypeScriptLanguageServerDocument(document) &&
    isSessionPathInWorkspace(rootPath, document.path)
  );
}

export function shouldOpenJavaScriptTypeScriptNavigationTargetReadOnly(
  rootPath: string,
  path: string,
): boolean {
  return isJavaScriptTypeScriptNavigationPath(path) && !isSessionPathInWorkspace(rootPath, path);
}

function isJavaScriptTypeScriptNavigationPath(path: string): boolean {
  const language = detectLanguage(path);

  return (
    language === "javascript" ||
    language === "javascriptreact" ||
    language === "typescript" ||
    language === "typescriptreact"
  );
}

function normalizedSessionPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

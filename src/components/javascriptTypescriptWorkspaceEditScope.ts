import {
  pathFromLanguageServerUri,
  type LanguageServerWorkspaceEdit,
  type LanguageServerWorkspaceFileOperation,
} from "../domain/languageServerFeatures";
import {
  canonicalWorkspaceEditDocumentPath,
  canonicalWorkspaceEditDocumentVersion,
  mergeAliasedWorkspaceEditDocumentChanges,
} from "../domain/workspaceEditDocuments";

export function javaScriptTypeScriptWorkspaceEditForRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): LanguageServerWorkspaceEdit {
  const changes = Object.fromEntries(
    Object.entries(edit.changes).filter(([uri]) => uriIsInWorkspaceRoot(uri, rootPath)),
  );
  const documentVersions = Object.fromEntries(
    Object.entries(edit.documentVersions ?? {}).filter(([uri]) =>
      uriIsInWorkspaceRoot(uri, rootPath),
    ),
  );
  const fileOperations = (edit.fileOperations ?? []).filter((operation) =>
    javaScriptTypeScriptFileOperationIsInWorkspaceRoot(operation, rootPath),
  );

  return mergeAliasedWorkspaceEditDocumentChanges({
    ...(fileOperations.length > 0 ? { fileOperations } : {}),
    ...(Object.keys(documentVersions).length > 0 ? { documentVersions } : {}),
    changes,
  });
}

export function javaScriptTypeScriptWorkspaceEditIsFullyInRoot(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
): boolean {
  return (
    Object.keys(edit.changes).every((uri) => uriIsInWorkspaceRoot(uri, rootPath)) &&
    Object.keys(edit.documentVersions ?? {}).every((uri) => uriIsInWorkspaceRoot(uri, rootPath)) &&
    (edit.fileOperations ?? []).every((operation) =>
      javaScriptTypeScriptFileOperationIsInWorkspaceRoot(operation, rootPath),
    )
  );
}

export function javaScriptTypeScriptWorkspaceEditIsExactDocumentContinuation(
  edit: LanguageServerWorkspaceEdit,
  rootPath: string,
  path: string,
): boolean {
  const scopedEdit = javaScriptTypeScriptWorkspaceEditForRoot(edit, rootPath);
  const changedPaths = Object.keys(scopedEdit.changes).map(canonicalWorkspaceEditDocumentPath);
  return (
    changedPaths.length > 0 &&
    changedPaths.every((changedPath) => changedPath === path) &&
    (scopedEdit.fileOperations?.length ?? 0) === 0
  );
}

export function javaScriptTypeScriptWorkspaceEditVersionId(
  edit: LanguageServerWorkspaceEdit,
  uri: string,
): number | null | undefined {
  const version = canonicalWorkspaceEditDocumentVersion(edit, uri);
  return version.kind === "versioned" ? version.version : undefined;
}

function uriIsInWorkspaceRoot(uri: string, rootPath: string): boolean {
  const path = pathFromLanguageServerUri(uri);
  return path ? javaScriptTypeScriptPathIsInWorkspaceRoot(rootPath, path) : false;
}

export function javaScriptTypeScriptPathIsInWorkspaceRoot(rootPath: string, path: string): boolean {
  const normalizedRoot = normalizePath(rootPath);
  const normalizedPath = normalizePath(path);
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

export function javaScriptTypeScriptFileOperationIsInWorkspaceRoot(
  operation: LanguageServerWorkspaceFileOperation,
  rootPath: string,
): boolean {
  return fileOperationUris(operation).every((uri) => uriIsInWorkspaceRoot(uri, rootPath));
}

function fileOperationUris(operation: LanguageServerWorkspaceFileOperation): string[] {
  return operation.kind === "rename" ? [operation.oldUri, operation.newUri] : [operation.uri];
}

function normalizePath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

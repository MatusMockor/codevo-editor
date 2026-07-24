import { isJavaScriptTypeScriptLanguageServerDocument } from "../domain/languageServerDocumentSync";
import { workspaceRelativePath } from "../domain/pathDerivation";
import { isDirty, type EditorDocument, type WorkspaceDescriptor } from "../domain/workspace";
import type { WorkspaceExpressRouteSourceSnapshot } from "../domain/workspaceExpressRoutes";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";

export interface ExpressRoutesDocumentScope {
  content: string;
  path: string;
  rootPath: string;
}

export function dirtyExpressRoutesDocumentSnapshot(
  document: EditorDocument | null | undefined,
  workspaceRoot: string | null | undefined,
): WorkspaceExpressRouteSourceSnapshot | null {
  if (
    !document ||
    document.readOnly === true ||
    !workspaceRoot ||
    !isDirty(document) ||
    !isJavaScriptTypeScriptLanguageServerDocument(document)
  ) {
    return null;
  }
  const relativeFilePath = workspaceRelativePath(workspaceRoot, document.path);
  return relativeFilePath ? { relativeFilePath, source: document.content } : null;
}

export function dirtyExpressRoutesDocumentSnapshots(
  documents: readonly (EditorDocument | null | undefined)[],
  workspaceRoot: string | null | undefined,
): WorkspaceExpressRouteSourceSnapshot[] {
  const snapshotsByPath = new Map<string, WorkspaceExpressRouteSourceSnapshot>();
  for (const document of documents) {
    const snapshot = dirtyExpressRoutesDocumentSnapshot(document, workspaceRoot);
    if (snapshot) snapshotsByPath.set(snapshot.relativeFilePath, snapshot);
  }
  return [...snapshotsByPath.values()].sort((left, right) =>
    compareText(left.relativeFilePath, right.relativeFilePath),
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function expressRoutesDocumentScope(
  document: EditorDocument | null | undefined,
  workspaceRoot: string | null | undefined,
  workspaceDescriptor: WorkspaceDescriptor | null | undefined,
): ExpressRoutesDocumentScope | null {
  if (
    !document ||
    document.readOnly === true ||
    !workspaceRoot ||
    !workspaceDescriptor ||
    !workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath) ||
    !workspaceDescriptor.javaScriptTypeScript?.frameworks.includes("Express") ||
    !isJavaScriptTypeScriptLanguageServerDocument(document) ||
    workspaceRelativePath(workspaceRoot, document.path) === null
  ) {
    return null;
  }

  return {
    content: document.content,
    path: document.path,
    rootPath: workspaceRoot,
  };
}

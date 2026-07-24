import { normalizedJsTestRelativeFilePath } from "../domain/jsTestRunScope";
import {
  MAX_JS_TEST_EXPLORER_OPENED_FILES,
  type JsTestExplorerCurrentFileIdentity,
  type JsTestExplorerOpenedFilesSnapshot,
} from "../domain/jsTestExplorerFilter";
import type { EditorDocument } from "../domain/workspace";
import {
  createWorkspaceRoot,
  parseWorkspacePath,
  type WorkspacePathKey,
  type WorkspacePathPolicy,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";

export const MAX_JS_TEST_EXPLORER_OPENED_DOCUMENT_CANDIDATES = 4_096;

export interface JsTestExplorerActiveDocumentWorkspace {
  readonly policy: WorkspacePathPolicy;
  readonly selectedPath: string;
  readonly workspaceId: string;
}

export interface JsTestExplorerActiveDocumentOwnership {
  readonly activeDocument: Pick<EditorDocument, "path"> | null;
  readonly workspace: JsTestExplorerActiveDocumentWorkspace | null;
  readonly workspaceRoot: string | null;
}

export interface JsTestExplorerOpenedDocumentOwnership {
  readonly openedEditorResourcePaths: readonly string[];
  readonly workspace: JsTestExplorerActiveDocumentWorkspace | null;
  readonly workspaceRoot: string | null;
}

/**
 * Projects the exact current editor/workspace values into the only document authority needed by
 * the Test Explorer view. Monaco models, refs and gateways deliberately remain outside this seam.
 */
export function jsTestExplorerActiveDocumentIdentity({
  activeDocument,
  workspace,
  workspaceRoot,
}: JsTestExplorerActiveDocumentOwnership): JsTestExplorerCurrentFileIdentity | null {
  if (!activeDocument || !workspace || !workspaceRoot) {
    return null;
  }
  const root = ownedWorkspaceRoot(workspace, workspaceRoot);
  return root ? documentIdentity(root, activeDocument.path) : null;
}

/**
 * Builds the bounded opened-editor identity set used by the `@openedFiles` projection.
 * Invalid entries fail closed independently; dirty state and language are intentionally absent.
 */
export function jsTestExplorerOpenedDocumentIdentitySnapshot({
  openedEditorResourcePaths,
  workspace,
  workspaceRoot,
}: JsTestExplorerOpenedDocumentOwnership): JsTestExplorerOpenedFilesSnapshot | null {
  if (!Array.isArray(openedEditorResourcePaths) || !workspace || !workspaceRoot) return null;
  const root = ownedWorkspaceRoot(workspace, workspaceRoot);
  if (!root) return null;
  const hadEditorResources = openedEditorResourcePaths.length > 0;
  if (openedEditorResourcePaths.length > MAX_JS_TEST_EXPLORER_OPENED_DOCUMENT_CANDIDATES) {
    return openedFilesSnapshot(root, hadEditorResources, [], true);
  }

  const identities = new Map<WorkspacePathKey, JsTestExplorerCurrentFileIdentity>();
  for (const path of openedEditorResourcePaths) {
    const identity = documentIdentity(root, path);
    if (!identity) continue;
    const previous = identities.get(identity.pathKey);
    if (!previous || compareText(identity.relativeFilePath, previous.relativeFilePath) < 0) {
      identities.set(identity.pathKey, identity);
    }
    if (identities.size > MAX_JS_TEST_EXPLORER_OPENED_FILES) {
      return openedFilesSnapshot(root, hadEditorResources, [], true);
    }
  }
  const sorted = [...identities.values()].sort(
    (left, right) =>
      compareText(left.relativeFilePath, right.relativeFilePath) ||
      compareText(left.pathKey, right.pathKey),
  );
  return openedFilesSnapshot(root, hadEditorResources, sorted, false);
}

function ownedWorkspaceRoot(
  workspace: JsTestExplorerActiveDocumentWorkspace,
  workspaceRoot: string,
): WorkspaceRootDescriptor | null {
  if (
    typeof workspace.workspaceId !== "string" ||
    typeof workspace.selectedPath !== "string" ||
    !workspace.policy
  ) {
    return null;
  }
  const root = createWorkspaceRoot(workspace.workspaceId, workspaceRoot, workspace.policy);
  if (!root.ok) return null;
  const selectedRoot = parseWorkspacePath(root.value, workspace.selectedPath);
  return selectedRoot.ok && selectedRoot.value.relativePath === "" ? root.value : null;
}

function documentIdentity(
  root: WorkspaceRootDescriptor,
  path: unknown,
): JsTestExplorerCurrentFileIdentity | null {
  if (typeof path !== "string") return null;
  const documentPath = parseWorkspacePath(root, path);
  if (!documentPath.ok || !documentPath.value.relativePath) return null;

  try {
    const relativePath = normalizedJsTestRelativeFilePath(documentPath.value.relativePath);
    return relativePath === documentPath.value.relativePath
      ? Object.freeze({
          pathKey: documentPath.value.key,
          relativeFilePath: relativePath,
          root,
        })
      : null;
  } catch {
    return null;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function openedFilesSnapshot(
  root: WorkspaceRootDescriptor,
  hadEditorResources: boolean,
  identities: readonly JsTestExplorerCurrentFileIdentity[],
  truncated: boolean,
): JsTestExplorerOpenedFilesSnapshot {
  return Object.freeze({
    hadEditorResources,
    identities: Object.freeze([...identities]),
    root,
    truncated,
  });
}

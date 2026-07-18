import type {
  PhpChangeSignatureDocument,
  PhpChangeSignatureReference,
} from "../domain/phpChangeSignature";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePath,
  type WorkspaceRootDescriptor,
} from "../domain/workspacePath";

export type PhpChangeSignatureWorkspaceRejection =
  "invalidWorkspace" | "unversionedDocument" | "unsupportedTarget";

export type ValidatedPhpChangeSignatureWorkspace = {
  documents: ReadonlyMap<string, PhpChangeSignatureDocument>;
  kind: "valid";
  root: WorkspaceRootDescriptor;
};

export function validatePhpChangeSignatureWorkspace(options: {
  documents: readonly PhpChangeSignatureDocument[];
  rootPath: string;
}):
  | ValidatedPhpChangeSignatureWorkspace
  | { kind: "rejected"; reason: PhpChangeSignatureWorkspaceRejection } {
  const rootResult = createWorkspaceRootFromPath(options.rootPath);
  if (!rootResult.ok) {
    return { kind: "rejected", reason: "invalidWorkspace" };
  }

  const documents = new Map<string, PhpChangeSignatureDocument>();
  for (const document of options.documents) {
    const path = allowedPhpChangeSignatureTarget(
      rootResult.value,
      document.path,
    );
    if (!path) {
      return { kind: "rejected", reason: "unsupportedTarget" };
    }
    if (document.version === null && !document.contentHash) {
      return { kind: "rejected", reason: "unversionedDocument" };
    }
    const existing = documents.get(path.nativePath);
    if (
      existing &&
      (existing.content !== document.content ||
        existing.version !== document.version ||
        existing.contentHash !== document.contentHash)
    ) {
      return { kind: "rejected", reason: "unsupportedTarget" };
    }
    documents.set(path.nativePath, { ...document, path: path.nativePath });
  }

  return { documents, kind: "valid", root: rootResult.value };
}

export function canonicalPhpChangeSignatureReference(
  root: WorkspaceRootDescriptor,
  reference: PhpChangeSignatureReference,
): PhpChangeSignatureReference | null {
  const path = allowedPhpChangeSignatureTarget(root, reference.path);
  return path ? { ...reference, path: path.nativePath } : null;
}

export function allowedPhpChangeSignatureTarget(
  root: WorkspaceRootDescriptor,
  pathOrUri: string,
): WorkspacePath | null {
  const path = parseWorkspacePath(root, pathOrUri);
  if (!path.ok || !path.value.nativePath.toLowerCase().endsWith(".php")) {
    return null;
  }
  const relative = path.value.relativePath.toLowerCase();
  if (relative === "vendor" || relative.startsWith("vendor/")) return null;
  return path.value;
}

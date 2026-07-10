import {
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceEdit,
} from "./languageServerFeatures";
import {
  createWorkspaceRootFromPath,
  parseWorkspacePath,
  type WorkspacePath,
  type WorkspacePathKey,
  type WorkspaceRootDescriptor,
} from "./workspacePath";

/** @deprecated Unscoped compatibility helper. Use workspaceEditDocument with a root. */
export function canonicalWorkspaceEditDocumentPath(uri: string): string | null {
  const path = localWorkspaceEditDocument(uri);

  return path?.nativePath ?? null;
}

/** @deprecated Unscoped compatibility helper for pre-WorkspacePath callers. */
export function canonicalWorkspaceEditPath(path: string): string {
  const normalized = path.trim().split("\\").join("/");
  const absolutePath = normalized.startsWith("/")
    ? normalized
    : `/${normalized}`;
  const workspacePath = localWorkspaceEditDocument(absolutePath);

  if (!workspacePath) {
    throw new TypeError(`Invalid local workspace edit path: ${path}`);
  }

  return workspacePath.nativePath;
}

export function workspaceEditDocument(
  root: WorkspaceRootDescriptor,
  uri: string,
): WorkspacePath | null {
  const path = parseWorkspacePath(root, uri);

  return path.ok ? path.value : null;
}

/**
 * @deprecated Unscoped compatibility wrapper. Production providers must retain
 * explicit root filtering until they migrate to mergeWorkspaceEditDocumentChanges.
 */
export function mergeAliasedWorkspaceEditDocumentChanges(
  edit: LanguageServerWorkspaceEdit,
): LanguageServerWorkspaceEdit {
  const root = localWorkspaceRoot();

  if (!root) {
    return { ...edit, changes: {} };
  }

  return mergeWorkspaceEditDocumentChangesWithUriPolicy(root, edit, true);
}

export function mergeWorkspaceEditDocumentChanges(
  root: WorkspaceRootDescriptor,
  edit: LanguageServerWorkspaceEdit,
): LanguageServerWorkspaceEdit {
  return mergeWorkspaceEditDocumentChangesWithUriPolicy(root, edit, false);
}

function mergeWorkspaceEditDocumentChangesWithUriPolicy(
  root: WorkspaceRootDescriptor,
  edit: LanguageServerWorkspaceEdit,
  preserveRepresentativeUri: boolean,
): LanguageServerWorkspaceEdit {
  const changesByPath = new Map<
    WorkspacePathKey,
    { edits: LanguageServerTextEdit[]; path: WorkspacePath; uri: string }
  >();

  for (const [uri, edits] of Object.entries(edit.changes)) {
    const path = workspaceEditDocument(root, uri);

    if (!path) {
      continue;
    }

    const existing = changesByPath.get(path.key);

    if (existing) {
      existing.edits.push(...edits);
      continue;
    }

    changesByPath.set(path.key, { edits: [...edits], path, uri });
  }

  return {
    ...(edit.fileOperations?.length ? { fileOperations: edit.fileOperations } : {}),
    ...(edit.documentVersions
      ? { documentVersions: edit.documentVersions }
      : {}),
    changes: Object.fromEntries(
      Array.from(changesByPath.values()).map(({ edits, path, uri }) => [
        preserveRepresentativeUri ? uri : path.fileUri,
        edits,
      ]),
    ),
  };
}

export type CanonicalWorkspaceEditDocumentVersion =
  | { kind: "conflict" }
  | { kind: "unversioned" }
  | { kind: "versioned"; version: number };

/**
 * @deprecated Unscoped compatibility wrapper. Use workspaceEditDocumentVersion
 * with the provider's workspace root.
 */
export function canonicalWorkspaceEditDocumentVersion(
  edit: LanguageServerWorkspaceEdit,
  uri: string,
): CanonicalWorkspaceEditDocumentVersion {
  const root = localWorkspaceRoot();

  if (!root) {
    return { kind: "conflict" };
  }

  return workspaceEditDocumentVersion(root, edit, uri);
}

export function workspaceEditDocumentVersion(
  root: WorkspaceRootDescriptor,
  edit: LanguageServerWorkspaceEdit,
  uri: string,
): CanonicalWorkspaceEditDocumentVersion {
  const path = workspaceEditDocument(root, uri);

  if (!path) {
    return { kind: "conflict" };
  }

  const versions = Object.entries(edit.documentVersions ?? {}).flatMap(
    ([versionUri, version]) => {
      if (typeof version !== "number") {
        return [];
      }

      const versionPath = workspaceEditDocument(root, versionUri);

      return versionPath?.key === path.key ? [version] : [];
    },
  );

  if (versions.length === 0) {
    return { kind: "unversioned" };
  }

  const uniqueVersions = new Set(versions);

  if (uniqueVersions.size !== 1) {
    return { kind: "conflict" };
  }

  return { kind: "versioned", version: versions[0] };
}

function localWorkspaceEditDocument(pathOrUri: string): WorkspacePath | null {
  const root = localWorkspaceRoot();

  return root ? workspaceEditDocument(root, pathOrUri) : null;
}

function localWorkspaceRoot(): WorkspaceRootDescriptor | null {
  const root = createWorkspaceRootFromPath("/");

  return root.ok ? root.value : null;
}

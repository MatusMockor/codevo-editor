import {
  pathFromLanguageServerUri,
  type LanguageServerTextEdit,
  type LanguageServerWorkspaceEdit,
} from "./languageServerFeatures";

export function canonicalWorkspaceEditDocumentPath(uri: string): string | null {
  const path = pathFromLanguageServerUri(uri);

  return path ? canonicalWorkspaceEditPath(path) : null;
}

export function canonicalWorkspaceEditPath(path: string): string {
  return path.trim().split("\\").join("/").replace(/\/+$/, "");
}

export function mergeAliasedWorkspaceEditDocumentChanges(
  edit: LanguageServerWorkspaceEdit,
): LanguageServerWorkspaceEdit {
  const changesByPath = new Map<
    string,
    { edits: LanguageServerTextEdit[]; uri: string }
  >();

  for (const [uri, edits] of Object.entries(edit.changes)) {
    const path = canonicalWorkspaceEditDocumentPath(uri);

    if (!path) {
      continue;
    }

    const existing = changesByPath.get(path);

    if (existing) {
      existing.edits.push(...edits);
      continue;
    }

    changesByPath.set(path, { edits: [...edits], uri });
  }

  return {
    ...(edit.fileOperations?.length ? { fileOperations: edit.fileOperations } : {}),
    ...(edit.documentVersions
      ? { documentVersions: edit.documentVersions }
      : {}),
    changes: Object.fromEntries(
      Array.from(changesByPath.values()).map(({ edits, uri }) => [uri, edits]),
    ),
  };
}

export type CanonicalWorkspaceEditDocumentVersion =
  | { kind: "conflict" }
  | { kind: "unversioned" }
  | { kind: "versioned"; version: number };

export function canonicalWorkspaceEditDocumentVersion(
  edit: LanguageServerWorkspaceEdit,
  uri: string,
): CanonicalWorkspaceEditDocumentVersion {
  const path = canonicalWorkspaceEditDocumentPath(uri);

  if (!path) {
    return { kind: "conflict" };
  }

  const versions = Object.entries(edit.documentVersions ?? {}).flatMap(
    ([versionUri, version]) =>
      typeof version === "number" &&
      canonicalWorkspaceEditDocumentPath(versionUri) === path
        ? [version]
        : [],
  );

  if (versions.length === 0) {
    return { kind: "unversioned" };
  }

  const uniqueVersions = new Set(versions);

  return uniqueVersions.size === 1
    ? { kind: "versioned", version: versions[0] }
    : { kind: "conflict" };
}

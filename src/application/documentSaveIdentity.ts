import {
  DEFAULT_WORKSPACE_PATH_POLICY,
  type WorkspacePathPolicy,
} from "../domain/workspacePath";

export interface DocumentSaveIdentity {
  readonly canonicalRoot: string;
  readonly workspaceRelativePath: string;
}

export interface LegacyDocumentSaveOwnership {
  readonly rootPath: string;
  readonly path: string;
}

export type DocumentSaveOwnership =
  | DocumentSaveIdentity
  | LegacyDocumentSaveOwnership;

export type ResolveDocumentSaveOwnership = (
  rootPath: string,
  path: string,
) => DocumentSaveOwnership | null;

export interface DocumentSaveIdentityStrategy {
  create(
    canonicalRoot: string,
    workspaceRelativePath: string,
    policy: WorkspacePathPolicy,
  ): DocumentSaveIdentity | null;
}

/** Builds immutable save ownership values from workspace-authoritative policy. */
export class PolicyNormalizedDocumentSaveIdentityStrategy
  implements DocumentSaveIdentityStrategy
{
  create(
    canonicalRoot: string,
    workspaceRelativePath: string,
    policy: WorkspacePathPolicy,
  ): DocumentSaveIdentity | null {
    const normalizedRoot = normalizeCanonicalRoot(canonicalRoot);
    if (!normalizedRoot) {
      return null;
    }

    const relativeSegments = relativePathSegments(workspaceRelativePath);
    if (!relativeSegments) {
      return null;
    }

    const identitySegments: string[] = [];
    for (const segment of relativeSegments) {
      const normalized = normalizeSegment(segment, policy);
      if (normalized === null) {
        return null;
      }

      identitySegments.push(normalized);
    }

    return Object.freeze({
      canonicalRoot: normalizedRoot,
      workspaceRelativePath: identitySegments.join("/"),
    });
  }
}

export const policyNormalizedDocumentSaveIdentityStrategy =
  new PolicyNormalizedDocumentSaveIdentityStrategy();

export function createDocumentSaveIdentity(
  canonicalRoot: string,
  workspaceRelativePath: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
  strategy: DocumentSaveIdentityStrategy =
    policyNormalizedDocumentSaveIdentityStrategy,
): DocumentSaveIdentity | null {
  return strategy.create(canonicalRoot, workspaceRelativePath, policy);
}

/** Resolves selected I/O paths at the boundary and returns canonical ownership. */
export function documentSaveIdentityFromSelectedPath(
  canonicalRoot: string,
  selectedRoot: string,
  selectedPath: string,
  policy: WorkspacePathPolicy = DEFAULT_WORKSPACE_PATH_POLICY,
): DocumentSaveIdentity | null {
  const root = lexicalAbsolutePath(selectedRoot);
  const candidate = lexicalAbsolutePath(selectedPath);
  if (!root || !candidate || root.flavor !== candidate.flavor) {
    return null;
  }
  if (
    root.flavor === "windows" &&
    !segmentsEqual([root.anchor], [candidate.anchor], policy)
  ) {
    return null;
  }
  if (candidate.segments.length <= root.segments.length) {
    return null;
  }
  if (
    !segmentsEqual(
      root.segments,
      candidate.segments.slice(0, root.segments.length),
      policy,
    )
  ) {
    return null;
  }

  return createDocumentSaveIdentity(
    canonicalRoot,
    candidate.segments.slice(root.segments.length).join("/"),
    policy,
  );
}

/**
 * Compatibility adapter for callers that only have lexical root and file paths.
 * It deliberately cannot infer aliases; canonical callers must use the value
 * object above with a relative path derived from their selected workspace root.
 */
export function legacyDocumentSaveIdentity(
  rootPath: string,
  path: string,
): DocumentSaveIdentity | null {
  return documentSaveIdentityFromSelectedPath(rootPath, rootPath, path);
}

export function documentSaveIdentitySegments(
  identity: DocumentSaveIdentity,
): readonly string[] {
  return identity.workspaceRelativePath.split("/");
}

interface LexicalAbsolutePath {
  readonly anchor: string;
  readonly flavor: "posix" | "windows";
  readonly segments: readonly string[];
}

function normalizeCanonicalRoot(root: string): string | null {
  if (!isSafeString(root)) {
    return null;
  }
  if (!root.startsWith("/") && !/^[A-Za-z]:[\\/]/.test(root)) {
    return null;
  }

  const windows = /^[A-Za-z]:[\\/]/.test(root);
  let end = root.length;
  const minimumLength = windows ? 3 : 1;
  while (
    end > minimumLength &&
    (windows ? isSeparator(root[end - 1]) : root[end - 1] === "/")
  ) {
    end -= 1;
  }

  return root.slice(0, end);
}

function relativePathSegments(path: string): string[] | null {
  if (!isSafeString(path) || !path || path.startsWith("/")) {
    return null;
  }
  if (/^[A-Za-z]:[\\/]/.test(path)) {
    return null;
  }

  const segments = path.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    return null;
  }

  return segments;
}

function normalizeSegment(
  segment: string,
  policy: WorkspacePathPolicy,
): string | null {
  let normalized: string;
  try {
    normalized =
      policy.unicodeNormalization === "none"
        ? segment
        : segment.normalize(policy.unicodeNormalization);
  } catch {
    return null;
  }

  if (!policy.caseSensitive) {
    try {
      normalized = policy.foldCase(normalized);
    } catch {
      return null;
    }
  }

  return isSafeString(normalized) &&
    normalized &&
    normalized !== "." &&
    normalized !== ".." &&
    !normalized.includes("/")
    ? normalized
    : null;
}

function segmentsEqual(
  left: readonly string[],
  right: readonly string[],
  policy: WorkspacePathPolicy,
): boolean {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    const normalizedLeft = normalizeSegment(left[index] ?? "", policy);
    const normalizedRight = normalizeSegment(right[index] ?? "", policy);
    if (
      normalizedLeft === null ||
      normalizedRight === null ||
      normalizedLeft !== normalizedRight
    ) {
      return false;
    }
  }

  return true;
}

function lexicalAbsolutePath(path: string): LexicalAbsolutePath | null {
  if (!isSafeString(path)) {
    return null;
  }

  const windows = /^([A-Za-z]:)[\\/]/.exec(path);
  const flavor = windows ? "windows" : "posix";
  if (!windows && !path.startsWith("/")) {
    return null;
  }

  const anchor = windows ? windows[1] : "/";
  const remainder = windows ? path.slice(windows[0].length) : path.slice(1);
  const segments: string[] = [];
  const segmentsFromPath =
    flavor === "windows" ? remainder.split(/[\\/]/) : remainder.split("/");
  for (const segment of segmentsFromPath) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }

    segments.push(segment);
  }

  return { anchor, flavor, segments };
}

function isSafeString(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    return false;
  }

  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) {
        return false;
      }
      index += 1;
      continue;
    }
    if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }

  return true;
}

function isSeparator(character: string | undefined): boolean {
  return character === "/" || character === "\\";
}

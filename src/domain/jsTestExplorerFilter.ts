import { isWellFormedUnicode } from "./unicodeText";
import { normalizedJsTestRelativeFilePath } from "./jsTestRunScope";
import { joinWorkspacePath } from "./workspace";
import {
  parseWorkspacePath,
  type WorkspacePathKey,
  type WorkspaceRootDescriptor,
} from "./workspacePath";

export const MAX_JS_TEST_EXPLORER_FILTER_BYTES = 4 * 1024;
export const MAX_JS_TEST_EXPLORER_OPENED_FILES = 256;

export type JsTestExplorerStatusFilter = "executed" | "failed";

export interface JsTestExplorerCurrentFileIdentity {
  readonly pathKey: WorkspacePathKey;
  readonly relativeFilePath: string;
  readonly root: WorkspaceRootDescriptor;
}

export interface JsTestExplorerOpenedFilesSnapshot {
  readonly hadEditorResources: boolean;
  readonly identities: readonly JsTestExplorerCurrentFileIdentity[];
  readonly root: WorkspaceRootDescriptor;
  readonly truncated: boolean;
}

export interface JsTestExplorerFilterOptions {
  /**
   * Supplies the active document context used only when the exact `@doc` term is present. A
   * missing or non-canonical workspace-relative identity then fails closed.
   */
  readonly currentFile?: JsTestExplorerCurrentFileIdentity | null;
  /**
   * Supplies the bounded active-workspace editor-resource snapshot used only when the exact
   * `@openedFiles` term is present. The root-bearing status distinguishes no editor resources
   * (whole-tree projection) from resources with no owned identities (empty projection).
   */
  readonly openedFilesSnapshot?: JsTestExplorerOpenedFilesSnapshot | null;
  readonly workspaceId?: string | null;
}

export type JsTestExplorerFilter =
  | {
      readonly currentFile?: JsTestExplorerCurrentFileIdentity;
      readonly kind: "valid";
      readonly openedFilesSnapshot?: Omit<JsTestExplorerOpenedFilesSnapshot, "truncated">;
      readonly statusFilters: readonly JsTestExplorerStatusFilter[];
      readonly textQuery: string;
    }
  | {
      readonly kind: "invalid";
      readonly reason:
        | "current-file-unavailable"
        | "invalid-current-file"
        | "invalid-opened-files"
        | "invalid-unicode"
        | "opened-files-too-many"
        | "opened-files-unavailable"
        | "query-too-large";
    };

const EMPTY_STATUS_FILTERS: readonly JsTestExplorerStatusFilter[] = Object.freeze([]);
const EXECUTED_STATUS_FILTERS: readonly JsTestExplorerStatusFilter[] = Object.freeze(["executed"]);
const FAILED_STATUS_FILTERS: readonly JsTestExplorerStatusFilter[] = Object.freeze(["failed"]);
const TEST_FILTER_TERM = /!?@([^ ,:]+)/gu;

/**
 * Parses status directives without changing test identity, run scope, or failed-run planning.
 * Only exact known directives are reserved. Unknown `@` terms remain ordinary text. This slice
 * matches VS Code's exact `@executed`, `@failed`, `@doc`, and `@openedFiles` term extraction, but
 * deliberately does not model its broader comma glob, tag, exclusion, or fuzzy-filter grammar.
 */
export function parseJsTestExplorerFilter(
  query: string,
  options: JsTestExplorerFilterOptions = {},
): JsTestExplorerFilter {
  if (!isWellFormedUnicode(query)) {
    return invalid("invalid-unicode");
  }
  if (new TextEncoder().encode(query).byteLength > MAX_JS_TEST_EXPLORER_FILTER_BYTES) {
    return invalid("query-too-large");
  }
  let executed = false;
  let failed = false;
  let currentDocument = false;
  let openedDocuments = false;
  const textWithoutDirectives = query.replace(
    TEST_FILTER_TERM,
    (term: string, name: string): string => {
      if (term === "@executed" && name === "executed") {
        executed = true;
        return " ";
      }
      if (term === "@failed" && name === "failed") {
        failed = true;
        return " ";
      }
      if (term === "@doc" && name === "doc") {
        currentDocument = true;
        return " ";
      }
      if (term === "@openedFiles" && name === "openedFiles") {
        openedDocuments = true;
        return " ";
      }
      return term;
    },
  );
  const openedFiles = openedDocuments
    ? openedFilePaths(options)
    : ({ snapshot: null, kind: "valid" } as const);
  if (openedFiles.kind === "invalid") {
    return openedFiles;
  }
  const currentFile =
    currentDocument && !openedDocuments
      ? currentFilePath(options)
      : ({ identity: null, kind: "valid" } as const);
  if (currentFile.kind === "invalid") {
    return currentFile;
  }
  const textQuery = textWithoutDirectives
    .replace(/(^|[\s,])[,]+|[,]+(?=[\s,]|$)/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter(Boolean)
    .join(" ")
    .toLocaleLowerCase();

  return Object.freeze({
    kind: "valid",
    statusFilters: failed
      ? FAILED_STATUS_FILTERS
      : executed
        ? EXECUTED_STATUS_FILTERS
        : EMPTY_STATUS_FILTERS,
    textQuery,
    ...(currentFile.identity === null ? {} : { currentFile: currentFile.identity }),
    ...(openedFiles.snapshot === null ? {} : { openedFilesSnapshot: openedFiles.snapshot }),
  });
}

function currentFilePath(
  options: JsTestExplorerFilterOptions,
):
  | { readonly identity: JsTestExplorerCurrentFileIdentity | null; readonly kind: "valid" }
  | Extract<JsTestExplorerFilter, { kind: "invalid" }> {
  const identity = options.currentFile;
  if (!identity) {
    return invalid("current-file-unavailable");
  }
  return validDocumentIdentity(identity, options.workspaceId)
    ? { identity, kind: "valid" }
    : invalid("invalid-current-file");
}

function openedFilePaths(options: JsTestExplorerFilterOptions):
  | {
      readonly snapshot: Omit<JsTestExplorerOpenedFilesSnapshot, "truncated"> | null;
      readonly kind: "valid";
    }
  | Extract<JsTestExplorerFilter, { kind: "invalid" }> {
  const snapshot = options.openedFilesSnapshot;
  if (!snapshot || typeof snapshot !== "object") {
    return invalid("opened-files-unavailable");
  }
  if (
    typeof snapshot.hadEditorResources !== "boolean" ||
    !Array.isArray(snapshot.identities) ||
    typeof snapshot.truncated !== "boolean" ||
    !validOpenedFilesRoot(snapshot.root, options.workspaceId)
  ) {
    return invalid("invalid-opened-files");
  }
  if (snapshot.truncated) {
    return invalid("opened-files-too-many");
  }
  const identities = snapshot.identities;
  if (identities.length > MAX_JS_TEST_EXPLORER_OPENED_FILES) {
    return invalid("opened-files-too-many");
  }
  if (!snapshot.hadEditorResources && identities.length > 0) {
    return invalid("invalid-opened-files");
  }

  const identitiesByKey = new Map<WorkspacePathKey, JsTestExplorerCurrentFileIdentity>();
  for (const identity of identities) {
    if (
      !validDocumentIdentity(identity, options.workspaceId) ||
      !documentIdentityBelongsToRoot(identity, snapshot.root)
    ) {
      return invalid("invalid-opened-files");
    }
    const previous = identitiesByKey.get(identity.pathKey);
    if (!previous || compareText(identity.relativeFilePath, previous.relativeFilePath) < 0) {
      identitiesByKey.set(
        identity.pathKey,
        Object.freeze({
          pathKey: identity.pathKey,
          relativeFilePath: identity.relativeFilePath,
          root: identity.root,
        }),
      );
    }
  }
  return {
    snapshot: Object.freeze({
      hadEditorResources: snapshot.hadEditorResources,
      identities: Object.freeze(
        [...identitiesByKey.values()].sort(
          (left, right) =>
            compareText(left.relativeFilePath, right.relativeFilePath) ||
            compareText(left.pathKey, right.pathKey),
        ),
      ),
      root: snapshot.root,
    }),
    kind: "valid",
  };
}

function validOpenedFilesRoot(
  root: WorkspaceRootDescriptor,
  workspaceId: string | null | undefined,
): boolean {
  if (
    !root ||
    typeof root !== "object" ||
    typeof root.nativePath !== "string" ||
    typeof workspaceId !== "string" ||
    root.workspaceId !== workspaceId
  ) {
    return false;
  }
  try {
    const parsed = parseWorkspacePath(root, root.nativePath);
    return parsed.ok && parsed.value.relativePath === "";
  } catch {
    return false;
  }
}

function documentIdentityBelongsToRoot(
  identity: JsTestExplorerCurrentFileIdentity,
  root: WorkspaceRootDescriptor,
): boolean {
  if (
    identity.root.workspaceId !== root.workspaceId ||
    identity.root.nativePath !== root.nativePath ||
    identity.root.flavor !== root.flavor ||
    identity.root.anchor !== root.anchor
  ) {
    return false;
  }
  try {
    const parsed = parseWorkspacePath(
      root,
      joinWorkspacePath(root.nativePath, identity.relativeFilePath),
    );
    return parsed.ok && parsed.value.key === identity.pathKey;
  } catch {
    return false;
  }
}

function validDocumentIdentity(
  identity: JsTestExplorerCurrentFileIdentity,
  workspaceId: string | null | undefined,
): boolean {
  if (!identity || typeof identity !== "object") return false;
  const path = identity.relativeFilePath;
  if (
    typeof path !== "string" ||
    !isWellFormedUnicode(path) ||
    typeof identity.pathKey !== "string" ||
    !identity.root ||
    typeof identity.root.nativePath !== "string" ||
    typeof workspaceId !== "string" ||
    workspaceId !== identity.root.workspaceId
  ) {
    return false;
  }
  try {
    const normalized = normalizedJsTestRelativeFilePath(path);
    if (normalized !== path) return false;
    const parsed = parseWorkspacePath(
      identity.root,
      joinWorkspacePath(identity.root.nativePath, normalized),
    );
    return parsed.ok && parsed.value.key === identity.pathKey;
  } catch {
    return false;
  }
}

function invalid(reason: Extract<JsTestExplorerFilter, { kind: "invalid" }>["reason"]) {
  return Object.freeze({ kind: "invalid", reason } as const);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

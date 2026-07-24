import type {
  LanguageServerTextEdit,
  LanguageServerWorkspaceEdit,
} from "../domain/languageServerFeatures";
import type { NeonCrossFileRenamePlan } from "./neonCrossFileSymbolSweep";
import {
  commitTemplateWorkspaceRenameOpenModels,
  type TemplateWorkspaceRenameDocumentSnapshot,
  type TemplateWorkspaceRenameOpenModel,
  type TemplateWorkspaceRenameStagedDocument,
} from "./templateWorkspaceRenameTransaction";
import type {
  WorkspaceEditApplicationContext,
  WorkspaceEditApplicationDecision,
  WorkspaceEditOpenModelCommitResult,
} from "./workspaceEditApplication";

type ReadyNeonCrossFileRenamePlan = Extract<NeonCrossFileRenamePlan, { kind: "ready" }>;

export interface NeonWorkspaceRenameOpenDocumentCapture {
  readonly content: string;
  readonly model: TemplateWorkspaceRenameOpenModel;
  readonly path: string;
  readonly uri: string;
  readonly versionId: number;
}

export interface NeonWorkspaceRenameCapture {
  readonly activePath: string;
  readonly activeUri: string;
  readonly activeVersionId: number;
  readonly closedFileHashes: Readonly<Record<string, string | null>>;
  readonly generation: number;
  readonly openDocuments: readonly NeonWorkspaceRenameOpenDocumentCapture[];
  readonly rootPath: string;
  readonly workspaceOwnerKey: string;
  isCurrent(): boolean;
  isTrusted(): boolean;
}

export type NeonWorkspaceEditApplier = (
  edit: LanguageServerWorkspaceEdit,
  context: WorkspaceEditApplicationContext,
) => Promise<WorkspaceEditApplicationDecision>;

export interface NeonWorkspaceRenameRequest {
  readonly applyWorkspaceEdit?: NeonWorkspaceEditApplier;
  readonly capture: NeonWorkspaceRenameCapture;
  readonly plan: ReadyNeonCrossFileRenamePlan;
  readonly signal?: AbortSignal;
  toFileUri(path: string): string;
}

export type NeonWorkspaceRenameResult =
  | { readonly kind: "accepted" }
  | {
      readonly kind: "rejected";
      readonly reason:
        | "applicationRejected"
        | "busy"
        | "cancelled"
        | "invalidCapture"
        | "staleCapture"
        | "untrustedWorkspace"
        | "workspaceEditUnavailable";
    };

export interface NeonWorkspaceRenameService {
  cancel(rootPath: string): boolean;
  rename(request: NeonWorkspaceRenameRequest): Promise<NeonWorkspaceRenameResult>;
}

interface PendingRename {
  cancelled: boolean;
}

/** Owner-fenced, per-root single-flight adapter over the shared workspace-edit transaction. */
export function createNeonWorkspaceRenameService(): NeonWorkspaceRenameService {
  const pending = new Map<string, PendingRename>();
  return {
    cancel(rootPath) {
      const key = serviceRootKey(rootPath);
      if (!key) return false;
      const operation = pending.get(key);
      if (!operation) return false;
      operation.cancelled = true;
      return true;
    },
    rename(request) {
      const key = serviceRootKey(request.capture.rootPath);
      if (!key) return Promise.resolve(rejected("invalidCapture"));
      if (pending.has(key)) return Promise.resolve(rejected("busy"));
      const operation: PendingRename = { cancelled: false };
      pending.set(key, operation);
      const run = applyNeonWorkspaceRename(request, () => operation.cancelled).finally(() => {
        if (pending.get(key) === operation) pending.delete(key);
      });
      return run;
    },
  };
}

async function applyNeonWorkspaceRename(
  request: NeonWorkspaceRenameRequest,
  cancelledByService: () => boolean,
): Promise<NeonWorkspaceRenameResult> {
  if (!request.applyWorkspaceEdit) return rejected("workspaceEditUnavailable");
  let prepared: PreparedTransaction;
  try {
    prepared = prepareTransaction(request);
  } catch {
    return rejected("invalidCapture");
  }
  if (prepared.kind === "rejected") return prepared;
  const isCancelled = () => cancelledByService() || safelyAborted(request.signal);
  const captureState = () => validateLiveCapture(request, prepared, isCancelled);
  const beforeApply = captureState();
  if (beforeApply) return rejected(beforeApply);

  let commit: WorkspaceEditOpenModelCommitResult | undefined;
  const applyOpenModels = (): WorkspaceEditOpenModelCommitResult => {
    const drift = captureState();
    if (drift) return invalidOpenModels(request.capture.activePath);
    if (!commit) commit = commitTemplateWorkspaceRenameOpenModels(prepared.staged);
    return commit;
  };
  try {
    const decision = await request.applyWorkspaceEdit(prepared.edit, {
      applyOpenModels,
      expectedClosedFileHashes: prepared.closedFileHashes,
      openPaths: prepared.staged.map(({ path }) => path),
      requiresAtomicFinalization:
        prepared.touchedPaths.length > 1 || prepared.closedPaths.length > 0,
      rootPath: request.capture.rootPath,
    });
    if (decision.kind === "accepted") {
      if (!commit || commit.kind === "rejected") {
        rollback(commit);
        return rejected("applicationRejected");
      }
      const finalized = commit.finalize?.() ?? commit;
      if (finalized.kind === "rejected") {
        rollback(commit);
        return rejected("applicationRejected");
      }
      return { kind: "accepted" };
    }
    rollback(commit);
    return rejected(isCancelled() ? "cancelled" : "applicationRejected");
  } catch {
    rollback(commit);
    return rejected(isCancelled() ? "cancelled" : "applicationRejected");
  }
}

type PreparedTransaction =
  | {
      readonly closedFileHashes: Readonly<Record<string, string | null>>;
      readonly closedPaths: readonly string[];
      readonly capturedOpen: readonly NeonWorkspaceRenameOpenDocumentCapture[];
      readonly edit: LanguageServerWorkspaceEdit;
      readonly kind: "ready";
      readonly staged: readonly TemplateWorkspaceRenameStagedDocument[];
      readonly touchedPaths: readonly string[];
    }
  | Extract<NeonWorkspaceRenameResult, { kind: "rejected" }>;

function prepareTransaction(request: NeonWorkspaceRenameRequest): PreparedTransaction {
  const { capture, plan } = request;
  const rootPath = normalizeAbsolutePath(capture.rootPath);
  const planRootPath = normalizeAbsolutePath(plan.rootPath);
  const captureRootPath = rootPath ? canonicalPlanPath(capture.rootPath, rootPath) : null;
  const activePath = rootPath ? canonicalPlanPath(capture.activePath, rootPath) : null;
  const planActivePath = rootPath ? canonicalPlanPath(plan.activePath, rootPath) : null;
  if (
    !rootPath ||
    !captureRootPath ||
    !planRootPath ||
    !pathsEqual(rootPath, planRootPath) ||
    !activePath ||
    !planActivePath ||
    !pathsEqual(activePath, planActivePath) ||
    typeof capture.workspaceOwnerKey !== "string" ||
    !capture.workspaceOwnerKey ||
    !Number.isSafeInteger(capture.generation) ||
    capture.generation < 0 ||
    !Number.isSafeInteger(capture.activeVersionId) ||
    capture.activeVersionId < 0
  ) {
    return rejected("invalidCapture");
  }
  const documents = new Map<string, string>();
  for (const document of plan.documents) {
    const path = canonicalPlanPath(document.path, rootPath);
    if (
      !path ||
      hasEquivalentPath(documents.keys(), path) ||
      typeof document.source !== "string"
    ) {
      return rejected("invalidCapture");
    }
    documents.set(path, document.source);
  }
  if (documents.size === 0 || !documents.has(planActivePath) || plan.edits.length === 0) {
    return rejected("invalidCapture");
  }
  const grouped = new Map<string, typeof plan.edits>();
  for (const edit of plan.edits) {
    const path = canonicalPlanPath(edit.path, rootPath);
    if (
      !path ||
      !documents.has(path) ||
      typeof edit.newText !== "string" ||
      !validSpan(edit.span)
    ) {
      return rejected("invalidCapture");
    }
    grouped.set(path, [...(grouped.get(path) ?? []), edit]);
  }
  const activeEdits = grouped.get(planActivePath);
  if (
    !validSpan(plan.selectedSpan) ||
    !activeEdits?.some(
      ({ span }) =>
        span.start === plan.selectedSpan.start && span.end === plan.selectedSpan.end,
    )
  ) {
    return rejected("invalidCapture");
  }
  const touchedPaths = [...grouped.keys()].sort(compareText);
  const open = new Map<string, NeonWorkspaceRenameOpenDocumentCapture>();
  for (const document of capture.openDocuments) {
    const path = canonicalPlanPath(document.path, rootPath);
    if (
      !path ||
      hasEquivalentPath(open.keys(), path) ||
      typeof document.content !== "string" ||
      typeof document.uri !== "string" ||
      !Number.isSafeInteger(document.versionId) ||
      document.versionId < 0 ||
      documents.get(path) !== document.content
    ) {
      return rejected("invalidCapture");
    }
    open.set(path, document);
  }
  const uriByPath = resolveUniqueUris(
    request.toFileUri,
    new Set([...touchedPaths, ...open.keys(), activePath]),
  );
  if (!uriByPath) return rejected("invalidCapture");
  const active = open.get(activePath);
  if (
    !active ||
    active.uri !== capture.activeUri ||
    active.versionId !== capture.activeVersionId ||
    uriByPath.get(activePath) !== capture.activeUri
  ) {
    return rejected("invalidCapture");
  }

  const changes: Record<string, LanguageServerTextEdit[]> = {};
  const documentVersions: Record<string, number | null> = {};
  const staged: TemplateWorkspaceRenameStagedDocument[] = [];
  const closedPaths: string[] = [];
  const closedFileHashes: Record<string, string | null> = {};
  for (const path of touchedPaths) {
    const source = documents.get(path);
    const edits = grouped.get(path);
    const uri = uriByPath.get(path);
    if (source === undefined || !edits || !uri) return rejected("invalidCapture");
    const nextContent = applyOffsetEdits(source, edits);
    if (nextContent === null) return rejected("invalidCapture");
    changes[uri] = [...edits]
      .sort((left, right) => right.span.start - left.span.start)
      .map(({ newText, span }) => ({
        newText,
        range: { end: positionAt(source, span.end), start: positionAt(source, span.start) },
      }));
    const openDocument = open.get(path);
    if (openDocument) {
      if (openDocument.content !== source || openDocument.uri !== uri) {
        return rejected("invalidCapture");
      }
      documentVersions[uri] = openDocument.versionId;
      staged.push({
        model: openDocument.model,
        nextContent,
        original: { content: openDocument.content, versionId: openDocument.versionId },
        path,
      });
    } else {
      if (!Object.prototype.hasOwnProperty.call(capture.closedFileHashes, uri)) {
        return rejected("invalidCapture");
      }
      const closedHash = capture.closedFileHashes[uri];
      if (closedHash !== null && typeof closedHash !== "string") {
        return rejected("invalidCapture");
      }
      documentVersions[uri] = null;
      closedPaths.push(path);
      closedFileHashes[uri] = closedHash;
    }
  }
  return {
    closedFileHashes: Object.freeze(closedFileHashes),
    closedPaths: Object.freeze(closedPaths),
    capturedOpen: Object.freeze([...open.values()]),
    edit: { changes, documentVersions },
    kind: "ready",
    staged: Object.freeze(staged),
    touchedPaths: Object.freeze(touchedPaths),
  };
}

function validateLiveCapture(
  request: NeonWorkspaceRenameRequest,
  prepared: Extract<PreparedTransaction, { kind: "ready" }>,
  isCancelled: () => boolean,
): Extract<NeonWorkspaceRenameResult, { kind: "rejected" }>["reason"] | null {
  if (isCancelled()) return "cancelled";
  if (!safeBoolean(request.capture.isTrusted)) return "untrustedWorkspace";
  if (!safeBoolean(request.capture.isCurrent)) return "staleCapture";
  for (const document of prepared.capturedOpen) {
    if (
      !safeModelSnapshotMatches(document.model, {
        content: document.content,
        versionId: document.versionId,
      })
    ) {
      return "staleCapture";
    }
  }
  for (const entry of prepared.staged) {
    if (!safeModelSnapshotMatches(entry.model, entry.original)) return "staleCapture";
  }
  return null;
}

function applyOffsetEdits(
  source: string,
  edits: ReadyNeonCrossFileRenamePlan["edits"],
): string | null {
  let result = source;
  let previousStart = source.length + 1;
  for (const edit of [...edits].sort((left, right) => right.span.start - left.span.start)) {
    if (
      edit.span.start < 0 ||
      edit.span.end < edit.span.start ||
      edit.span.end > source.length ||
      edit.span.end > previousStart
    ) {
      return null;
    }
    result = `${result.slice(0, edit.span.start)}${edit.newText}${result.slice(edit.span.end)}`;
    previousStart = edit.span.start;
  }
  return result;
}

function validSpan(span: { readonly end: number; readonly start: number }): boolean {
  return (
    Number.isSafeInteger(span.start) &&
    Number.isSafeInteger(span.end) &&
    span.start >= 0 &&
    span.end > span.start
  );
}

function positionAt(source: string, offset: number): { character: number; line: number } {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;
  return { character: offset - lineStart, line: before.split("\n").length - 1 };
}

function rollback(commit: WorkspaceEditOpenModelCommitResult | undefined): void {
  if (commit?.kind !== "applied") return;
  try {
    commit.rollback?.();
  } catch {
    // Rollback is best-effort and exact-state fenced by the model transaction.
  }
}

function invalidOpenModels(path: string): WorkspaceEditOpenModelCommitResult {
  return { kind: "rejected", path, reason: "invalidOpenModelEdits" };
}

function rejected(
  reason: Extract<NeonWorkspaceRenameResult, { kind: "rejected" }>["reason"],
): Extract<NeonWorkspaceRenameResult, { kind: "rejected" }> {
  return Object.freeze({ kind: "rejected", reason });
}

function snapshotsEqual(
  left: TemplateWorkspaceRenameDocumentSnapshot | null,
  right: TemplateWorkspaceRenameDocumentSnapshot,
): boolean {
  return left?.content === right.content && left.versionId === right.versionId;
}

function safeModelSnapshotMatches(
  model: TemplateWorkspaceRenameOpenModel,
  expected: TemplateWorkspaceRenameDocumentSnapshot,
): boolean {
  try {
    return snapshotsEqual(model.read(), expected);
  } catch {
    return false;
  }
}

function safeBoolean(check: () => boolean): boolean {
  try {
    return check() === true;
  } catch {
    return false;
  }
}

function safelyAborted(signal: AbortSignal | undefined): boolean {
  try {
    return signal?.aborted === true;
  } catch {
    return true;
  }
}

function resolveUniqueUris(
  toFileUri: (path: string) => string,
  paths: ReadonlySet<string>,
): Map<string, string> | null {
  const uriByPath = new Map<string, string>();
  const pathByUri = new Map<string, string>();
  for (const path of paths) {
    let uri: string;
    try {
      uri = toFileUri(path);
    } catch {
      return null;
    }
    if (
      typeof uri !== "string" ||
      !isLocalFileUri(uri) ||
      (pathByUri.has(uri) && pathByUri.get(uri) !== path)
    ) {
      return null;
    }
    uriByPath.set(path, uri);
    pathByUri.set(uri, path);
  }
  return uriByPath;
}

function isLocalFileUri(uri: string): boolean {
  return (
    /^file:\/\/(?:\/|localhost\/)/iu.test(uri) &&
    !uri.includes("?") &&
    !uri.includes("#") &&
    !uri.includes("\\") &&
    !/%2f/iu.test(uri)
  );
}

function canonicalPlanPath(path: string, rootPath: string): string | null {
  const normalized = containedPath(path, rootPath);
  if (!normalized) return null;
  const rawSlashPath = path.split("\\").join("/");
  const slashPath =
    rawSlashPath === "/"
      ? "/"
      : /^[A-Za-z]:\/+$/u.test(rawSlashPath)
        ? `${rawSlashPath.slice(0, 2)}/`
        : rawSlashPath.replace(/\/+$/, "");
  return pathsEqual(slashPath, normalized) ? normalized : null;
}

function containedPath(path: string, rootPath: string | null): string | null {
  const normalized = normalizeAbsolutePath(path);
  if (!normalized || !rootPath) return null;
  const candidate = comparisonPath(normalized);
  const root = comparisonPath(rootPath).replace(/\/+$/, "");
  return candidate === root || candidate.startsWith(`${root}/`) ? normalized : null;
}

function normalizeAbsolutePath(path: string): string | null {
  if (path.startsWith("\\\\") || path.startsWith("//")) return null;
  const value = path.split("\\").join("/");
  const drive = /^([A-Za-z]:)(?:\/|$)/.exec(value)?.[1] ?? null;
  if (!value.startsWith("/") && !drive) return null;
  const body = drive ? value.slice(drive.length) : value;
  const segments: string[] = [];
  for (const segment of body.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return `${drive ?? ""}/${segments.join("/")}`.replace(/\/$/, segments.length === 0 ? "/" : "");
}

function pathsEqual(left: string, right: string): boolean {
  return comparisonPath(left) === comparisonPath(right);
}

function comparisonPath(path: string): string {
  return /^[A-Za-z]:\//.test(path) ? path.toLocaleLowerCase("en-US") : path;
}

function serviceRootKey(rootPath: string): string | null {
  try {
    const normalized = normalizeAbsolutePath(rootPath);
    return normalized ? comparisonPath(normalized) : null;
  } catch {
    return null;
  }
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function hasEquivalentPath(paths: Iterable<string>, candidate: string): boolean {
  for (const path of paths) {
    if (pathsEqual(path, candidate)) return true;
  }
  return false;
}

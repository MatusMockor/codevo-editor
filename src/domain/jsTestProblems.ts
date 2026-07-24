import type { JsTestRunScope } from "./jsTestRunScope";
import {
  MAX_JS_TEST_SCOPE_FULL_NAME_BYTES,
  normalizedJsTestRelativeFilePath,
  validatedJsTestRunScope,
} from "./jsTestRunScope";
import type { TestCase, TestRunResponse, TestSuite } from "./testResults";
import { isWellFormedUnicode } from "./unicodeText";
import { createWorkbenchNotice, type WorkbenchNotice } from "./workbenchNotice";
import { joinWorkspacePath, workspaceRelativePath } from "./workspace";

export const MAX_JS_TEST_PROBLEM_CASES = 5_000;
export const MAX_JS_TEST_PROBLEM_ENTRIES = 5_000;
export const MAX_JS_TEST_PROBLEM_NAME_BYTES = MAX_JS_TEST_SCOPE_FULL_NAME_BYTES;
export const MAX_JS_TEST_PROBLEM_MESSAGE_BYTES = 4_096;
export const MAX_JS_TEST_PROBLEM_TEXT_BYTES = 1024 * 1024;
export const MAX_JS_TEST_PROBLEM_OWNER_BYTES = 1_024;
export const MAX_JS_TEST_PROBLEM_ROOT_KEY_BYTES = 4_096;
export const MAX_JS_TEST_PROBLEM_NOTICES = 1_000;
export const JS_TEST_PROBLEM_GROUP_PREFIX = "js-test-problems:";

export interface JsTestProblemsOwner {
  readonly workspaceId: string;
  readonly rootKey: string;
}

export interface JsTestProblemEntry {
  readonly filePath: string;
  readonly lineNumber: number;
  readonly message: string;
  readonly name: string | null;
  readonly status: "failed" | "error";
}

export interface JsTestProblemsSnapshot {
  readonly owner: JsTestProblemsOwner;
  readonly generation: number;
  readonly entries: readonly JsTestProblemEntry[];
  /** Number of unique, accepted problems represented by this snapshot before display caps. */
  readonly total: number;
  /** True when caps forced omissions or a scoped run replaced an incomplete prior ledger. */
  readonly truncated: boolean;
}

export interface JsTestProblemsUpdate {
  readonly generation: number;
  readonly owner: JsTestProblemsOwner;
  readonly response: TestRunResponse;
  readonly scope: JsTestRunScope;
}

export interface JsTestProblemsLimits {
  readonly maxCases?: number;
  readonly maxEntries?: number;
  readonly maxMessageBytes?: number;
  readonly maxNameBytes?: number;
  readonly maxTextBytes?: number;
}

interface ResolvedLimits {
  readonly maxCases: number;
  readonly maxEntries: number;
  readonly maxMessageBytes: number;
  readonly maxNameBytes: number;
  readonly maxTextBytes: number;
}

interface CollectedProblems {
  readonly entries: readonly JsTestProblemEntry[];
  readonly total: number;
  readonly truncated: boolean;
}

const unsafeTextPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/gu;
const unsafePathPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const normalizingDecoder = new TextDecoder();

/** Validates and canonicalizes the exact workspace owner used by test problem snapshots. */
export function validatedJsTestProblemsOwner(owner: JsTestProblemsOwner): JsTestProblemsOwner {
  if (
    !isSafeIdentity(owner.workspaceId) ||
    utf8ByteLength(owner.workspaceId) > MAX_JS_TEST_PROBLEM_OWNER_BYTES
  ) {
    throw new TypeError("JavaScript test problem workspaceId is invalid.");
  }
  if (
    !isSafeIdentity(owner.rootKey) ||
    utf8ByteLength(owner.rootKey) > MAX_JS_TEST_PROBLEM_ROOT_KEY_BYTES
  ) {
    throw new TypeError("JavaScript test problem rootKey is invalid.");
  }
  const rawRoot = owner.rootKey.trim().split("\\").join("/");
  const normalized =
    rawRoot === "/" || /^[A-Za-z]:\/$/.test(rawRoot) ? rawRoot : rawRoot.replace(/\/+$/, "");
  const rootPrefixLength = /^[A-Za-z]:\//.test(normalized) ? 3 : normalized.startsWith("/") ? 1 : 0;
  const segments = normalized.slice(rootPrefixLength).split("/");
  if (
    rootPrefixLength === 0 ||
    normalized.length < rootPrefixLength ||
    segments.some(
      (segment) =>
        segment === "." ||
        segment === ".." ||
        (segment === "" && normalized.length > rootPrefixLength),
    )
  ) {
    throw new TypeError("JavaScript test problem rootKey must be a canonical absolute path.");
  }
  return Object.freeze({ workspaceId: owner.workspaceId, rootKey: normalized });
}

export function emptyJsTestProblemsSnapshot(owner: JsTestProblemsOwner): JsTestProblemsSnapshot {
  return frozenSnapshot(validatedJsTestProblemsOwner(owner), 0, [], 0, false);
}

/**
 * Applies one completed run without allowing stale or cross-workspace failures to survive.
 * Failed/unavailable runs never change a current owner's ledger. A scoped run against an
 * incomplete ledger resets to that scope because hidden entries cannot be merged truthfully.
 */
export function mergeJsTestProblemsSnapshot(
  previous: JsTestProblemsSnapshot | null,
  update: JsTestProblemsUpdate,
  limits: JsTestProblemsLimits = {},
): JsTestProblemsSnapshot {
  const owner = validatedJsTestProblemsOwner(update.owner);
  const current =
    previous && jsTestProblemsOwnersEqual(previous.owner, owner)
      ? previous
      : emptyJsTestProblemsSnapshot(owner);
  if (!Number.isSafeInteger(update.generation) || update.generation <= 0) {
    throw new TypeError("JavaScript test problem generation must be a positive safe integer.");
  }
  if (update.generation <= current.generation || update.response.status !== "ok") return current;

  const scope = validatedJsTestRunScope(update.scope);
  const resolvedLimits = resolveLimits(limits);
  const resetIncompleteScope = current.truncated && scope.kind !== "all";
  const retained =
    scope.kind === "all" || resetIncompleteScope
      ? []
      : current.entries.filter((entry) => !problemMatchesScope(entry, scope));
  const collected = collectProblems(update.response.suites, owner, scope, resolvedLimits);
  const merged = boundedMerge(retained, collected.entries, resolvedLimits);
  const total = retained.length + collected.total;
  return frozenSnapshot(
    owner,
    update.generation,
    merged.entries,
    total,
    collected.truncated ||
      merged.truncated ||
      total > merged.entries.length ||
      resetIncompleteScope,
  );
}

export function jsTestProblemsOwnersEqual(
  left: JsTestProblemsOwner,
  right: JsTestProblemsOwner,
): boolean {
  return left.workspaceId === right.workspaceId && left.rootKey === right.rootKey;
}

export function jsTestProblemMatchesScope(
  entry: JsTestProblemEntry,
  scope: JsTestRunScope,
): boolean {
  return problemMatchesScope(entry, validatedJsTestRunScope(scope));
}

export function jsTestProblemGroupKey(owner: JsTestProblemsOwner): string {
  const validated = validatedJsTestProblemsOwner(owner);
  return `${JS_TEST_PROBLEM_GROUP_PREFIX}${encodeURIComponent(validated.workspaceId)}:${encodeURIComponent(validated.rootKey)}`;
}

/** Projects one owner-scoped ledger into a bounded, navigable Problems view. */
export function jsTestProblemSnapshotToNotices(
  snapshot: JsTestProblemsSnapshot,
  workspaceRoot: string,
): WorkbenchNotice[] {
  let activeOwner: JsTestProblemsOwner;
  try {
    activeOwner = validatedJsTestProblemsOwner({
      rootKey: workspaceRoot,
      workspaceId: snapshot.owner.workspaceId,
    });
  } catch {
    return [];
  }
  if (!jsTestProblemsOwnersEqual(activeOwner, snapshot.owner)) return [];

  const groupKey = jsTestProblemGroupKey(snapshot.owner);
  const hasOverflow =
    snapshot.truncated ||
    snapshot.entries.length > MAX_JS_TEST_PROBLEM_NOTICES ||
    snapshot.total > MAX_JS_TEST_PROBLEM_NOTICES;
  const entryLimit = hasOverflow ? MAX_JS_TEST_PROBLEM_NOTICES - 1 : MAX_JS_TEST_PROBLEM_NOTICES;
  const notices = snapshot.entries.slice(0, entryLimit).flatMap((entry) => {
    let relativePath: string;
    try {
      relativePath = normalizedJsTestRelativeFilePath(entry.filePath);
    } catch {
      return [];
    }
    if (
      relativePath !== entry.filePath ||
      !Number.isSafeInteger(entry.lineNumber) ||
      entry.lineNumber <= 0
    ) {
      return [];
    }
    const path = joinWorkspacePath(activeOwner.rootKey, relativePath);
    if (workspaceRelativePath(activeOwner.rootKey, path) !== relativePath) return [];
    const position = { column: 1, lineNumber: entry.lineNumber };
    return [
      createWorkbenchNotice(
        "error",
        "JavaScript Tests",
        entry.name ? `${entry.name}: ${entry.message}` : entry.message,
        groupKey,
        { path, range: { end: position, start: position } },
      ),
    ];
  });

  if (hasOverflow) {
    notices.push(
      createWorkbenchNotice(
        "info",
        "JavaScript Tests",
        jsTestProblemOverflowMessage(snapshot, notices.length),
        groupKey,
        undefined,
        "overflow",
      ),
    );
  }
  return notices;
}

function collectProblems(
  suites: readonly TestSuite[],
  owner: JsTestProblemsOwner,
  scope: JsTestRunScope,
  limits: ResolvedLimits,
): CollectedProblems {
  const entries: JsTestProblemEntry[] = [];
  const identities = new Set<string>();
  let total = 0;
  let textBytes = 0;
  let totalCases = 0;
  for (const suite of suites) {
    totalCases = Math.min(limits.maxCases + 1, totalCases + suite.cases.length);
  }
  let examinedCases = 0;
  let truncated = totalCases > limits.maxCases;

  collect: for (const suite of suites) {
    for (const testCase of suite.cases) {
      if (examinedCases === limits.maxCases) break collect;
      examinedCases += 1;
      const entry = problemEntry(testCase, owner, limits);
      if (!entry || !problemMatchesScope(entry, scope)) continue;
      const identity = problemIdentity(entry);
      if (identities.has(identity)) continue;
      identities.add(identity);
      total += 1;
      const entryBytes = problemTextBytes(entry);
      if (entries.length >= limits.maxEntries || textBytes + entryBytes > limits.maxTextBytes) {
        truncated = true;
        continue;
      }
      entries.push(entry);
      textBytes += entryBytes;
    }
  }
  return { entries: Object.freeze(entries), total, truncated };
}

function boundedMerge(
  retained: readonly JsTestProblemEntry[],
  incoming: readonly JsTestProblemEntry[],
  limits: ResolvedLimits,
): CollectedProblems {
  const entries: JsTestProblemEntry[] = [];
  const identities = new Set<string>();
  let textBytes = 0;
  let total = 0;
  let truncated = false;
  for (const entry of [...retained, ...incoming]) {
    const identity = problemIdentity(entry);
    if (identities.has(identity)) continue;
    identities.add(identity);
    total += 1;
    const entryBytes = problemTextBytes(entry);
    if (entries.length >= limits.maxEntries || textBytes + entryBytes > limits.maxTextBytes) {
      truncated = true;
      continue;
    }
    entries.push(entry);
    textBytes += entryBytes;
  }
  return { entries: Object.freeze(entries), total, truncated };
}

function problemEntry(
  testCase: TestCase,
  owner: JsTestProblemsOwner,
  limits: ResolvedLimits,
): JsTestProblemEntry | null {
  if (testCase.status !== "failed" && testCase.status !== "error") return null;
  const filePath = normalizedProblemPath(testCase.file, owner.rootKey);
  if (!filePath) return null;
  const name = testCase.name
    ? truncateUtf8(sanitizeText(testCase.name), limits.maxNameBytes)
    : null;
  const fallback = testCase.status === "error" ? "Test errored." : "Test failed.";
  const normalizedMessage = sanitizeText(testCase.message ?? "").trim() || fallback;
  return Object.freeze({
    filePath,
    lineNumber:
      Number.isSafeInteger(testCase.line) && (testCase.line ?? 0) > 0 ? testCase.line! : 1,
    message: truncateUtf8(normalizedMessage, limits.maxMessageBytes),
    name: name || null,
    status: testCase.status,
  });
}

function normalizedProblemPath(file: string | null, rootKey: string): string | null {
  if (!file || !isWellFormedUnicode(file) || unsafePathPattern.test(file)) return null;
  const normalized = file.trim().split("\\").join("/");
  const relative = isAbsolutePath(normalized)
    ? workspaceRelativePath(rootKey, normalized)
    : normalized;
  if (!relative) return null;
  try {
    return normalizedJsTestRelativeFilePath(relative);
  } catch {
    return null;
  }
}

function problemMatchesScope(entry: JsTestProblemEntry, scope: JsTestRunScope): boolean {
  if (scope.kind === "all") return true;
  if (entry.filePath !== scope.relativeFilePath) return false;
  if (scope.kind === "file") return true;
  if (entry.name === null) return false;
  if (scope.kind === "suite") {
    return entry.name === scope.fullName || entry.name.startsWith(`${scope.fullName} `);
  }
  return (
    entry.name === scope.fullName ||
    (scope.nameMatch === "prefix" && entry.name.startsWith(`${scope.fullName} `))
  );
}

function problemIdentity(entry: JsTestProblemEntry): string {
  return JSON.stringify([entry.filePath, entry.lineNumber, entry.name]);
}

function jsTestProblemOverflowMessage(
  snapshot: JsTestProblemsSnapshot,
  shownCount: number,
): string {
  const knownHidden = Math.max(0, snapshot.total - shownCount);
  if (snapshot.truncated) {
    const recorded =
      knownHidden > 0 ? ` Showing ${shownCount} of ${snapshot.total} recorded problems.` : "";
    return `JavaScript test problems were truncated.${recorded} Additional problems may be hidden.`;
  }
  return `${knownHidden} more JavaScript test problems hidden.`;
}

function problemTextBytes(entry: JsTestProblemEntry): number {
  return (
    utf8ByteLength(entry.filePath) +
    utf8ByteLength(entry.name ?? "") +
    utf8ByteLength(entry.message)
  );
}

function sanitizeText(value: string): string {
  const wellFormed = normalizingDecoder.decode(encoder.encode(value));
  return wellFormed.replace(unsafeTextPattern, "�");
}

function truncateUtf8(value: string, maximumBytes: number): string {
  const bytes = encoder.encode(value);
  if (bytes.byteLength <= maximumBytes) return value;
  const suffix = encoder.encode("…");
  let end = maximumBytes - suffix.byteLength;
  while (end > 0) {
    try {
      return `${decoder.decode(bytes.slice(0, end))}…`;
    } catch {
      end -= 1;
    }
  }
  return "";
}

function resolveLimits(limits: JsTestProblemsLimits): ResolvedLimits {
  return {
    maxCases: positiveLimit(limits.maxCases, MAX_JS_TEST_PROBLEM_CASES, "maxCases"),
    maxEntries: positiveLimit(limits.maxEntries, MAX_JS_TEST_PROBLEM_ENTRIES, "maxEntries"),
    maxMessageBytes: positiveLimit(
      limits.maxMessageBytes,
      MAX_JS_TEST_PROBLEM_MESSAGE_BYTES,
      "maxMessageBytes",
    ),
    maxNameBytes: positiveLimit(
      limits.maxNameBytes,
      MAX_JS_TEST_PROBLEM_NAME_BYTES,
      "maxNameBytes",
    ),
    maxTextBytes: positiveLimit(
      limits.maxTextBytes,
      MAX_JS_TEST_PROBLEM_TEXT_BYTES,
      "maxTextBytes",
    ),
  };
}

function positiveLimit(value: number | undefined, fallback: number, label: string): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved <= 0) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return resolved;
}

function isSafeIdentity(value: string): boolean {
  return Boolean(value) && isWellFormedUnicode(value) && !unsafePathPattern.test(value);
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function utf8ByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

function frozenSnapshot(
  owner: JsTestProblemsOwner,
  generation: number,
  entries: readonly JsTestProblemEntry[],
  total: number,
  truncated: boolean,
): JsTestProblemsSnapshot {
  return Object.freeze({
    owner,
    generation,
    entries: Object.freeze([...entries]),
    total,
    truncated,
  });
}

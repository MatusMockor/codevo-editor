import { jsTestExplorerTestId, type JsTestExplorerTestDiscovery } from "./jsTestExplorerTree";
import {
  normalizedJsTestRelativeFilePath,
  validatedJsTestRunScope,
  type JsTestRunScope,
} from "./jsTestRunScope";
import type { TestCase, TestRunOk } from "./testResults";
import { isWellFormedUnicode } from "./unicodeText";

export const MAX_JS_TEST_FAILED_RUN_CASES = 5_000;
export const MAX_JS_TEST_FAILED_RUN_DISCOVERIES = 20_000;
export const MAX_JS_TEST_FAILED_RUN_SCOPES = 256;
export const MAX_JS_TEST_FAILED_RUN_SCOPE_TEXT_BYTES = 1024 * 1024;

export interface JsTestFailedRunSnapshot {
  readonly discoveries: readonly JsTestExplorerTestDiscovery[];
  readonly discoveryTruncated: boolean;
  readonly response: TestRunOk;
  readonly rootPath: string;
}

export type JsTestFailedRunScope = Extract<JsTestRunScope, { readonly kind: "test" }>;

export type JsTestFailedRunPlan =
  | {
      readonly scopes: readonly JsTestFailedRunScope[];
      readonly status: "available";
      readonly unresolved: 0;
    }
  | {
      readonly scopes: readonly [];
      readonly status: "unavailable";
      readonly unresolved: number;
    }
  | {
      readonly scopes: readonly [];
      readonly status: "overflow";
      readonly unresolved: number;
    };

interface CanonicalDiscovery {
  readonly fullName: string;
  readonly id: string;
  readonly lineNumber: number;
  readonly parameterized: boolean;
  readonly relativeFilePath: string;
  readonly scope: JsTestFailedRunScope;
}

const encoder = new TextEncoder();
const unsafeTextPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/**
 * Resolves failed runtime cases back to exact Test Explorer declarations.
 * The result is deliberately all-or-nothing: a partial rerun is never presented as "rerun failed".
 */
export function jsTestFailedRunScopes(snapshot: JsTestFailedRunSnapshot): JsTestFailedRunPlan {
  if (
    snapshot.discoveryTruncated ||
    snapshot.response.status !== "ok" ||
    !canonicalRootPath(snapshot.rootPath)
  ) {
    return unavailable(0);
  }
  const cases = snapshot.response.suites.flatMap(({ cases: suiteCases }) => suiteCases);
  if (
    cases.length > MAX_JS_TEST_FAILED_RUN_CASES ||
    snapshot.discoveries.length > MAX_JS_TEST_FAILED_RUN_DISCOVERIES
  ) {
    return overflow(0);
  }

  const canonical = canonicalDiscoveries(snapshot.discoveries, snapshot.rootPath);
  if (!canonical) return unavailable(0);
  const byFile = new Map<string, CanonicalDiscovery[]>();
  for (const discovery of canonical) {
    const entries = byFile.get(discovery.relativeFilePath) ?? [];
    entries.push(discovery);
    byFile.set(discovery.relativeFilePath, entries);
  }

  const scopes = new Map<string, JsTestFailedRunScope>();
  let unresolved = 0;
  for (const testCase of cases) {
    if (testCase.status !== "failed" && testCase.status !== "error") continue;
    const resolved = resolveFailedCase(testCase, snapshot.rootPath, byFile);
    if (!resolved || scopeSelectionCount(resolved.scope, canonical) !== 1) {
      unresolved += 1;
      continue;
    }
    scopes.set(scopeKey(resolved.scope), resolved.scope);
  }

  const sorted = [...scopes.values()].sort(compareScopes);
  const scopeTextBytes = sorted.reduce(
    (total, scope) =>
      total +
      encoder.encode(scope.relativeFilePath).byteLength +
      encoder.encode(scope.fullName).byteLength,
    0,
  );
  if (
    sorted.length > MAX_JS_TEST_FAILED_RUN_SCOPES ||
    scopeTextBytes > MAX_JS_TEST_FAILED_RUN_SCOPE_TEXT_BYTES
  ) {
    return overflow(unresolved);
  }
  if (unresolved > 0) return unavailable(unresolved);

  return Object.freeze({
    scopes: Object.freeze(sorted.map(cloneFrozenScope)),
    status: "available",
    unresolved: 0,
  });
}

function canonicalDiscoveries(
  discoveries: readonly JsTestExplorerTestDiscovery[],
  rootPath: string,
): readonly CanonicalDiscovery[] | null {
  const identities = new Map<string, CanonicalDiscovery>();
  for (const discovery of discoveries) {
    const canonical = canonicalDiscovery(discovery, rootPath);
    if (!canonical) return null;
    const previous = identities.get(canonical.id);
    if (previous) {
      if (
        previous.fullName !== canonical.fullName ||
        previous.parameterized !== canonical.parameterized ||
        previous.relativeFilePath !== canonical.relativeFilePath ||
        previous.lineNumber !== canonical.lineNumber
      ) {
        return null;
      }
      continue;
    }
    identities.set(canonical.id, canonical);
  }
  return Object.freeze([...identities.values()]);
}

function canonicalDiscovery(
  discovery: JsTestExplorerTestDiscovery,
  rootPath: string,
): CanonicalDiscovery | null {
  const relativeFilePath = relativeTestPath(rootPath, discovery.filePath);
  const lineNumber = discovery.target.position.lineNumber;
  const column = discovery.target.position.column;
  if (
    !relativeFilePath ||
    !Number.isSafeInteger(lineNumber) ||
    lineNumber <= 0 ||
    !Number.isSafeInteger(column) ||
    column <= 0
  ) {
    return null;
  }
  const fullName = [...discovery.suitePath, discovery.target.filter].join(" ");
  let scope: JsTestRunScope;
  try {
    scope = validatedJsTestRunScope({
      fullName,
      kind: "test",
      ...(discovery.parameterized ? { nameMatch: "prefix" as const } : {}),
      relativeFilePath,
    });
  } catch {
    return null;
  }
  if (scope.kind !== "test") return null;
  const normalizedDiscovery = {
    ...discovery,
    filePath: relativeFilePath,
    parameterized: discovery.parameterized === true,
    suitePath: Object.freeze([...discovery.suitePath]),
  };
  return Object.freeze({
    fullName,
    id: jsTestExplorerTestId(normalizedDiscovery),
    lineNumber,
    parameterized: discovery.parameterized === true,
    relativeFilePath,
    scope: cloneFrozenScope(scope),
  });
}

function resolveFailedCase(
  testCase: TestCase,
  rootPath: string,
  byFile: ReadonlyMap<string, readonly CanonicalDiscovery[]>,
): CanonicalDiscovery | null {
  const relativeFilePath = relativeTestPath(rootPath, testCase.file);
  const runtimeName = testCase.name;
  if (
    !relativeFilePath ||
    !safeRuntimeName(runtimeName) ||
    (testCase.line !== null && (!Number.isSafeInteger(testCase.line) || testCase.line <= 0))
  ) {
    return null;
  }
  const matches = (byFile.get(relativeFilePath) ?? []).filter(
    (discovery) =>
      (testCase.line === null || discovery.lineNumber === testCase.line) &&
      (discovery.parameterized
        ? runtimeName === discovery.fullName || runtimeName.startsWith(`${discovery.fullName} `)
        : runtimeName === discovery.fullName),
  );
  return matches.length === 1 ? matches[0]! : null;
}

function scopeSelectionCount(
  scope: JsTestFailedRunScope,
  discoveries: readonly CanonicalDiscovery[],
): number {
  let count = 0;
  for (const discovery of discoveries) {
    if (discovery.relativeFilePath !== scope.relativeFilePath) continue;
    const selected =
      scope.nameMatch === "prefix"
        ? discovery.fullName === scope.fullName ||
          discovery.fullName.startsWith(`${scope.fullName} `)
        : discovery.fullName === scope.fullName;
    if (selected) count += 1;
  }
  return count;
}

function relativeTestPath(rootPath: string, path: string | null): string | null {
  if (!path || !isWellFormedUnicode(path) || unsafeTextPattern.test(path)) return null;
  const normalized = path
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/{2,}/g, "/");
  const root = canonicalRootPath(rootPath);
  if (!root) return null;
  let relative = normalized;
  if (isAbsolutePath(normalized)) {
    const prefix = `${root}/`;
    if (!normalized.startsWith(prefix)) return null;
    relative = normalized.slice(prefix.length);
  }
  try {
    return normalizedJsTestRelativeFilePath(relative);
  } catch {
    return null;
  }
}

function canonicalRootPath(rootPath: string): string | null {
  if (!isWellFormedUnicode(rootPath) || unsafeTextPattern.test(rootPath)) return null;
  const normalized = rootPath
    .trim()
    .split("\\")
    .join("/")
    .replace(/\/{2,}/g, "/");
  const root =
    normalized === "/" || /^[A-Za-z]:\/$/.test(normalized)
      ? normalized
      : normalized.replace(/\/+$/, "");
  if (!isAbsolutePath(root)) return null;
  const prefixLength = /^[A-Za-z]:\//.test(root) ? 3 : 1;
  if (
    root.length > prefixLength &&
    root
      .slice(prefixLength)
      .split("/")
      .some((segment) => segment === "." || segment === ".." || segment === "")
  ) {
    return null;
  }
  return root;
}

function safeRuntimeName(name: string | null): name is string {
  return (
    name !== null && name.length > 0 && isWellFormedUnicode(name) && !unsafeTextPattern.test(name)
  );
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith("/") || /^[A-Za-z]:\//.test(path);
}

function scopeKey(scope: JsTestFailedRunScope): string {
  return JSON.stringify([
    scope.relativeFilePath,
    scope.fullName,
    scope.nameMatch === "prefix" ? "prefix" : "exact",
  ]);
}

function compareScopes(left: JsTestFailedRunScope, right: JsTestFailedRunScope): number {
  return (
    compareText(left.relativeFilePath, right.relativeFilePath) ||
    compareText(left.fullName, right.fullName) ||
    compareText(left.nameMatch ?? "", right.nameMatch ?? "")
  );
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function cloneFrozenScope(scope: JsTestFailedRunScope): JsTestFailedRunScope {
  return Object.freeze({
    fullName: scope.fullName,
    kind: "test",
    ...(scope.nameMatch === "prefix" ? { nameMatch: "prefix" as const } : {}),
    relativeFilePath: scope.relativeFilePath,
  });
}

function unavailable(unresolved: number): JsTestFailedRunPlan {
  return Object.freeze({ scopes: Object.freeze([] as const), status: "unavailable", unresolved });
}

function overflow(unresolved: number): JsTestFailedRunPlan {
  return Object.freeze({ scopes: Object.freeze([] as const), status: "overflow", unresolved });
}

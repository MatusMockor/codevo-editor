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

export type JsTestFailedRunScope = Extract<JsTestRunScope, { readonly kind: "test" }> & {
  readonly packageRootRelativePath?: string;
};

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

export interface JsTestFailedRunResolver {
  resolve(response: TestRunOk): JsTestFailedRunPlan;
}

export type JsTestFailedRunResolverPlan =
  | {
      readonly resolver: JsTestFailedRunResolver;
      readonly status: "available";
    }
  | Exclude<JsTestFailedRunPlan, { readonly status: "available" }>;

interface CanonicalDiscovery {
  readonly fullName: string;
  readonly id: string;
  readonly lineNumber: number;
  readonly parameterized: boolean;
  readonly relativeFilePath: string;
  readonly scope: JsTestFailedRunScope;
}

interface CanonicalFileIndex {
  readonly byName: ReadonlyMap<string, readonly CanonicalDiscovery[]>;
  readonly sortedNames: readonly string[];
}

const encoder = new TextEncoder();
const unsafeTextPattern = /[\p{Cc}\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/**
 * Resolves failed runtime cases back to exact Test Explorer declarations.
 * The result is deliberately all-or-nothing: a partial rerun is never presented as "rerun failed".
 */
export function jsTestFailedRunScopes(snapshot: JsTestFailedRunSnapshot): JsTestFailedRunPlan {
  const prepared = createJsTestFailedRunResolver(snapshot);
  return prepared.status === "available" ? prepared.resolver.resolve(snapshot.response) : prepared;
}

export function createJsTestFailedRunResolver(snapshot: {
  readonly discoveries: readonly JsTestExplorerTestDiscovery[];
  readonly discoveryTruncated: boolean;
  readonly rootPath: string;
}): JsTestFailedRunResolverPlan {
  if (snapshot.discoveryTruncated || !canonicalRootPath(snapshot.rootPath)) {
    return unavailable(0);
  }
  if (snapshot.discoveries.length > MAX_JS_TEST_FAILED_RUN_DISCOVERIES) {
    return overflow(0);
  }
  const canonical = canonicalDiscoveries(snapshot.discoveries, snapshot.rootPath);
  if (!canonical) return unavailable(0);
  const byFile = canonicalDiscoveryIndex(canonical);
  return Object.freeze({
    resolver: Object.freeze({
      resolve: (response: TestRunOk) => resolveFailedRunScopes(response, snapshot.rootPath, byFile),
    }),
    status: "available" as const,
  });
}

function resolveFailedRunScopes(
  response: TestRunOk,
  rootPath: string,
  byFile: ReadonlyMap<string, CanonicalFileIndex>,
): JsTestFailedRunPlan {
  const cases: TestCase[] = [];
  for (const suite of response.suites) {
    if (cases.length + suite.cases.length > MAX_JS_TEST_FAILED_RUN_CASES) return overflow(0);
    cases.push(...suite.cases);
  }

  const scopes = new Map<string, JsTestFailedRunScope>();
  let unresolved = 0;
  for (const testCase of cases) {
    if (testCase.status !== "failed" && testCase.status !== "error") continue;
    const resolved = resolveFailedCase(testCase, rootPath, byFile);
    if (!resolved || scopeSelectionCount(resolved.scope, byFile) !== 1) {
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
  byFile: ReadonlyMap<string, CanonicalFileIndex>,
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
  const index = byFile.get(relativeFilePath);
  if (!index) return null;
  const candidates = new Map<string, CanonicalDiscovery>();
  for (const discovery of index.byName.get(runtimeName) ?? []) {
    candidates.set(discovery.id, discovery);
  }
  for (let boundary = runtimeName.indexOf(" "); boundary >= 0;) {
    const prefix = runtimeName.slice(0, boundary);
    for (const discovery of index.byName.get(prefix) ?? []) {
      if (discovery.parameterized) candidates.set(discovery.id, discovery);
    }
    boundary = runtimeName.indexOf(" ", boundary + 1);
  }
  const matches = [...candidates.values()].filter(
    (discovery) => testCase.line === null || discovery.lineNumber === testCase.line,
  );
  return matches.length === 1 ? matches[0]! : null;
}

function scopeSelectionCount(
  scope: JsTestFailedRunScope,
  byFile: ReadonlyMap<string, CanonicalFileIndex>,
): number {
  const index = byFile.get(scope.relativeFilePath);
  if (!index) return 0;
  const exact = index.byName.get(scope.fullName)?.length ?? 0;
  if (scope.nameMatch !== "prefix") return exact;
  const descendantPrefix = `${scope.fullName} `;
  return (
    exact +
    lowerBound(index.sortedNames, `${scope.fullName}!`) -
    lowerBound(index.sortedNames, descendantPrefix)
  );
}

function canonicalDiscoveryIndex(
  discoveries: readonly CanonicalDiscovery[],
): ReadonlyMap<string, CanonicalFileIndex> {
  const mutable = new Map<string, { byName: Map<string, CanonicalDiscovery[]>; names: string[] }>();
  for (const discovery of discoveries) {
    const file = mutable.get(discovery.relativeFilePath) ?? {
      byName: new Map<string, CanonicalDiscovery[]>(),
      names: [],
    };
    const named = file.byName.get(discovery.fullName) ?? [];
    named.push(discovery);
    file.byName.set(discovery.fullName, named);
    file.names.push(discovery.fullName);
    mutable.set(discovery.relativeFilePath, file);
  }
  return new Map(
    [...mutable].map(([filePath, file]) => [
      filePath,
      Object.freeze({
        byName: file.byName,
        sortedNames: Object.freeze(file.names.sort(compareText)),
      }),
    ]),
  );
}

function lowerBound(values: readonly string[], target: string): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = low + Math.floor((high - low) / 2);
    if (compareText(values[middle]!, target) < 0) low = middle + 1;
    else high = middle;
  }
  return low;
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
    ...(scope.packageRootRelativePath === undefined
      ? {}
      : { packageRootRelativePath: scope.packageRootRelativePath }),
    relativeFilePath: scope.relativeFilePath,
  });
}

function unavailable(
  unresolved: number,
): Extract<JsTestFailedRunPlan, { readonly status: "unavailable" }> {
  return Object.freeze({ scopes: Object.freeze([] as const), status: "unavailable", unresolved });
}

function overflow(
  unresolved: number,
): Extract<JsTestFailedRunPlan, { readonly status: "overflow" }> {
  return Object.freeze({ scopes: Object.freeze([] as const), status: "overflow", unresolved });
}

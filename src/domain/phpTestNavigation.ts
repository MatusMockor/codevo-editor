import type { Psr4Root } from "./workspace";

/**
 * Pure, bidirectional resolver for PhpStorm-style "Go to Test / Test Subject"
 * navigation. Given a workspace-relative PHP file path and the project's PSR-4
 * roots, it decides whether the path is a TEST or a production SUBJECT and
 * returns the relative path(s) of the partner file to look for on disk.
 *
 * Mapping mirrors `phpTestGen` (PhpStorm default): a source class
 * `app/Services/InvoiceService.php` (`App\Services\InvoiceService`) has its test
 * under the tests suite directory, preserving the sub-namespace and appending a
 * `Test` suffix. Tests live in either `Unit/` or `Feature/`, so src -> test
 * offers BOTH suites as candidates (the caller picks the first that exists on
 * disk); test -> subject is unambiguous and yields a single candidate.
 *
 * Design constraints:
 *  - Pure: no I/O, no side effects. The controller owns disk probing, opening
 *    and the per-workspace isolation guards.
 *  - Conservative: returns `null` whenever there is no meaningful partner (path
 *    not under any source/tests root, or a non-`*Test` file under tests/).
 */

const LARAVEL_TESTS_NAMESPACE = "Tests\\";
const TEST_SUITE_SEGMENTS = ["Unit", "Feature"] as const;
const TEST_CLASS_SUFFIX = "Test";

export type PhpTestNavigationDirection = "toSubject" | "toTest";

export interface PhpTestNavigationInput {
  psr4Roots: readonly Psr4Root[];
  relativePath: string;
}

export interface PhpTestNavigationResult {
  candidates: string[];
  direction: PhpTestNavigationDirection;
}

export function phpTestNavigationTargets(
  input: PhpTestNavigationInput,
): PhpTestNavigationResult | null {
  const relativePath = normalizeRelativePath(input.relativePath);

  if (!relativePath.toLowerCase().endsWith(".php")) {
    return null;
  }

  const testsBaseDir = laravelTestsBaseDir(input.psr4Roots);
  const sourceBaseDir = matchingSourceBaseDir(relativePath, input.psr4Roots);

  if (isPhpTestRelativePath(relativePath, input.psr4Roots)) {
    return resolveSubject(relativePath, testsBaseDir, input.psr4Roots);
  }

  if (!sourceBaseDir) {
    return null;
  }

  return resolveTest(relativePath, sourceBaseDir, testsBaseDir);
}

export function isPhpTestRelativePath(
  relativePath: string,
  psr4Roots: readonly Psr4Root[],
): boolean {
  const normalized = normalizeRelativePath(relativePath);
  const testsBaseDir = laravelTestsBaseDir(psr4Roots);

  // The `Test` class-name suffix only marks a test when the file actually lives
  // under the tests root. A production class that happens to end in `Test`
  // (e.g. `app/Support/ManifestTest.php`) is a SUBJECT, not a test — treating it
  // as a test would map it back through the tests root and double the path.
  if (matchingSourceBaseDir(normalized, psr4Roots)) {
    return false;
  }

  if (isUnderDirectory(normalized, testsBaseDir)) {
    return true;
  }

  return classNameFromPath(normalized).endsWith(TEST_CLASS_SUFFIX);
}

function resolveTest(
  relativePath: string,
  sourceBaseDir: string,
  testsBaseDir: string,
): PhpTestNavigationResult {
  const subPath = stripDirectoryPrefix(relativePath, sourceBaseDir);
  const className = classNameFromPath(subPath);
  const subDirectory = directoryFromPath(subPath);
  const testClassName = `${className}${TEST_CLASS_SUFFIX}.php`;

  const candidates = TEST_SUITE_SEGMENTS.map((suite) =>
    joinSegments([testsBaseDir, suite, subDirectory, testClassName]),
  );

  return { candidates, direction: "toTest" };
}

function resolveSubject(
  relativePath: string,
  testsBaseDir: string,
  psr4Roots: readonly Psr4Root[],
): PhpTestNavigationResult | null {
  const className = classNameFromPath(relativePath);

  if (!className.endsWith(TEST_CLASS_SUFFIX)) {
    return null;
  }

  const subjectClassName = className.slice(
    0,
    className.length - TEST_CLASS_SUFFIX.length,
  );

  if (!subjectClassName) {
    return null;
  }

  const subDirectory = subjectSubDirectory(relativePath, testsBaseDir);
  const target = subjectSourceTarget(subDirectory, psr4Roots);

  if (!target) {
    return null;
  }

  const candidate = joinSegments([
    target.baseDir,
    target.subPath,
    `${subjectClassName}.php`,
  ]);

  return { candidates: [candidate], direction: "toSubject" };
}

interface SubjectSourceTarget {
  baseDir: string;
  subPath: string;
}

/**
 * Chooses the SOURCE root the subject belongs to from the test's sub-namespace
 * directory. In a multi-root project the leading directory segment(s) of the
 * sub-namespace mirror a non-App PSR-4 namespace (e.g. `Domain/Order` →
 * `Domain\` root at `src/Domain`); that root's base dir is used and the matched
 * namespace prefix is consumed, so the subject lands in the right tree rather
 * than always under App. Falls back to the primary (App / first) source root
 * with the full sub-directory when no namespace prefix matches.
 */
function subjectSourceTarget(
  subDirectory: string,
  psr4Roots: readonly Psr4Root[],
): SubjectSourceTarget | null {
  const segments = subDirectory.split("/").filter(Boolean);
  const namespaced = matchNamespacedSourceTarget(segments, psr4Roots);

  if (namespaced) {
    return namespaced;
  }

  const baseDir = primarySourceBaseDir(psr4Roots);

  if (!baseDir) {
    return null;
  }

  return { baseDir, subPath: segments.join("/") };
}

/**
 * When the sub-namespace's leading segment(s) match a non-App source root's
 * namespace, returns that root's base dir plus the remaining segments. The
 * longest matching namespace wins so nested roots resolve precisely. Returns
 * `null` when no root's namespace prefixes the segments.
 */
function matchNamespacedSourceTarget(
  segments: string[],
  psr4Roots: readonly Psr4Root[],
): SubjectSourceTarget | null {
  const matches = sourceRoots(psr4Roots)
    .map((root) => namespacedTargetForRoot(root, segments))
    .filter((target): target is NamespacedSourceTarget => target !== null);

  const best = matches.reduce<NamespacedSourceTarget | null>(
    (longest, target) =>
      !longest || target.consumed > longest.consumed ? target : longest,
    null,
  );

  if (!best) {
    return null;
  }

  return { baseDir: best.baseDir, subPath: best.subPath };
}

interface NamespacedSourceTarget extends SubjectSourceTarget {
  consumed: number;
}

function namespacedTargetForRoot(
  root: Psr4Root,
  segments: string[],
): NamespacedSourceTarget | null {
  const namespaceSegments = root.namespace
    .split("\\")
    .filter(Boolean);

  if (namespaceSegments.length === 0) {
    return null;
  }

  const prefixesPath = namespaceSegments.every(
    (segment, index) => segments[index] === segment,
  );

  if (!prefixesPath) {
    return null;
  }

  const baseDir = trimSlashes(root.paths[0] ?? "");

  if (!baseDir) {
    return null;
  }

  return {
    baseDir,
    consumed: namespaceSegments.length,
    subPath: segments.slice(namespaceSegments.length).join("/"),
  };
}

function subjectSubDirectory(relativePath: string, testsBaseDir: string): string {
  const withinTests = isUnderDirectory(relativePath, testsBaseDir)
    ? stripDirectoryPrefix(relativePath, testsBaseDir)
    : relativePath;
  const directory = directoryFromPath(withinTests);
  const segments = directory.split("/").filter(Boolean);

  if (segments.length > 0 && isTestSuiteSegment(segments[0])) {
    return segments.slice(1).join("/");
  }

  return segments.join("/");
}

function isTestSuiteSegment(segment: string): boolean {
  return TEST_SUITE_SEGMENTS.some((suite) => suite === segment);
}

function matchingSourceBaseDir(
  relativePath: string,
  psr4Roots: readonly Psr4Root[],
): string | null {
  const candidates = sourceRoots(psr4Roots)
    .map((root) => trimSlashes(root.paths[0] ?? ""))
    .filter(Boolean)
    .filter((baseDir) => isUnderDirectory(relativePath, baseDir));

  if (candidates.length === 0) {
    return null;
  }

  return candidates.reduce((longest, baseDir) =>
    baseDir.length > longest.length ? baseDir : longest,
  );
}

function primarySourceBaseDir(psr4Roots: readonly Psr4Root[]): string | null {
  const roots = sourceRoots(psr4Roots);
  const appRoot = roots.find((root) => root.namespace === "App\\");
  const chosen = appRoot ?? roots[0];

  if (!chosen) {
    return null;
  }

  return trimSlashes(chosen.paths[0] ?? "") || null;
}

function sourceRoots(psr4Roots: readonly Psr4Root[]): Psr4Root[] {
  return psr4Roots
    .filter((root) => root.paths.length > 0)
    .filter((root) => root.namespace !== LARAVEL_TESTS_NAMESPACE);
}

function laravelTestsBaseDir(psr4Roots: readonly Psr4Root[]): string {
  const testsRoot = psr4Roots.find(
    (root) =>
      root.namespace === LARAVEL_TESTS_NAMESPACE && root.paths.length > 0,
  );

  return trimSlashes(testsRoot?.paths[0] ?? "tests") || "tests";
}

function isUnderDirectory(relativePath: string, directory: string): boolean {
  if (!directory) {
    return false;
  }

  return relativePath.startsWith(`${directory}/`);
}

function stripDirectoryPrefix(relativePath: string, directory: string): string {
  if (!isUnderDirectory(relativePath, directory)) {
    return relativePath;
  }

  return relativePath.slice(directory.length + 1);
}

function classNameFromPath(relativePath: string): string {
  const fileName = relativePath.split("/").filter(Boolean).pop() ?? relativePath;

  return fileName.replace(/\.php$/i, "");
}

function directoryFromPath(relativePath: string): string {
  const segments = relativePath.split("/").filter(Boolean);

  return segments.slice(0, -1).join("/");
}

function joinSegments(segments: string[]): string {
  return segments.filter(Boolean).join("/");
}

function normalizeRelativePath(value: string): string {
  return value.trim().split("\\").join("/").replace(/^\/+/, "");
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+/, "").replace(/\/+$/, "");
}

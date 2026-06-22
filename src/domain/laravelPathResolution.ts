/**
 * Pure resolution of Laravel global string-helper literals to TARGET PATHS and
 * KEYS, relative to the workspace root.
 *
 * This module answers a single question: given the literal argument of a Laravel
 * helper (`config`, `view`, `__` / `trans`, `env`), what file(s) and key path
 * would Laravel resolve it to?
 *
 * It is deliberately FILESYSTEM-FREE — it only constructs candidate relative
 * paths and key arrays from string logic. Verifying which candidate actually
 * exists (and reading file contents) is the responsibility of the navigation /
 * completion integration layer.
 *
 * It mirrors the helper taxonomy of `laravelStringLiteralHelpers.ts`
 * (`config`, `view`, `trans`, `env`). It stays CONSERVATIVE: any literal that is
 * empty, whitespace-only, path-traversing, namespaced (vendor `package::file`),
 * or otherwise malformed resolves to `null` rather than a guessed path.
 */

export interface LaravelConfigTarget {
  /** Workspace-relative path of the config file, e.g. `config/app.php`. */
  relativeFilePath: string;
  /** Remaining dotted segments addressing a value inside the file. */
  keyPath: string[];
}

export interface LaravelViewTarget {
  /** Ordered candidate workspace-relative paths for the Blade view. */
  relativeFilePaths: string[];
}

export interface LaravelTransTarget {
  /**
   * Ordered candidate workspace-relative paths. For PHP group translations these
   * are `lang/{locale}/{group}.php` (and the legacy `resources/lang/...`); for
   * JSON-only translations these are `lang/{locale}.json` (and the legacy
   * variant).
   */
  relativeFilePaths: string[];
  /**
   * Remaining dotted segments addressing a value inside a PHP group file (always
   * non-empty when `relativeFilePaths` is non-empty, since a group reference
   * needs `group.key`). Empty when the literal is a JSON-only translation (no
   * usable `group.key` structure).
   */
  keyPath: string[];
  /**
   * Ordered candidate JSON translation file paths (`lang/{locale}.json` and the
   * legacy `resources/lang/{locale}.json`). Always present: because the resolver
   * cannot read the filesystem, a dotted literal may be either a PHP group key
   * or a JSON key (JSON keys legitimately contain dots), so JSON candidates are
   * always offered as a fallback.
   */
  jsonFilePaths: string[];
  /**
   * The literal used verbatim as the key inside a JSON translation file. This is
   * the whole literal — JSON translations are keyed by the full source string.
   */
  jsonKey: string;
}

export interface LaravelEnvTarget {
  /** Always `.env` — the file the key is expected to live in. */
  relativeFilePath: string;
  /** The environment variable name. */
  key: string;
}

const DEFAULT_LOCALE = "en";

/**
 * Resolves a `config(...)` literal to its config file and key path. The first
 * dotted segment names the file under `config/`; the remainder is the key path.
 */
export function resolveLaravelConfigTarget(
  literal: string,
): LaravelConfigTarget | null {
  const segments = dottedSegments(literal.trim());

  if (!segments) {
    return null;
  }

  const [fileName, ...keyPath] = segments;

  return {
    relativeFilePath: `config/${fileName}.php`,
    keyPath,
  };
}

/**
 * Resolves a `view(...)` literal to candidate Blade file paths. Both dot and
 * slash notation are accepted (Laravel treats `admin.dashboard` and
 * `admin/dashboard` identically); separators become directories and both the
 * `.blade.php` and plain `.php` variants are offered. Vendor namespaced views
 * (`package::view`) are not resolved.
 */
export function resolveLaravelViewTarget(
  literal: string,
): LaravelViewTarget | null {
  const normalized = literal.trim().split("/").join(".");
  const segments = dottedSegments(normalized);

  if (!segments) {
    return null;
  }

  const relativePath = segments.join("/");

  return {
    relativeFilePaths: [
      `resources/views/${relativePath}.blade.php`,
      `resources/views/${relativePath}.php`,
    ],
  };
}

/**
 * Resolves a `__()` / `trans()` literal to candidate lang file paths and key
 * data.
 *
 * Laravel resolves a translation by first trying a PHP group file (`group.key`)
 * and falling back to a JSON file keyed by the whole literal. Because this
 * resolver cannot read the filesystem to disambiguate — and JSON keys
 * legitimately contain dots — it always offers the JSON candidates
 * (`jsonFilePaths` + `jsonKey`) and, when the literal has a usable
 * `group.key` structure, additionally offers the PHP group candidates
 * (`relativeFilePaths` + `keyPath`).
 *
 * Blank literals, vendor namespaced literals (`package::file.key`), literals
 * that path-traverse (`../`, slashes), and invalid locales are not resolved.
 */
export function resolveLaravelTransTarget(
  literal: string,
  locale: string = DEFAULT_LOCALE,
): LaravelTransTarget | null {
  if (isBlank(literal) || hasVendorNamespace(literal) || hasPathSeparator(literal)) {
    return null;
  }

  if (!isUsableLocale(locale)) {
    return null;
  }

  const jsonFilePaths = [`lang/${locale}.json`, `resources/lang/${locale}.json`];
  const groupSegments = dottedSegments(literal.trim());

  if (!groupSegments || groupSegments.length < 2) {
    return { relativeFilePaths: [], keyPath: [], jsonFilePaths, jsonKey: literal };
  }

  const [group, ...keyPath] = groupSegments;

  return {
    relativeFilePaths: [
      `lang/${locale}/${group}.php`,
      `resources/lang/${locale}/${group}.php`,
    ],
    keyPath,
    jsonFilePaths,
    jsonKey: literal,
  };
}

/**
 * Resolves an `env(...)` literal to its `.env` key. Surrounding whitespace is
 * trimmed; keys with invalid characters resolve to `null`.
 */
export function resolveLaravelEnvTarget(
  literal: string,
): LaravelEnvTarget | null {
  const key = literal.trim();

  if (!isUsableEnvKey(key)) {
    return null;
  }

  return {
    relativeFilePath: ".env",
    key,
  };
}

/**
 * Splits a dotted literal into its segments when it is a usable, dot-separated
 * path with no namespace, slash, or path-traversal. Returns `null` for literals
 * that are blank, namespaced, or contain an empty / unusable segment — including
 * literals that are not dot-separable at all (e.g. free-form sentences).
 */
function dottedSegments(literal: string): string[] | null {
  if (isBlank(literal) || hasVendorNamespace(literal)) {
    return null;
  }

  const segments = literal.split(".");

  if (!segments.every(isUsableSegment)) {
    return null;
  }

  return segments;
}

function hasVendorNamespace(literal: string): boolean {
  return literal.includes("::");
}

function hasPathSeparator(literal: string): boolean {
  return literal.includes("/") || literal.includes("\\");
}

function isBlank(value: string): boolean {
  return value.trim().length === 0;
}

function isUsableSegment(segment: string): boolean {
  return (
    segment.length > 0 &&
    !segment.includes("/") &&
    !segment.includes("\\") &&
    segment !== "." &&
    segment !== ".."
  );
}

function isUsableLocale(locale: string): boolean {
  return /^[A-Za-z][A-Za-z0-9_-]*$/.test(locale);
}

function isUsableEnvKey(key: string): boolean {
  return /^[A-Za-z0-9_][A-Za-z0-9_.]*$/.test(key);
}

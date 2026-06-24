/**
 * Pure detection of Laravel implicit route-model-binding parameters.
 *
 * Laravel binds a route URI parameter to an Eloquent model by convention: a
 * `{user}` segment in `Route::get('/users/{user}', ...)` resolves to the
 * `User` model (the parameter name is Studly-cased — Laravel does NOT
 * singularise/pluralise it). This module answers one question: is a given
 * offset inside a `{param}` token of a route-defining URI string, and if so,
 * what model short name does the parameter map to?
 *
 * It is deliberately conservative — it only recognises the URI string of a
 * `Route::<verb>(...)` call (the verbs that accept a URI path). It intentionally
 * does NOT handle:
 *   - explicit bindings (`Route::model(...)`, `Route::bind(...)`, the
 *     `RouteServiceProvider::boot` mapping)
 *   - resource / singleton routes (their URIs are generated, not literal)
 *   - dynamic / interpolated URIs
 * Resolution of the model short name to a concrete class / file is out of scope
 * and handled by the navigation integration layer.
 */

interface Psr4RootLike {
  namespace: string;
  paths: string[];
}

interface PhpProjectDescriptorLike {
  psr4Roots: Psr4RootLike[];
}

export interface LaravelRouteModelBindingParameter {
  /** Studly-cased model short name the parameter maps to (e.g. `User`). */
  modelShortName: string;
  /** Raw parameter name as written, without the `{}`/`?`/`:field` parts. */
  parameterName: string;
  /** Offset of the parameter-name start (just after `{`). */
  parameterStart: number;
  /** Offset just past the parameter name. */
  parameterEnd: number;
}

// Route facade methods whose FIRST positional argument is a URI path string.
// These are the only ones that can contain a `{param}` literal segment.
const laravelUriRouteMethods = new Set([
  "any",
  "delete",
  "fallback",
  "get",
  "match",
  "options",
  "patch",
  "permanentredirect",
  "post",
  "put",
  "redirect",
  "view",
]);

interface PhpStringLiteral {
  quote: "'" | "\"";
  quoteStart: number;
  quoteEnd: number;
  value: string;
}

/**
 * Returns the route-model-binding parameter when `offset` lies inside a
 * `{param}` token of a `Route::<verb>(...)` URI string, otherwise `null`.
 */
export function detectLaravelRouteModelBindingAt(
  source: string,
  offset: number,
): LaravelRouteModelBindingParameter | null {
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const parameter = routeParameterTokenAt(source, literal, offset);

  if (!parameter) {
    return null;
  }

  const openParen = enclosingCallOpenParenFor(source, literal.quoteStart);

  if (openParen === null) {
    return null;
  }

  if (!isFirstPositionalArgumentLiteral(source, openParen, literal.quoteStart)) {
    return null;
  }

  if (!isUriRouteCall(source, openParen)) {
    return null;
  }

  const modelShortName = laravelRouteParameterModelShortName(
    parameter.parameterName,
  );

  if (!modelShortName) {
    return null;
  }

  return {
    modelShortName,
    parameterName: parameter.parameterName,
    parameterEnd: parameter.parameterEnd,
    parameterStart: parameter.parameterStart,
  };
}

/**
 * Returns the ordered model-namespace prefixes (each ending in `\`) to try when
 * resolving an implicit route-binding model, derived from the project's PSR-4
 * roots. The app root namespace (the PSR-4 root mapping `app/`) yields the
 * modern `<App>\Models\` location first, then the legacy flat `<App>\` one.
 *
 * Falls back to Laravel's default `App\Models\` + `App\` when no `app/` PSR-4
 * root is configured, so navigation still works on a stock skeleton.
 */
export function phpModelNamespacePrefixes(
  descriptor: PhpProjectDescriptorLike | null | undefined,
): string[] {
  const prefixes: string[] = [];
  const seen = new Set<string>();

  const addPrefix = (prefix: string): void => {
    const normalized = `${prefix.replace(/\\+$/, "")}\\`;
    const key = normalized.toLowerCase();

    if (seen.has(key)) {
      return;
    }

    seen.add(key);
    prefixes.push(normalized);
  };

  for (const root of appPsr4Roots(descriptor?.psr4Roots ?? [])) {
    const rootNamespace = root.namespace.replace(/\\+$/, "");

    if (!rootNamespace) {
      continue;
    }

    addPrefix(`${rootNamespace}\\Models`);
    addPrefix(rootNamespace);
  }

  addPrefix("App\\Models");
  addPrefix("App");

  return prefixes;
}

/**
 * Returns PSR-4 roots whose first path targets the application source directory
 * (`app/`), ordered so the most specific path wins. These carry the app root
 * namespace under which Eloquent models live.
 */
function appPsr4Roots(roots: readonly Psr4RootLike[]): Psr4RootLike[] {
  return roots.filter((root) =>
    root.paths.some((path) => /^app\/?$/.test(path.replace(/^\.\//, "").trim())),
  );
}

/**
 * Maps a raw route parameter name to its Studly-cased model short name, or
 * `null` when the name cannot map to a model (empty / non-identifier / wildcard
 * `_` placeholder). Laravel uses `Str::studly($name)` — it does NOT change the
 * number, so `{user}` → `User` and `{blogPost}` → `BlogPost`. Only `_` acts as a
 * word boundary here; route parameter names cannot contain `-` or spaces.
 */
export function laravelRouteParameterModelShortName(
  parameterName: string,
): string | null {
  const segments = parameterName.split(/_+/).filter(Boolean);

  if (segments.length === 0) {
    return null;
  }

  const studly = segments
    .map((segment) => `${segment.charAt(0).toUpperCase()}${segment.slice(1)}`)
    .join("");

  return /^[A-Za-z][A-Za-z0-9]*$/.test(studly) ? studly : null;
}

/**
 * Returns the `{param}` token that `offset` falls inside, scoped to the literal
 * value. Strips an optional `?` suffix and a `:field` custom-key suffix — the
 * parameter NAME is what binds to the model. `null` when the offset is not in a
 * `{...}` token or the token is not a single bare parameter.
 */
function routeParameterTokenAt(
  source: string,
  literal: PhpStringLiteral,
  offset: number,
): { parameterName: string; parameterStart: number; parameterEnd: number } | null {
  const valueStart = literal.quoteStart + 1;
  const open = source.lastIndexOf("{", offset);

  if (open < valueStart) {
    return null;
  }

  const close = source.indexOf("}", open);

  if (close < 0 || close >= literal.quoteEnd || offset > close) {
    return null;
  }

  // A bare `{...}` token must not contain a nested `{` between open and close
  // (defensive against malformed input).
  const inner = source.slice(open + 1, close);

  if (inner.includes("{")) {
    return null;
  }

  // Split off the optional marker and the custom-key field: `{user:slug}` and
  // `{user?}` both bind the `user` parameter.
  const nameMatch = /^([A-Za-z_][A-Za-z0-9_]*)/.exec(inner);

  if (!nameMatch?.[1]) {
    return null;
  }

  const parameterStart = open + 1;
  const parameterEnd = parameterStart + nameMatch[1].length;

  // Only treat the cursor as on the parameter when it is within the name part
  // (not the `:field` / `?` tail) — keeps navigation targeting the model name.
  if (offset < parameterStart || offset > parameterEnd) {
    return null;
  }

  return {
    parameterEnd,
    parameterName: nameMatch[1],
    parameterStart,
  };
}

/**
 * True when the call whose `(` lives at `openParen` is a `Route::<verb>(...)`
 * call whose verb accepts a URI path as its first argument.
 */
function isUriRouteCall(source: string, openParen: number): boolean {
  if (source[openParen] !== "(" || !isPhpCodeOffset(source, openParen)) {
    return false;
  }

  const beforeParen = source.slice(0, openParen);
  const match = /Route\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeParen);

  if (!match?.[1]) {
    return false;
  }

  return laravelUriRouteMethods.has(match[1].toLowerCase());
}

/**
 * Finds the `(` of the innermost call whose argument list directly contains the
 * literal that starts at `quoteStart`. Returns `null` when the literal is not a
 * direct top-level argument of any call (e.g. nested in an array).
 */
function enclosingCallOpenParenFor(
  source: string,
  quoteStart: number,
): number | null {
  for (
    let openParen = source.lastIndexOf("(", quoteStart);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    if (!isPhpCodeOffset(source, openParen)) {
      continue;
    }

    const closeParen = matchingParenOffset(source, openParen);

    if (closeParen !== null && quoteStart > closeParen) {
      continue;
    }

    if (isTopLevelBetween(source, openParen + 1, quoteStart)) {
      return openParen;
    }
  }

  return null;
}

/**
 * True when the literal at `quoteStart` is the bare positional first argument of
 * the call whose `(` lives at `openParen` — rejects later arguments and
 * named-argument prefixes (`uri: '...'`).
 */
function isFirstPositionalArgumentLiteral(
  source: string,
  openParen: number,
  quoteStart: number,
): boolean {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openParen + 1; index < quoteStart; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      return false;
    }

    if (character === ":" && depth === 0 && source[index + 1] !== ":") {
      return false;
    }
  }

  return /^\s*$/.test(source.slice(openParen + 1, quoteStart));
}

/**
 * True when no unbalanced bracket sits between `startOffset` and `endOffset`.
 */
function isTopLevelBetween(
  source: string,
  startOffset: number,
  endOffset: number,
): boolean {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = startOffset; index < endOffset; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;

      if (depth < 0) {
        return false;
      }
    }
  }

  return depth === 0;
}

/**
 * Returns the string literal that contains `offset`, or `null` when `offset` is
 * not inside a single/double quoted literal. Double-quoted literals with PHP
 * variable interpolation are rejected (conservative — the value is dynamic).
 */
function stringLiteralAtOffset(
  source: string,
  offset: number,
): PhpStringLiteral | null {
  let quote: "'" | "\"" | null = null;
  let quoteStart = -1;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }

      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset <= index) {
        return buildLiteral(source, quote, quoteStart, index);
      }

      quote = null;
      quoteStart = -1;
      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && next !== "[") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      quoteStart = index;
    }
  }

  if (!quote || offset <= quoteStart) {
    return null;
  }

  return buildLiteral(source, quote, quoteStart, source.length);
}

function buildLiteral(
  source: string,
  quote: "'" | "\"",
  quoteStart: number,
  quoteEnd: number,
): PhpStringLiteral | null {
  const value = source.slice(quoteStart + 1, quoteEnd);

  if (quote === "\"" && hasPhpVariableInterpolation(value)) {
    return null;
  }

  return { quote, quoteEnd, quoteStart, value };
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$(?:[A-Za-z_]|[{])/.test(value);
}

/**
 * True when `offset` is in plain PHP code — not inside a string literal, line
 * comment, or block comment.
 */
function isPhpCodeOffset(source: string, offset: number): boolean {
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }

      continue;
    }

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && next !== "[") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !quote && !lineComment && !blockComment;
}

/** Returns the offset of the `)` matching the `(` at `openOffset`, or `null`. */
function matchingParenOffset(source: string, openOffset: number): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

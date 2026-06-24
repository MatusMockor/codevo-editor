/**
 * Pure detection of Laravel global string-helper calls.
 *
 * This module answers a single question: is a given offset inside the FIRST
 * string-literal argument of one of the Laravel global helpers
 * (`config`, `route`, `view`, `__`, `trans`, `trans_choice`, `env`)?
 *
 * It deliberately stays conservative — it only recognises the GLOBAL helper
 * function form (`config(...)`, optionally with a leading namespace separator
 * `\config(...)`). It intentionally does NOT recognise:
 *   - method calls (`$x->config(...)`)
 *   - static / facade calls (`Config::get(...)`)
 *   - helpers appearing inside comments or other string literals
 * Resolution of the literal to a concrete config / lang / view file or key is
 * out of scope and handled by the navigation / completion integration layers.
 */

export type LaravelStringLiteralHelper =
  | "config"
  | "route"
  | "view"
  | "trans"
  | "env";

export interface LaravelStringLiteralHelperMatch {
  helper: LaravelStringLiteralHelper;
  literal: string;
  literalStart: number;
  literalEnd: number;
}

interface PhpStringLiteral {
  quote: "'" | "\"";
  /** Offset of the opening quote character. */
  quoteStart: number;
  /** Offset of the closing quote character (or `source.length` if unclosed). */
  quoteEnd: number;
  /** Literal text between the quotes. */
  value: string;
}

const helperNameMap: Readonly<Record<string, LaravelStringLiteralHelper>> = {
  config: "config",
  route: "route",
  view: "view",
  __: "trans",
  trans: "trans",
  trans_choice: "trans",
  env: "env",
};

/**
 * Returns the helper match when `offset` lies inside the first string-literal
 * argument of a recognised Laravel global helper call, otherwise `null`.
 */
export function detectLaravelStringLiteralHelper(
  source: string,
  offset: number,
): LaravelStringLiteralHelperMatch | null {
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const openParen = enclosingCallOpenParenFor(source, literal.quoteStart);

  if (openParen === null) {
    return null;
  }

  if (!isFirstArgumentLiteral(source, openParen, literal.quoteStart)) {
    return null;
  }

  const helper = laravelHelperAtCall(source, openParen);

  if (!helper) {
    return null;
  }

  return {
    helper,
    literal: literal.value,
    literalStart: literal.quoteStart + 1,
    literalEnd: literal.quoteEnd,
  };
}

/**
 * Returns the normalised helper name for a global helper call whose `(` lives at
 * `openParen`, or `null` when the call is not a recognised global helper.
 */
export function laravelHelperAtCall(
  source: string,
  openParen: number,
): LaravelStringLiteralHelper | null {
  if (source[openParen] !== "(" || !isPhpCodeOffset(source, openParen)) {
    return null;
  }

  const beforeParen = source.slice(0, openParen);
  const nameMatch = /([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(beforeParen);

  if (!nameMatch?.[1]) {
    return null;
  }

  const helper = helperNameMap[nameMatch[1]];

  if (!helper) {
    return null;
  }

  return isGlobalCallName(source, nameMatch.index) ? helper : null;
}

const callSiteBlockingKeywords: ReadonlySet<string> = new Set([
  "function",
  "fn",
]);

/**
 * A name at `nameStart` is a global function call only when it is not preceded
 * by an object operator (`->`), a static operator (`::`), a variable sigil
 * (`$`), or another identifier character. A single leading namespace separator
 * (`\`) is allowed (`\config(...)`). A preceding `function`/`fn` keyword marks a
 * declaration, not a call, so it is rejected.
 */
function isGlobalCallName(source: string, nameStart: number): boolean {
  const before = source.slice(0, nameStart).replace(/\\$/, "");
  const previous = before.slice(-1);

  if (before.endsWith("->") || before.endsWith("::")) {
    return false;
  }

  if (previous !== "" && /[A-Za-z0-9_$]/.test(previous)) {
    return false;
  }

  const keywordMatch = /([A-Za-z_][A-Za-z0-9_]*)\s+$/.exec(before);

  if (keywordMatch?.[1] && callSiteBlockingKeywords.has(keywordMatch[1])) {
    return false;
  }

  return true;
}

/**
 * Finds the `(` of the innermost call whose argument list directly contains the
 * literal that starts at `quoteStart`. Returns `null` when the literal is not a
 * direct top-level argument of any call (e.g. it sits inside a nested array).
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
 * Returns true when the literal at `quoteStart` is the bare positional first
 * argument of the call whose `(` lives at `openParen`. Rejects any literal that
 * follows a top-level comma (later argument) or a named-argument prefix
 * (`name: 'literal'`) — conservatively, only `helper('literal')` matches.
 */
function isFirstArgumentLiteral(
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
 * Returns true when no unbalanced bracket sits between `startOffset` and
 * `endOffset` — i.e. `endOffset` is at the same nesting depth as `startOffset`.
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
 * Returns the string literal that contains `offset`, or `null` when `offset`
 * is not inside a single/double quoted literal. Double-quoted literals with
 * PHP variable interpolation are rejected (conservative — the value is dynamic).
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
 * Returns true when `offset` is in plain PHP code — not inside a string literal,
 * line comment, or block comment.
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

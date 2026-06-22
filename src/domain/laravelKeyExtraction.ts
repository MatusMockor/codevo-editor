/**
 * Pure, framework-agnostic extraction of dot-notation key paths from the
 * CONTENTS of a Laravel `config/*.php` / `lang/*.php` array file, plus flat
 * key extraction from a JSON language file.
 *
 * These helpers exist to feed completion for `config()`, `__()`, `trans()`
 * etc. They take the file CONTENT (a string) only — no filesystem access — and
 * are intentionally conservative: when the input cannot be parsed (truncated,
 * dynamically-built arrays, …) they return whatever was parsed so far rather
 * than throwing.
 *
 * Parsing strategy:
 *  - A single masking pass blanks out string literals and comments (replacing
 *    them with spaces, preserving offsets/newlines). Brackets, `=>` tokens and
 *    quote characters that live inside values or comments therefore cannot be
 *    mistaken for structure. See `maskPhpStringsAndComments`.
 *  - Structure (the `return [ ... ]` / `return array( ... )` literal, nested
 *    associative arrays, `=>` separators, balanced brackets) is located on the
 *    MASKED source, while the key literal text is read from the ORIGINAL
 *    source so that masking never corrupts the extracted key.
 *  - Only string keys (`'key' =>` / `"key" =>`) are emitted; numeric indexes,
 *    list entries, and purely-numeric string keys are skipped. Nested
 *    associative arrays produce every intermediate path so completion can
 *    offer partial keys.
 */

/**
 * Extract every dot-notation key path from a Laravel array file's content.
 *
 * Example: `return ['services' => ['stripe' => ['key' => '…']]]`
 * yields `["services", "services.stripe", "services.stripe.key"]`.
 *
 * Returns a de-duplicated, alphabetically sorted list. Best-effort: never
 * throws, returns what it could parse on malformed input.
 */
export function extractPhpArrayKeyPaths(phpArraySource: string): string[] {
  const masked = maskPhpStringsAndComments(phpArraySource);
  const rootOpen = locateReturnArrayOpen(masked);

  if (!rootOpen) {
    return [];
  }

  const paths = new Set<string>();
  collectArrayKeyPaths(phpArraySource, masked, rootOpen, [], paths, 0);

  return Array.from(paths).sort((left, right) => left.localeCompare(right));
}

/**
 * Extract top-level keys from a JSON language file's content
 * (`{ "key": "value" }` -> `["key"]`). Best-effort: returns `[]` for invalid
 * JSON or any non-object top-level value.
 */
export function extractFlatTranslationKeys(jsonSource: string): string[] {
  const parsed = parseJsonObject(jsonSource);

  if (!parsed) {
    return [];
  }

  return Object.keys(parsed).sort((left, right) => left.localeCompare(right));
}

interface PhpArrayOpen {
  close: ")" | "]";
  contentStart: number;
  open: "(" | "[";
  openOffset: number;
}

const maxArrayDepth = 16;

function parseJsonObject(jsonSource: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(jsonSource);

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  } catch {
    return null;
  }
}

function locateReturnArrayOpen(masked: string): PhpArrayOpen | null {
  const returnPattern = /\breturn\b/g;

  for (
    let match = returnPattern.exec(masked);
    match;
    match = returnPattern.exec(masked)
  ) {
    const afterReturn = skipWhitespace(masked, match.index + match[0].length);
    const arrayOpen = arrayOpenAt(masked, afterReturn);

    if (arrayOpen) {
      return arrayOpen;
    }
  }

  return null;
}

function collectArrayKeyPaths(
  source: string,
  masked: string,
  arrayOpen: PhpArrayOpen,
  prefix: string[],
  paths: Set<string>,
  depth: number,
): void {
  if (depth > maxArrayDepth) {
    return;
  }

  const closeOffset = matchingBracketOffset(
    masked,
    arrayOpen.openOffset,
    arrayOpen.open,
    arrayOpen.close,
  );
  const limit = closeOffset ?? masked.length;

  let index = arrayOpen.contentStart;

  while (index < limit) {
    index = skipWhitespace(masked, index, limit);

    if (index >= limit) {
      return;
    }

    index = collectEntry(source, masked, limit, index, prefix, paths, depth);
  }
}

function collectEntry(
  source: string,
  masked: string,
  limit: number,
  entryStart: number,
  prefix: string[],
  paths: Set<string>,
  depth: number,
): number {
  const key = stringKeyAt(source, masked, entryStart, limit);

  if (key) {
    return collectKeyedEntry(source, masked, limit, key, prefix, paths, depth);
  }

  // Non-string-keyed entry (list element or numeric key). It contributes no
  // path segment, but a nested associative array under it still does — so
  // recurse with the unchanged prefix when this entry is/holds an array.
  const nested = nestedArrayInEntry(masked, entryStart, limit);

  if (!nested) {
    return nextTopLevelEntry(masked, entryStart, limit);
  }

  collectArrayKeyPaths(source, masked, nested, prefix, paths, depth + 1);

  return nextTopLevelEntry(
    masked,
    closeOrEntryEnd(masked, nested, limit),
    limit,
  );
}

function collectKeyedEntry(
  source: string,
  masked: string,
  limit: number,
  key: PhpStringKey,
  prefix: string[],
  paths: Set<string>,
  depth: number,
): number {
  const valueStart = skipWhitespace(masked, key.arrowEnd, limit);
  const nested = arrayOpenAt(masked, valueStart);
  const keyPath = [...prefix, key.value];

  if (isEmittableKey(key.value)) {
    paths.add(keyPath.join("."));
  }

  if (!nested) {
    return nextTopLevelEntry(masked, key.arrowEnd, limit);
  }

  const childPrefix = isEmittableKey(key.value) ? keyPath : prefix;
  collectArrayKeyPaths(source, masked, nested, childPrefix, paths, depth + 1);

  return nextTopLevelEntry(
    masked,
    closeOrEntryEnd(masked, nested, limit),
    limit,
  );
}

function nestedArrayInEntry(
  masked: string,
  entryStart: number,
  limit: number,
): PhpArrayOpen | null {
  const direct = arrayOpenAt(masked, entryStart);

  if (direct) {
    return direct;
  }

  // Numeric key form: `0 => [ ... ]`. Look for a top-level `=>` before the
  // entry ends, then an array literal after it.
  const arrowOffset = topLevelArrowOffset(masked, entryStart, limit);

  if (arrowOffset === null) {
    return null;
  }

  const valueStart = skipWhitespace(masked, arrowOffset + 2, limit);

  return arrayOpenAt(masked, valueStart);
}

function topLevelArrowOffset(
  masked: string,
  offset: number,
  limit: number,
): number | null {
  let depth = 0;

  for (let index = offset; index < limit; index += 1) {
    const character = masked[index] ?? "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      return null;
    }

    if (depth === 0 && character === "=" && masked[index + 1] === ">") {
      return index;
    }
  }

  return null;
}

function closeOrEntryEnd(
  masked: string,
  nested: PhpArrayOpen,
  limit: number,
): number {
  const nestedClose = matchingBracketOffset(
    masked,
    nested.openOffset,
    nested.open,
    nested.close,
  );

  return nestedClose === null ? limit : nestedClose + 1;
}

interface PhpStringKey {
  arrowEnd: number;
  value: string;
}

function stringKeyAt(
  source: string,
  masked: string,
  offset: number,
  limit: number,
): PhpStringKey | null {
  const quote = source[offset];

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  const closingQuote = maskedStringCloseOffset(masked, offset, limit);

  if (closingQuote === null) {
    return null;
  }

  const arrowStart = skipWhitespace(masked, closingQuote + 1, limit);

  if (masked.slice(arrowStart, arrowStart + 2) !== "=>") {
    return null;
  }

  return {
    arrowEnd: arrowStart + 2,
    value: unescapePhpKeyLiteral(source.slice(offset + 1, closingQuote), quote),
  };
}

function unescapePhpKeyLiteral(raw: string, quote: "'" | "\""): string {
  // The masking pass already guaranteed the body has no unescaped closing
  // quote; here we only need to collapse the escape sequences PHP honours for
  // the quote character and the backslash itself so the extracted key matches
  // the runtime value (e.g. `a\'b` -> `a'b`).
  return raw.replace(/\\(.)/g, (match, escaped) =>
    escaped === quote || escaped === "\\" ? escaped : match,
  );
}

function maskedStringCloseOffset(
  masked: string,
  quoteOffset: number,
  limit: number,
): number | null {
  // The masking pass blanks the body of a string literal to spaces while
  // keeping the opening quote intact; the next quote character of the same
  // kind therefore marks the close.
  const quote = masked[quoteOffset];

  for (let index = quoteOffset + 1; index < limit; index += 1) {
    if (masked[index] === quote) {
      return index;
    }
  }

  return null;
}

function isEmittableKey(value: string): boolean {
  return value.length > 0 && !/^-?\d+$/.test(value);
}

function arrayOpenAt(masked: string, offset: number): PhpArrayOpen | null {
  if (masked[offset] === "[") {
    return {
      close: "]",
      contentStart: offset + 1,
      open: "[",
      openOffset: offset,
    };
  }

  const match = /^array\b\s*\(/i.exec(masked.slice(offset));

  if (!match) {
    return null;
  }

  const openOffset = offset + match[0].lastIndexOf("(");

  return {
    close: ")",
    contentStart: openOffset + 1,
    open: "(",
    openOffset,
  };
}

function nextTopLevelEntry(
  masked: string,
  offset: number,
  limit: number,
): number {
  let depth = 0;

  for (let index = offset; index < limit; index += 1) {
    const character = masked[index] ?? "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      return index + 1;
    }
  }

  return limit;
}

function skipWhitespace(masked: string, offset: number, limit?: number): number {
  const end = limit ?? masked.length;
  let index = offset;

  while (index < end && /\s/.test(masked[index] ?? "")) {
    index += 1;
  }

  return index;
}

function matchingBracketOffset(
  masked: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index] ?? "";

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character !== close) {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

/**
 * Replace the body of every PHP string literal and comment with spaces while
 * preserving offsets, newlines, and the opening/closing quote characters of
 * string literals. Adapted from `phpClassStructure.ts`; kept self-contained so
 * this module stays a pure leaf with no cross-domain coupling.
 *
 * Difference from that helper: opening/closing quotes are KEPT (not blanked)
 * so callers can still locate string-key boundaries on the masked source.
 */
function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let heredocTerminator: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let attributeDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (attributeDepth > 0) {
      if (character === "[") {
        attributeDepth += 1;
      }

      if (character === "]") {
        attributeDepth -= 1;
      }

      output += character === "\n" ? "\n" : " ";
      continue;
    }

    if (heredocTerminator !== null) {
      const closing = heredocClosingLength(source, index, heredocTerminator);

      if (closing > 0) {
        output += " ".repeat(closing);
        index += closing - 1;
        heredocTerminator = null;
        continue;
      }

      output += character === "\n" ? "\n" : " ";
      continue;
    }

    if (inLineComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "\n") {
        inLineComment = false;
      }

      continue;
    }

    if (inBlockComment) {
      output += character === "\n" ? "\n" : " ";

      if (character === "*" && next === "/") {
        output += " ";
        index += 1;
        inBlockComment = false;
      }

      continue;
    }

    if (quote) {
      if (character === quote) {
        output += character;
        quote = null;
        continue;
      }

      if (character === "\\") {
        output += "  ";
        index += 1;
        continue;
      }

      output += character === "\n" ? "\n" : " ";
      continue;
    }

    if (character === "#" && next === "[") {
      output += "  ";
      index += 1;
      attributeDepth = 1;
      continue;
    }

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#") {
      output += " ";
      inLineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      output += "  ";
      index += 1;
      inBlockComment = true;
      continue;
    }

    const heredocStart = heredocOpening(source, index);

    if (heredocStart) {
      output += " ".repeat(heredocStart.length);
      index += heredocStart.length - 1;
      heredocTerminator = heredocStart.terminator;
      continue;
    }

    if (character === "'" || character === "\"") {
      output += character;
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
}

function heredocOpening(
  source: string,
  index: number,
): { length: number; terminator: string } | null {
  if (source.slice(index, index + 3) !== "<<<") {
    return null;
  }

  const match = /^<<<[ \t]*(["']?)([A-Za-z_][A-Za-z0-9_]*)\1[ \t]*\r?\n/.exec(
    source.slice(index),
  );
  const terminator = match?.[2];

  if (!match || !terminator) {
    return null;
  }

  return { length: match[0].length, terminator };
}

function heredocClosingLength(
  source: string,
  index: number,
  terminator: string,
): number {
  if (source[index - 1] !== "\n") {
    return 0;
  }

  const match = new RegExp(`^[ \\t]*${terminator}\\b`).exec(source.slice(index));

  if (!match) {
    return 0;
  }

  const leadingWhitespace = match[0].length - terminator.length;

  return leadingWhitespace + terminator.length;
}

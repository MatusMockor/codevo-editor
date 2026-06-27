/**
 * Pure positional helpers for OOP code generation (e.g. "implement interface
 * methods"). Given a PHP source string, these functions find the OFFSET where
 * generated code should be spliced in:
 *
 *  - `findClassBodyInsertionOffset` — just before the closing `}` of a class
 *    body, so new method stubs can be appended to the class.
 *  - `findUseImportInsertionOffset` — after the last top-level `use ...;` import
 *    (or namespace / `<?php` opener as a fallback), so new imports can be added.
 *  - `offsetToPosition` — 0-based line/column conversion for Monaco.
 *
 * Robustness over cleverness: brace matching is done with a balanced-pair scan
 * over a MASKED copy of the source (strings, comments, heredoc/nowdoc and
 * attributes blanked out) so braces inside literals never derail the scan. When
 * the structure cannot be resolved confidently (unbalanced braces, parse fail)
 * the functions return `null` — better to do nothing than to splice code into
 * the wrong place.
 */

export interface ClassBodyInsertionPoint {
  needsLeadingBlankLine: boolean;
  needsTrailingBlankLine: boolean;
  offset: number;
}

export interface UseImportInsertionPoint {
  needsLeadingNewline: boolean;
  offset: number;
}

export interface SourcePosition {
  column: number;
  line: number;
}

/**
 * Builds a fresh `class|interface|trait|enum` declaration matcher. A new
 * instance is returned per call so the stateful `lastIndex` of the global
 * (`/g`) regex is never shared between functions — keeping each scan pure.
 */
function classDeclarationPattern(): RegExp {
  return /\b(?:abstract\s+|final\s+|readonly\s+)*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
}

export function findClassBodyInsertionOffset(
  source: string,
  className?: string,
): ClassBodyInsertionPoint | null {
  const masked = maskPhpStringsAndComments(source);
  const body = locateClassBody(masked, className);

  if (!body) {
    return null;
  }

  return {
    needsLeadingBlankLine: bodyHasMembers(masked, body),
    needsTrailingBlankLine: !closingBraceOnOwnLine(masked, body.bodyEnd),
    offset: body.bodyEnd,
  };
}

export function findUseImportInsertionOffset(
  source: string,
): UseImportInsertionPoint | null {
  const masked = maskPhpStringsAndComments(source);

  if (!masked.includes("<?php")) {
    return null;
  }

  const boundary = topLevelClassOffset(masked);
  const lastUse = lastTopLevelUseEnd(masked, boundary);

  if (lastUse !== null) {
    return { needsLeadingNewline: false, offset: lastUse };
  }

  const namespaceEnd = namespaceStatementEnd(masked, boundary);

  if (namespaceEnd !== null) {
    return { needsLeadingNewline: true, offset: namespaceEnd };
  }

  const openTagEnd = openTagOffset(masked);

  if (openTagEnd === null) {
    return null;
  }

  return { needsLeadingNewline: true, offset: openTagEnd };
}

/**
 * PhpStorm indents generated class members to the class's own member level. We
 * fall back to four spaces (the PSR-12 default) only when the class has no
 * member to learn the style from - generators that splice members (getters /
 * setters, constructors, create-from-usage) always run on a class that already
 * has at least one property/method, so the detected style normally wins.
 */
const DEFAULT_MEMBER_INDENT = "    ";

/**
 * Returns the leading whitespace (spaces or tabs) of the FIRST member line in
 * the class body - i.e. the indentation a freshly generated member should adopt
 * so it lines up with the existing ones. Comments / docblocks above the first
 * real member are skipped (they are blanked in the masked copy), so a class that
 * opens with a `/** @var *\/` docblock still reports the property's own indent.
 * Returns {@link DEFAULT_MEMBER_INDENT} when the class cannot be located or has
 * no members.
 */
export function detectClassMemberIndent(
  source: string,
  className?: string,
): string {
  const masked = maskPhpStringsAndComments(source);
  const body = locateClassBody(masked, className);

  if (!body) {
    return DEFAULT_MEMBER_INDENT;
  }

  return firstMemberIndent(source, masked, body) ?? DEFAULT_MEMBER_INDENT;
}

/**
 * Prefixes `indent` to every NON-EMPTY line of `block`, preserving blank
 * separator lines as-is (so a column-0 rendered member block is shifted to the
 * class member indentation level without dragging trailing whitespace onto the
 * blank lines between members). An empty `indent` returns the block unchanged.
 */
export function indentLines(block: string, indent: string): string {
  if (indent.length === 0) {
    return block;
  }

  return block
    .split("\n")
    .map((line) => (line.length === 0 ? line : `${indent}${line}`))
    .join("\n");
}

function firstMemberIndent(
  source: string,
  masked: string,
  body: ClassBody,
): string | null {
  let lineStart = body.bodyStart + 1;

  for (let index = body.bodyStart + 1; index <= body.bodyEnd; index += 1) {
    if (index !== body.bodyEnd && masked[index] !== "\n") {
      continue;
    }

    if (masked.slice(lineStart, index).trim().length > 0) {
      const leading = /^[ \t]*/.exec(source.slice(lineStart, index));

      return leading?.[0] ?? "";
    }

    lineStart = index + 1;
  }

  return null;
}

export function offsetToPosition(
  source: string,
  offset: number,
): SourcePosition {
  const clamped = Math.max(0, Math.min(offset, source.length));
  let line = 0;
  let lineStart = 0;

  for (let index = 0; index < clamped; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      lineStart = index + 1;
    }
  }

  return { column: clamped - lineStart, line };
}

interface ClassBody {
  bodyEnd: number;
  bodyStart: number;
}

function locateClassBody(
  masked: string,
  className: string | undefined,
): ClassBody | null {
  const pattern = classDeclarationPattern();

  for (
    let match = pattern.exec(masked);
    match;
    match = pattern.exec(masked)
  ) {
    const name = match[2];

    if (!name) {
      continue;
    }

    if (className && name !== className) {
      continue;
    }

    const body = classBodyFromDeclaration(masked, match.index ?? 0, name);

    if (body) {
      return body;
    }
  }

  return null;
}

function classBodyFromDeclaration(
  masked: string,
  matchOffset: number,
  name: string,
): ClassBody | null {
  const nameOffset = masked.indexOf(name, matchOffset);

  if (nameOffset < 0) {
    return null;
  }

  const bodyStart = masked.indexOf("{", nameOffset + name.length);

  if (bodyStart < 0) {
    return null;
  }

  const bodyEnd = matchingBraceOffset(masked, bodyStart);

  if (bodyEnd === null) {
    return null;
  }

  return { bodyEnd, bodyStart };
}

function bodyHasMembers(masked: string, body: ClassBody): boolean {
  const between = masked.slice(body.bodyStart + 1, body.bodyEnd);

  return between.trim().length > 0;
}

function closingBraceOnOwnLine(masked: string, braceOffset: number): boolean {
  for (let index = braceOffset - 1; index >= 0; index -= 1) {
    const character = masked[index] || "";

    if (character === "\n") {
      return true;
    }

    if (!isHorizontalWhitespace(character)) {
      return false;
    }
  }

  return true;
}

function isHorizontalWhitespace(character: string): boolean {
  return character === " " || character === "\t" || character === "\r";
}

function topLevelClassOffset(masked: string): number {
  const match = classDeclarationPattern().exec(masked);

  if (!match) {
    return masked.length;
  }

  return match.index ?? masked.length;
}

function lastTopLevelUseEnd(masked: string, boundary: number): number | null {
  const pattern = /^[ \t]*use\b[^;]*;/gm;
  let result: number | null = null;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < boundary;
    match = pattern.exec(masked)
  ) {
    const statementEnd = (match.index ?? 0) + match[0].length;
    result = lineEndAfter(masked, statementEnd);
  }

  return result;
}

function namespaceStatementEnd(
  masked: string,
  boundary: number,
): number | null {
  const pattern = /^[ \t]*namespace\b[^;{]*;/gm;
  const match = pattern.exec(masked);

  if (!match || (match.index ?? 0) >= boundary) {
    return null;
  }

  return lineEndAfter(masked, (match.index ?? 0) + match[0].length);
}

function openTagOffset(masked: string): number | null {
  const index = masked.indexOf("<?php");

  if (index < 0) {
    return null;
  }

  return lineEndAfter(masked, index + "<?php".length);
}

function lineEndAfter(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);

  if (newline < 0) {
    return source.length;
  }

  return newline + 1;
}

function matchingBraceOffset(masked: string, openOffset: number): number | null {
  if (masked[openOffset] !== "{") {
    return null;
  }

  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character !== "}") {
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
 * Returns a copy of `source` where the bytes inside strings, comments,
 * heredoc/nowdoc bodies and `#[...]` attributes are replaced with spaces (and
 * newlines preserved), so braces/semicolons inside literals never confuse the
 * balanced scans above. Offsets in the masked string map 1:1 to the original.
 */
function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let heredocTerminator: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  let attributeDepth = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

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
      output += character === "\n" ? "\n" : " ";

      if (character === "\\" && quote !== "`") {
        output += next === "\n" ? "\n" : " ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

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

    if (character === "#" && source[index - 1] !== "$") {
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

    if (character === "'" || character === '"' || character === "`") {
      output += " ";
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

/**
 * Pure analysis for the "Import class" / "Add missing import" quickfix on PHP
 * sources (PhpStorm Alt+Enter -> Import).
 *
 * Responsibilities:
 *  - {@link phpShortNameIsImported}: tell whether a short class name is already
 *    brought into scope by a top-level `use` import (plain, aliased or grouped),
 *    so an already-imported reference is never offered an import.
 *  - {@link phpCurrentNamespace}: the file's declared namespace (or `null` for
 *    the global namespace), so a candidate that already lives in the current
 *    namespace can be skipped (no `use` is required).
 *  - {@link planPhpAddImport}: compute a zero-length insertion (offset + text)
 *    that adds `use FQN;` into the existing top-level `use` block in alphabetical
 *    order, or starts a fresh block after the namespace / opener when none
 *    exists.
 *
 * Conservative contract: every scan runs over a MASKED copy of the source
 * (strings, comments, heredoc/nowdoc and attributes blanked) and stops before
 * the first top-level type body opens, so a trait `use SomeTrait;` inside a
 * class body is never treated as an import. When the structure cannot be
 * resolved confidently the planner returns `null` (do nothing rather than splice
 * an import into the wrong place).
 */

import { findUseImportInsertionOffset } from "./phpInsertionPoint";

export interface PhpAddImportPlan {
  offset: number;
  text: string;
}

interface ParsedTopLevelUse {
  /** Short identifier the symbol is referenced by (alias or last segment). */
  alias: string;
  /** Fully qualified name without leading backslash. */
  fqn: string;
  /** Offset of the start of the statement's line in the original source. */
  lineStart: number;
  /** Offset just past the statement's terminating newline in the source. */
  lineEnd: number;
  /** Sort key: FQN, lower-cased. */
  sortKey: string;
}

export function phpShortNameIsImported(
  source: string,
  shortName: string,
): boolean {
  const normalized = shortName.trim().replace(/^\\+/, "");

  if (!normalized) {
    return false;
  }

  const target = normalized.toLowerCase();

  return classUseImports(source).some((use) => use.alias.toLowerCase() === target);
}

export function phpCurrentNamespace(source: string): string | null {
  const masked = maskPhpStringsAndComments(source);
  const match = /^[ \t]*namespace\s+([^;{]+)[;{]/m.exec(masked);
  const namespace = match?.[1]?.trim().replace(/^\\+/, "");

  return namespace || null;
}

export function planPhpAddImport(
  source: string,
  fqn: string,
): PhpAddImportPlan | null {
  const normalizedFqn = fqn.trim().replace(/^\\+/, "");

  if (!normalizedFqn) {
    return null;
  }

  const target = normalizedFqn.toLowerCase();
  const imports = classUseImports(source);

  if (imports.some((use) => use.fqn.toLowerCase() === target)) {
    return null;
  }

  if (imports.length === 0) {
    return planFreshUseBlock(source, normalizedFqn);
  }

  return planSortedInsertion(imports, normalizedFqn);
}

function planFreshUseBlock(
  source: string,
  fqn: string,
): PhpAddImportPlan | null {
  const insertionPoint = findUseImportInsertionOffset(source);

  if (!insertionPoint) {
    return null;
  }

  const leadingNewline = insertionPoint.needsLeadingNewline ? "\n" : "";

  return {
    offset: insertionPoint.offset,
    text: `${leadingNewline}use ${fqn};\n`,
  };
}

function planSortedInsertion(
  imports: readonly ParsedTopLevelUse[],
  fqn: string,
): PhpAddImportPlan {
  const sortKey = fqn.toLowerCase();
  const successor = imports.find((use) => use.sortKey.localeCompare(sortKey) > 0);

  if (successor) {
    return { offset: successor.lineStart, text: `use ${fqn};\n` };
  }

  const last = imports[imports.length - 1];

  return { offset: last.lineEnd, text: `use ${fqn};\n` };
}

/**
 * Parses top-level `use` CLASS imports (skipping `use function` / `use const`)
 * that appear before the first type body opens. Grouped (`use App\{A, B};`) and
 * aliased (`use A\B as C;`) imports are expanded. Line spans are tracked so a
 * sorted insertion can splice a new statement onto its own line.
 */
function classUseImports(source: string): ParsedTopLevelUse[] {
  const masked = maskPhpStringsAndComments(source);
  const limit = firstTypeBodyOffset(masked);
  const imports: ParsedTopLevelUse[] = [];

  for (const match of masked.matchAll(/(^|\n)([ \t]*)use\b([^;]*);/g)) {
    const lineStart = (match.index ?? 0) + match[1].length;

    if (lineStart >= limit || !isTopLevelUseStatement(masked, lineStart)) {
      continue;
    }

    const body = (match[3] ?? "").trim();

    if (/^function\b/.test(body) || /^const\b/.test(body)) {
      continue;
    }

    const statementEnd = lineStart + (match[0].length - match[1].length);
    const lineEnd = lineEndAfter(source, statementEnd);

    for (const parsed of parsePhpClassUseBody(body)) {
      imports.push({ ...parsed, lineEnd, lineStart });
    }
  }

  return imports;
}

type ParsedSymbol = Pick<ParsedTopLevelUse, "alias" | "fqn" | "sortKey">;

export function parsePhpClassUseBody(body: string): ParsedSymbol[] {
  return splitTopLevelUseClauses(body).flatMap((clause) =>
    clause.includes("{")
      ? parseGroupedUse(clause)
      : nullableSymbol(parseSymbol(clause)),
  );
}

function nullableSymbol(symbol: ParsedSymbol | null): ParsedSymbol[] {
  return symbol ? [symbol] : [];
}

function splitTopLevelUseClauses(body: string): string[] {
  const clauses: string[] = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index] || "";

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    clauses.push(body.slice(start, index).trim());
    start = index + 1;
  }

  clauses.push(body.slice(start).trim());

  return clauses.filter((clause) => clause.length > 0);
}

function parseGroupedUse(body: string): ParsedSymbol[] {
  const match = /^(.*?)\{([\s\S]+)\}$/.exec(body.trim());
  const prefix = match?.[1]?.trim().replace(/\\+$/, "") ?? "";
  const members = match?.[2] ?? "";

  if (!prefix || !members) {
    return [];
  }

  return members
    .split(",")
    .map((member) => member.trim())
    .filter((member) => member.length > 0)
    .map((member) => parseSymbol(`${prefix}\\${member}`))
    .filter((entry): entry is ParsedSymbol => entry !== null);
}

function parseSymbol(symbol: string): ParsedSymbol | null {
  const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(symbol.trim());
  const fqn = (aliasMatch?.[1] ?? symbol).trim().replace(/^\\+/, "");

  if (!fqn) {
    return null;
  }

  const lastSegment = fqn.split("\\").pop() ?? fqn;
  const alias = aliasMatch?.[2]?.trim() || lastSegment;

  if (!alias) {
    return null;
  }

  return { alias, fqn, sortKey: fqn.toLowerCase() };
}

function firstTypeBodyOffset(masked: string): number {
  const match =
    /(?<![:\\$>A-Za-z0-9_])(?:abstract\s+|final\s+|readonly\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
      masked,
    );

  if (!match) {
    return masked.length;
  }

  const bodyStart = masked.indexOf("{", match.index + match[0].length);

  if (bodyStart < 0) {
    return masked.length;
  }

  return bodyStart + 1;
}

function isTopLevelUseStatement(masked: string, start: number): boolean {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < start && index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return braceDepth === 0 && parenDepth === 0;
}

function lineEndAfter(source: string, offset: number): number {
  const newline = source.indexOf("\n", offset);

  if (newline < 0) {
    return source.length;
  }

  return newline + 1;
}

/**
 * Masks PHP string literals, comments, attributes and heredocs by replacing
 * their contents with spaces (newlines preserved) so a `use`-looking token
 * inside them is never treated as a real import. Self-contained copy of the
 * masking strategy used elsewhere in the domain layer (kept local to respect
 * this module's write-scope); offsets map 1:1 to the original source.
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

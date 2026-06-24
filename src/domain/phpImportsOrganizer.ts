/**
 * Pure analysis for the "Optimize imports" code action on PHP sources.
 *
 * Responsibilities:
 *  - Parse top-level `use` statements (class imports, plus `use function` /
 *    `use const`, plus grouped `use App\{A, B};` and aliased `as`).
 *  - Conservatively detect UNUSED class imports and drop them.
 *  - Sort the survivors alphabetically (case-insensitive by FQN).
 *
 * Conservative contract: a false-negative (keeping an unused import) is always
 * preferred over a false-positive (removing an import that is actually used).
 * If a short name appears ANYWHERE in the code outside of comments/strings and
 * outside of the use block itself, the import is kept.
 *
 * `use function` and `use const` imports are preserved verbatim and never
 * removed (usage detection for free functions / constants is intentionally out
 * of scope to stay safe).
 */

export interface OrganizedPhpImports {
  changed: boolean;
  organizedUseBlock: string;
  removed: string[];
}

type UseKind = "class" | "function" | "const";

interface ParsedUse {
  /** Short identifier the symbol is referenced by (alias or last segment). */
  alias: string;
  /** Fully qualified name without leading backslash. */
  fqn: string;
  kind: UseKind;
  /** Canonical statement text, e.g. `use App\Foo as Bar;`. */
  statement: string;
  /** Sort key: FQN, lower-cased. */
  sortKey: string;
}

export function organizePhpImports(source: string): OrganizedPhpImports | null {
  const masked = maskPhpStringsAndComments(source);
  const statements = parseTopLevelUseStatements(masked);
  const uses = statements.flatMap((statement) =>
    parseUseStatement(statement.body),
  );

  if (uses.length === 0) {
    return null;
  }

  const usageHaystack = [
    blankUseStatements(masked, statements),
    phpDocTypeHaystack(source),
  ].join("\n");
  const kept: ParsedUse[] = [];
  const removed: string[] = [];

  for (const use of uses) {
    if (shouldKeep(use, usageHaystack)) {
      kept.push(use);
      continue;
    }

    removed.push(removedLabel(use));
  }

  const organizedUseBlock = kept
    .slice()
    .sort(compareUses)
    .map((use) => use.statement)
    .join("\n");

  return {
    changed: removed.length > 0,
    organizedUseBlock,
    removed,
  };
}

function shouldKeep(use: ParsedUse, usageHaystack: string): boolean {
  if (use.kind !== "class") {
    return true;
  }

  return identifierIsPresent(usageHaystack, use.alias);
}

function removedLabel(use: ParsedUse): string {
  const lastSegment = use.fqn.split("\\").pop() ?? use.fqn;

  if (use.alias === lastSegment) {
    return use.fqn;
  }

  return `${use.fqn} as ${use.alias}`;
}

function compareUses(a: ParsedUse, b: ParsedUse): number {
  return a.sortKey.localeCompare(b.sortKey);
}

function identifierIsPresent(haystack: string, identifier: string): boolean {
  const pattern = new RegExp(
    `(?<![\\\\A-Za-z0-9_$])${escapeRegExp(identifier)}(?![A-Za-z0-9_])`,
  );

  return pattern.test(haystack);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Collects identifiers from PHPDoc type tags (`@param`, `@return`, `@var`,
 * `@throws`) so a class referenced only in a docblock still counts as used.
 *
 * Conservative on purpose: it harvests every identifier-looking token from the
 * type portion of those tags (the part before the variable / description) so a
 * union/generic type such as `Foo|Bar` or `Collection<User>` keeps all members.
 */
function phpDocTypeHaystack(source: string): string {
  const tokens: string[] = [];

  for (const match of source.matchAll(
    /@(?:param|return|var|throws)\s+([^\r\n*]+)/g,
  )) {
    const typeExpression = stripDocDescription(match[1] ?? "");

    for (const token of typeExpression.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
      tokens.push(token[0]);
    }
  }

  return tokens.join(" ");
}

/** Keeps only the leading type expression, dropping `$var` and any prose. */
function stripDocDescription(value: string): string {
  const variableIndex = value.search(/\$[A-Za-z_]/);
  const typePart = variableIndex >= 0 ? value.slice(0, variableIndex) : value;

  return typePart.replace(/\s.*$/s, "");
}

/** A single top-level `use ...;` statement located in the masked source. */
interface UseStatement {
  body: string;
  end: number;
  start: number;
}

/**
 * Builds the text we scan for short-name usage: the masked source with the
 * `use` statement spans blanked out, so a `use` line can never mark itself
 * (or its neighbours) as "used".
 */
function blankUseStatements(
  masked: string,
  statements: readonly UseStatement[],
): string {
  let haystack = masked;

  for (const statement of statements) {
    const blanked = haystack
      .slice(statement.start, statement.end)
      .replace(/[^\n]/g, " ");

    haystack =
      haystack.slice(0, statement.start) +
      blanked +
      haystack.slice(statement.end);
  }

  return haystack;
}

function parseTopLevelUseStatements(masked: string): UseStatement[] {
  const limit = firstTypeBodyOffset(masked);
  const statements: UseStatement[] = [];

  for (const match of masked.matchAll(/(^|\n)([ \t]*)use\b([^;]*);/g)) {
    const start = (match.index ?? 0) + match[1].length;

    if (start >= limit || !isTopLevelUseStatement(masked, start)) {
      continue;
    }

    statements.push({
      body: match[3] ?? "",
      end: start + match[0].length - match[1].length,
      start,
    });
  }

  return statements;
}

/**
 * Bounds parsing to the source before the first top-level type body opens, so a
 * trait `use SomeTrait;` inside a class body is never treated as an import.
 */
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
  return braceDepthAt(masked, start) === 0 && !insideParens(masked, start);
}

function braceDepthAt(text: string, offset: number): number {
  let depth = 0;

  for (let index = 0; index < offset && index < text.length; index += 1) {
    const character = text[index];

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

function insideParens(text: string, offset: number): boolean {
  let depth = 0;

  for (let index = 0; index < offset && index < text.length; index += 1) {
    const character = text[index];

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth > 0;
}

function parseUseStatement(body: string): ParsedUse[] {
  const trimmed = body.trim();
  const kind = useKind(trimmed);
  const withoutKeyword = stripKindKeyword(trimmed, kind);

  if (withoutKeyword.includes("{")) {
    return parseGroupedUse(withoutKeyword, kind);
  }

  const single = parseSymbol(withoutKeyword, kind);

  return single ? [single] : [];
}

function useKind(body: string): UseKind {
  if (/^function\b/.test(body)) {
    return "function";
  }

  if (/^const\b/.test(body)) {
    return "const";
  }

  return "class";
}

function stripKindKeyword(body: string, kind: UseKind): string {
  if (kind === "function") {
    return body.replace(/^function\s+/, "").trim();
  }

  if (kind === "const") {
    return body.replace(/^const\s+/, "").trim();
  }

  return body;
}

function parseGroupedUse(body: string, kind: UseKind): ParsedUse[] {
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
    .map((member) => parseSymbol(`${prefix}\\${member}`, kind))
    .filter((entry): entry is ParsedUse => entry !== null);
}

function parseSymbol(symbol: string, kind: UseKind): ParsedUse | null {
  const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(symbol);
  const fqn = (aliasMatch?.[1] ?? symbol).trim().replace(/^\\+/, "");

  if (!fqn) {
    return null;
  }

  const lastSegment = fqn.split("\\").pop() ?? fqn;
  const alias = aliasMatch?.[2]?.trim() || lastSegment;

  if (!alias) {
    return null;
  }

  return {
    alias,
    fqn,
    kind,
    sortKey: fqn.toLowerCase(),
    statement: buildStatement(fqn, alias, lastSegment, kind),
  };
}

function buildStatement(
  fqn: string,
  alias: string,
  lastSegment: string,
  kind: UseKind,
): string {
  const prefix = statementPrefix(kind);
  const aliasSuffix = alias === lastSegment ? "" : ` as ${alias}`;

  return `${prefix}${fqn}${aliasSuffix};`;
}

function statementPrefix(kind: UseKind): string {
  if (kind === "function") {
    return "use function ";
  }

  if (kind === "const") {
    return "use const ";
  }

  return "use ";
}

/**
 * Masks PHP string literals, comments, attributes and heredocs by replacing
 * their contents with spaces (newlines preserved) so a class name appearing
 * inside them is never treated as a real usage.
 *
 * Self-contained copy of the masking strategy used elsewhere in the domain
 * layer (kept local to respect this module's write-scope).
 */
function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let heredocTerminator: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

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

    if (character === "/" && next === "/") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#" && next !== "[" && source[index - 1] !== "$") {
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

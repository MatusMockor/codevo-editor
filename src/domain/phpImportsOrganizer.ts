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
  /**
   * When true the statement is reproduced verbatim and never removed - used for
   * non-grouped comma lists (`use A, B;`) where splitting risks dropping a used
   * member, so we conservatively keep the whole statement untouched.
   */
  verbatim?: boolean;
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

/**
 * Applies "Optimize imports" to a whole PHP source string and returns the
 * rewritten source, or `null` when nothing should change.
 *
 * Reuses {@link organizePhpImports} for the analysis and replaces the exact span
 * of the existing top-level `use` block with the organized block. Conservative:
 * returns `null` when there is no top-level `use` block, when the rewrite would
 * not change anything, or when any non-whitespace content sits between the `use`
 * statements or trails the last one on its line (e.g. a stray comment) - so no
 * unrelated content is ever swallowed or relocated.
 *
 * This is the content-in / content-out variant used by format-on-save; the
 * Monaco-range variant lives next to the code-action provider.
 */
export function optimizePhpImportsSource(source: string): string | null {
  const organized = organizePhpImports(source);

  if (!organized) {
    return null;
  }

  const range = topLevelUseBlockRange(source);

  if (!range) {
    return null;
  }

  const optimized =
    source.slice(0, range.start) +
    organized.organizedUseBlock +
    source.slice(range.end);

  // Reordering alone (no removals) leaves `organized.changed` false, so compare
  // the rewritten source against the original to also catch sort-only changes -
  // a no-op when the block is already clean and sorted.
  if (optimized === source) {
    return null;
  }

  return optimized;
}

/**
 * Locates the contiguous span covering the existing top-level `use` statements:
 * from the start of the first `use` to the end of the last one (before the first
 * type body opens). Returns `null` when no top-level `use` is found or when the
 * gaps between statements are not whitespace-only (conservative guard).
 */
function topLevelUseBlockRange(
  source: string,
): { end: number; start: number } | null {
  const masked = maskPhpStringsAndComments(source);
  const statements = parseTopLevelUseStatements(masked);

  if (statements.length === 0) {
    return null;
  }

  for (let index = 1; index < statements.length; index += 1) {
    const gap = source.slice(statements[index - 1].end, statements[index].start);

    if (gap.trim().length > 0) {
      return null;
    }
  }

  const lastEnd = statements[statements.length - 1].end;

  // The block end stops at the final `use;` terminator, so anything trailing on
  // that same physical line (e.g. `use App\Foo; // note`) sits in the
  // after-block tail and would be re-attached to the wrong import. Bail out
  // rather than relocate it - conservative no-op over corruption.
  if (!trailingLineIsBlank(source, lastEnd)) {
    return null;
  }

  return {
    end: lastEnd,
    start: statements[0].start,
  };
}

/**
 * True when the remainder of the physical line starting at `offset` (up to the
 * next newline or end of source) holds nothing but whitespace.
 */
function trailingLineIsBlank(source: string, offset: number): boolean {
  const newlineIndex = source.indexOf("\n", offset);
  const lineRemainder =
    newlineIndex === -1
      ? source.slice(offset)
      : source.slice(offset, newlineIndex);

  return lineRemainder.trim().length === 0;
}

function shouldKeep(use: ParsedUse, usageHaystack: string): boolean {
  if (use.verbatim) {
    return true;
  }

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
 * Collects identifiers from PHPDoc tags so a class referenced only in a docblock
 * still counts as used.
 *
 * Two tag families are harvested:
 *  - "type-leading" tags (`@param`, `@return`, `@var`, `@throws`) where the type
 *    is the part before the `$var` / prose: only that leading type expression is
 *    harvested so a description mentioning a class never keeps an unused import.
 *  - "signature" tags (`@property`, `@property-read`, `@property-write`,
 *    `@method`, `@mixin`, `@see`) where class references can appear ANYWHERE in
 *    the tag body - e.g. `@property Type $x`, `@method Ret name(Arg $y)`,
 *    `@mixin Trait`, `@see Class::method`. For these, every identifier-looking
 *    token in the whole tag body is harvested.
 *
 * Both are conservative: harvesting can only ADD survivors (keep imports), never
 * remove one - in IDE/Laravel mode Eloquent magic `@property`/`@method`/`@mixin`
 * docblocks are pervasive and reference real, used imports.
 */
function phpDocTypeHaystack(source: string): string {
  return [
    leadingTypeTagHaystack(source),
    signatureTagHaystack(source),
  ].join(" ");
}

/**
 * Harvests identifiers from the leading TYPE portion of `@param`/`@return`/
 * `@var`/`@throws` (the part before any `$var` / description prose).
 */
function leadingTypeTagHaystack(source: string): string {
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

/**
 * Harvests EVERY identifier-looking token from `@property*`/`@method`/`@mixin`/
 * `@see` tag bodies, since a class reference can sit anywhere in those tags
 * (return type, parameter type in a `@method` signature, mixin/see target).
 */
function signatureTagHaystack(source: string): string {
  const tokens: string[] = [];

  for (const match of source.matchAll(
    /@(?:property(?:-read|-write)?|method|mixin|see)\b([^\r\n*]*)/g,
  )) {
    for (const token of (match[1] ?? "").matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
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

  // A non-grouped comma list (`use A\B, A\C;`) is reproduced verbatim and never
  // dropped: splitting it would risk silently removing a USED member (the old
  // single-parse path baked the whole tail into one symbol whose alias was just
  // the last segment, so a used leading member could vanish). Conservative
  // no-op over corruption.
  if (hasTopLevelComma(withoutKeyword)) {
    return [verbatimUse(trimmed, kind)];
  }

  const single = parseSymbol(withoutKeyword, kind);

  return single ? [single] : [];
}

/** True when `body` contains a comma that is not nested inside `{...}`. */
function hasTopLevelComma(body: string): boolean {
  let depth = 0;

  for (const character of body) {
    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      return true;
    }
  }

  return false;
}

/**
 * Builds an opaque, always-kept entry whose statement reproduces the original
 * `use` body verbatim. Carries a sort key so it still orders alongside the
 * single-symbol survivors without being mangled.
 */
function verbatimUse(bodyWithoutSurroundingSpace: string, kind: UseKind): ParsedUse {
  const statement = `use ${bodyWithoutSurroundingSpace};`;

  return {
    alias: "",
    fqn: bodyWithoutSurroundingSpace,
    kind,
    sortKey: bodyWithoutSurroundingSpace.toLowerCase(),
    statement,
    verbatim: true,
  };
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

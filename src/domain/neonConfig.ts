/**
 * Pure, filesystem-free detection of navigable / completable constructs inside
 * Nette **NEON** config files (`config.neon`, `services.neon`).
 *
 * Highlighting is owned by the Shiki grammar and is out of scope here. This
 * module answers four questions over a raw source string plus (for navigation)
 * a cursor offset:
 *
 *   1. Is the cursor on a PHP class reference (an FQN, the class part of a
 *      `Class::method` value, or an entity `Class(args)`)? — `detectNeonClassReferenceAt`.
 *   2. What are all the class references in the document? — `neonClassReferences`.
 *   3. Is the cursor on an `includes:` list entry (a relative `.neon` path)? —
 *      `detectNeonIncludeAt`.
 *   4. Is the cursor typing a class name as a service value (for completion)? —
 *      `neonServiceClassCompletionContextAt`.
 *
 * Resolving a class name or include path to a concrete workspace file is the
 * responsibility of the navigation / completion integration layer — this module
 * only reports the construct text and its offsets.
 *
 * PARSING APPROACH: NEON is line-oriented, so parsing is line-based. A single
 * linear pass builds a per-line model (indentation, enclosing top-level section,
 * the line's key, where its value begins, its inline-comment boundary). Value
 * scanning is a bounded left-to-right walk — no backtracking regexes, no
 * unbounded look-behind — so it stays hang-safe on malformed or very large
 * input. It is CONSERVATIVE: any ambiguous position resolves to `null`.
 *
 * NAVIGATION vs COMPLETION scope:
 *   - Class navigation (`detect…At` / `neonClassReferences`) recognises a
 *     namespaced FQN (`App\Model\Foo`) ANYWHERE (services, parameters,
 *     extensions, …) because an FQN is always a legitimate go-to-class target.
 *     A single-segment bare class name is only recognised in unambiguous
 *     positions (entity `Foo(`, static `Foo::`, or a class-value key inside
 *     `services:`), and only when it starts uppercase.
 *   - Class completion is offered ONLY inside the `services:` section (anonymous
 *     `- ` entries, named services, and class-value keys such as `factory:`).
 */

export interface NeonSpan {
  /** Offset of the first character. */
  start: number;
  /** Offset one past the last character. */
  end: number;
}

export interface NeonClassReference {
  /** The class name text exactly as it appears in the source. */
  className: string;
  span: NeonSpan;
}

export interface NeonInclude {
  /** The include path text (quotes stripped when the entry was quoted). */
  path: string;
  span: NeonSpan;
}

export interface NeonServiceClassCompletionContext {
  /** The class-name characters already typed at the cursor (may be empty). */
  prefix: string;
  /** The range the completion should replace (the whole partial identifier). */
  span: NeonSpan;
}

/**
 * `services:` keys whose value is a class / type. Used both to recognise a
 * single-segment class value for navigation and to keep completion focused.
 */
const CLASS_VALUE_KEYS: ReadonlySet<string> = new Set([
  "factory",
  "class",
  "create",
  "implement",
  "type",
]);

/**
 * `services:` sub-keys whose values are never class names (`@service` refs,
 * `%param%`, method calls, scalars). Completion is suppressed for them.
 */
const NON_CLASS_SERVICE_KEYS: ReadonlySet<string> = new Set([
  "arguments",
  "setup",
  "tags",
  "autowired",
  "autowire",
  "inject",
  "alias",
  "run",
  "reset",
]);

const SERVICES_SECTION = "services";
const INCLUDES_SECTION = "includes";

interface NeonLine {
  /** Offset of the first character of the line. */
  start: number;
  /** Offset of the terminating newline, or `source.length` for the last line. */
  end: number;
  /** Enclosing top-level section key (lowercased), or `null`. */
  section: string | null;
  /** The line's mapping key (lowercased), or `null` when the line has none. */
  keyName: string | null;
  /** Offset where the value begins, or `null` when the line carries no value. */
  valueStart: number | null;
  /** Whether the line is a `- ` sequence entry. */
  isListItem: boolean;
  /** Offset of the inline `#` comment, or the content limit when there is none. */
  commentStart: number;
  /** Whether the line has no scannable content (blank or comment-only). */
  isInert: boolean;
  /**
   * True when this line is nested (at any depth) under an enclosing key that
   * is itself a {@link NON_CLASS_SERVICE_KEYS} key - e.g. a `- setDebug(1)`
   * list item indented under `setup:`. Such a line never carries a class
   * value even though it has no key of its own, so completion must be
   * suppressed for it too.
   */
  suppressedByEnclosingKey: boolean;
}

function isSpace(character: string): boolean {
  return character === " " || character === "\t";
}

function isClassTokenStart(character: string): boolean {
  return /[A-Za-z_\\]/.test(character);
}

function isClassTokenChar(character: string): boolean {
  return /[A-Za-z0-9_\\]/.test(character);
}

/**
 * A namespaced FQN: identifier segments joined by single backslashes, with an
 * optional leading backslash. Rejects trailing / doubled backslashes so a
 * malformed `App\` never resolves to a reference.
 */
function isPlausibleFqn(token: string): boolean {
  return /^\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)+$/.test(token);
}

/**
 * Advances past the string literal that opens at `open`, honouring `\` escapes.
 * Returns the offset just past the closing quote, or `limit` when unclosed —
 * always making progress so callers cannot loop.
 */
function skipString(source: string, open: number, limit: number): number {
  const quote = source[open];
  let index = open + 1;

  while (index < limit) {
    const character = source[index];

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return index + 1;
    }

    index += 1;
  }

  return limit;
}

/**
 * Returns the offset of the inline `#` comment on `[from, limit)` (a `#` at the
 * start of content or preceded by whitespace, outside any string), or `limit`
 * when there is none.
 */
function findCommentStart(source: string, from: number, limit: number): number {
  let index = from;

  while (index < limit) {
    const character = source[index] ?? "";

    if (character === "'" || character === "\"") {
      index = skipString(source, index, limit);
      continue;
    }

    if (
      character === "#" &&
      (index === from || isSpace(source[index - 1] ?? ""))
    ) {
      return index;
    }

    index += 1;
  }

  return limit;
}

/**
 * Tracks, per indentation level, whether the enclosing key at that level is a
 * {@link NON_CLASS_SERVICE_KEYS} key (or nested under one) - so a completion
 * suppression cascades down to every line nested under it, regardless of how
 * many levels deep.
 */
interface NeonKeyStackEntry {
  indent: number;
  suppressed: boolean;
}

/**
 * Parses `source` into per-line models, tracking the enclosing top-level
 * section across lines. A single linear pass; every line is examined once.
 */
function buildLineModels(source: string): NeonLine[] {
  const lines: NeonLine[] = [];
  let currentSection: string | null = null;
  const keyStack: NeonKeyStackEntry[] = [];
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newlineIndex = source.indexOf("\n", lineStart);
    const end = newlineIndex < 0 ? source.length : newlineIndex;
    const contentLimit =
      end > lineStart && source[end - 1] === "\r" ? end - 1 : end;

    const model = buildLine(
      source,
      lineStart,
      end,
      contentLimit,
      currentSection,
      keyStack,
    );
    currentSection = model.section;
    lines.push(model);

    if (newlineIndex < 0) {
      break;
    }

    lineStart = newlineIndex + 1;
  }

  return lines;
}

function buildLine(
  source: string,
  start: number,
  end: number,
  contentLimit: number,
  currentSection: string | null,
  keyStack: NeonKeyStackEntry[],
): NeonLine {
  let contentStart = start;

  while (contentStart < contentLimit && isSpace(source[contentStart] ?? "")) {
    contentStart += 1;
  }

  const indent = contentStart - start;
  const firstChar = source[contentStart] ?? "";
  const isBlank = contentStart >= contentLimit;
  const isCommentOnly = firstChar === "#";

  if (isBlank || isCommentOnly) {
    return inertLine(start, end, currentSection);
  }

  const isListItem =
    firstChar === "-" &&
    (contentStart + 1 >= contentLimit || isSpace(source[contentStart + 1] ?? ""));

  let cursor = contentStart;

  if (isListItem) {
    cursor += 1;

    while (cursor < contentLimit && isSpace(source[cursor] ?? "")) {
      cursor += 1;
    }
  }

  const commentStart = findCommentStart(source, contentStart, contentLimit);
  const key = keyAt(source, cursor, commentStart);
  const section = sectionFor(indent, key, currentSection);
  const suppressedByEnclosingKey = resolveEnclosingSuppression(
    keyStack,
    indent,
    key?.name ?? null,
  );

  if (key) {
    return {
      start,
      end,
      section,
      keyName: key.name,
      valueStart: key.valueStart,
      isListItem,
      commentStart,
      isInert: false,
      suppressedByEnclosingKey,
    };
  }

  return {
    start,
    end,
    section,
    keyName: null,
    valueStart: cursor,
    isListItem,
    commentStart,
    isInert: false,
    suppressedByEnclosingKey,
  };
}

/**
 * Pops stack entries whose indent is no longer strictly less than this
 * line's indent (they were siblings/descendants of a level we just left),
 * reports whether the remaining top-of-stack ancestor is itself suppressed,
 * then - when this line carries a key - pushes its own level so deeper lines
 * inherit its (possibly newly-suppressed) status.
 */
function resolveEnclosingSuppression(
  keyStack: NeonKeyStackEntry[],
  indent: number,
  keyName: string | null,
): boolean {
  while (
    keyStack.length > 0 &&
    (keyStack[keyStack.length - 1] as NeonKeyStackEntry).indent >= indent
  ) {
    keyStack.pop();
  }

  const ancestorSuppressed =
    keyStack.length > 0
      ? (keyStack[keyStack.length - 1] as NeonKeyStackEntry).suppressed
      : false;

  if (keyName !== null) {
    keyStack.push({
      indent,
      suppressed: ancestorSuppressed || NON_CLASS_SERVICE_KEYS.has(keyName),
    });
  }

  return ancestorSuppressed;
}

function inertLine(
  start: number,
  end: number,
  currentSection: string | null,
): NeonLine {
  return {
    start,
    end,
    section: currentSection,
    keyName: null,
    valueStart: null,
    isListItem: false,
    commentStart: end,
    isInert: true,
    suppressedByEnclosingKey: false,
  };
}

/**
 * Only a top-level (indent 0) mapping key opens a new section; deeper lines
 * inherit the section of the most recent top-level key.
 */
function sectionFor(
  indent: number,
  key: { name: string } | null,
  currentSection: string | null,
): string | null {
  if (indent === 0 && key) {
    return key.name;
  }

  return currentSection;
}

interface NeonKey {
  /** Lowercased key name. */
  name: string;
  /** Offset where the value begins (after the colon and any spaces). */
  valueStart: number;
}

/**
 * Recognises a `key:` mapping at `cursor` (a `[\w.-]+` name followed by a colon
 * that ends the line or is followed by whitespace). Returns `null` otherwise —
 * so `http://…`, `Class::method`, and `10:30` are never read as keys.
 */
function keyAt(source: string, cursor: number, limit: number): NeonKey | null {
  let index = cursor;

  while (index < limit && /[\w.-]/.test(source[index] ?? "")) {
    index += 1;
  }

  if (index === cursor) {
    return null;
  }

  let colon = index;

  while (colon < limit && isSpace(source[colon] ?? "")) {
    colon += 1;
  }

  if (source[colon] !== ":") {
    return null;
  }

  const afterColon = colon + 1;
  const followed = afterColon >= limit || isSpace(source[afterColon] ?? "");

  if (!followed) {
    return null;
  }

  let valueStart = afterColon;

  while (valueStart < limit && isSpace(source[valueStart] ?? "")) {
    valueStart += 1;
  }

  return { name: source.slice(cursor, index).toLowerCase(), valueStart };
}

interface ValueContext {
  section: string | null;
  keyName: string | null;
}

/**
 * Classifies the token `[start, end)` as a class reference, returning its name
 * or `null`. Applies the exclusions (`@type`, `%param%`, `::member`), accepts
 * any plausible FQN, and accepts single-segment names only in unambiguous
 * uppercase positions.
 */
function classifyClassToken(
  source: string,
  start: number,
  end: number,
  context: ValueContext,
): string | null {
  const previous = start > 0 ? source[start - 1] : "";

  if (previous === "@" || previous === "%") {
    return null;
  }

  if (previous === ":" && start >= 2 && source[start - 2] === ":") {
    return null;
  }

  const token = source.slice(start, end);

  if (token.includes("\\")) {
    return isPlausibleFqn(token) ? token : null;
  }

  const startsUppercase = /[A-Z]/.test(token[0] ?? "");

  if (!startsUppercase) {
    return null;
  }

  const next = source[end] ?? "";
  const isEntity = next === "(";
  const isStatic = next === ":" && source[end + 1] === ":";

  if (isEntity || isStatic) {
    return token;
  }

  if (
    context.section === SERVICES_SECTION &&
    context.keyName !== null &&
    CLASS_VALUE_KEYS.has(context.keyName)
  ) {
    return token;
  }

  return null;
}

/**
 * Scans the value region `[valueStart, valueEnd)` for class-reference tokens,
 * skipping string literals, and appends any hits to `out`.
 *
 * KNOWN GAP (intentionally not fixed here): a quoted FQN, e.g.
 * `factory: "App\Model\Foo"`, never yields a reference - the whole string is
 * skipped by `skipString` before any token scanning happens. Recognising an
 * FQN-shaped quoted string would need correct NEON escape handling (single-
 * vs double-quoted strings have different backslash-escaping rules), which is
 * easy to get subtly wrong and risks misreading an intentionally-escaped
 * value. Left unimplemented; revisit with real NEON escape-rule test
 * coverage before enabling it.
 */
function scanClassReferences(
  source: string,
  valueStart: number,
  valueEnd: number,
  context: ValueContext,
  out: NeonClassReference[],
): void {
  let index = valueStart;

  while (index < valueEnd) {
    const character = source[index] ?? "";

    if (character === "'" || character === "\"") {
      index = skipString(source, index, valueEnd);
      continue;
    }

    if (!isClassTokenStart(character)) {
      index += 1;
      continue;
    }

    const tokenStart = index;

    while (index < valueEnd && isClassTokenChar(source[index] ?? "")) {
      index += 1;
    }

    const className = classifyClassToken(source, tokenStart, index, context);

    if (className) {
      out.push({ className, span: { start: tokenStart, end: index } });
    }
  }
}

/**
 * Returns every class reference in `source`, in document order.
 */
export function neonClassReferences(source: string): NeonClassReference[] {
  const references: NeonClassReference[] = [];

  for (const line of buildLineModels(source)) {
    if (line.isInert || line.valueStart === null) {
      continue;
    }

    scanClassReferences(
      source,
      line.valueStart,
      line.commentStart,
      { section: line.section, keyName: line.keyName },
      references,
    );
  }

  return references;
}

/**
 * Returns the class reference at `offset`, or `null` when the cursor is not on
 * one. The cursor is "on" a reference from its first character through one past
 * its last (matching editor go-to-definition semantics).
 */
export function detectNeonClassReferenceAt(
  source: string,
  offset: number,
): NeonClassReference | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const reference of neonClassReferences(source)) {
    if (offset >= reference.span.start && offset <= reference.span.end) {
      return reference;
    }
  }

  return null;
}

/**
 * Returns every `includes:` entry in `source`, in document order. Each entry is
 * a sequence item whose scalar value is a relative `.neon` path.
 */
function neonIncludes(source: string): NeonInclude[] {
  const includes: NeonInclude[] = [];

  for (const line of buildLineModels(source)) {
    if (line.isInert || !line.isListItem || line.valueStart === null) {
      continue;
    }

    if (line.section !== INCLUDES_SECTION) {
      continue;
    }

    const include = includeEntry(source, line.valueStart, line.commentStart);

    if (include) {
      includes.push(include);
    }
  }

  return includes;
}

function includeEntry(
  source: string,
  valueStart: number,
  valueEnd: number,
): NeonInclude | null {
  let start = valueStart;
  let end = valueEnd;

  while (start < end && isSpace(source[start] ?? "")) {
    start += 1;
  }

  while (end > start && isSpace(source[end - 1] ?? "")) {
    end -= 1;
  }

  if (start >= end) {
    return null;
  }

  const opening = source[start] ?? "";
  const isQuoted =
    (opening === "'" || opening === "\"") &&
    end - 1 > start &&
    source[end - 1] === opening;

  if (isQuoted) {
    return {
      path: source.slice(start + 1, end - 1),
      span: { start: start + 1, end: end - 1 },
    };
  }

  return { path: source.slice(start, end), span: { start, end } };
}

/**
 * Returns the `includes:` entry at `offset`, or `null` when the cursor is not on
 * an include path.
 */
export function detectNeonIncludeAt(
  source: string,
  offset: number,
): NeonInclude | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const include of neonIncludes(source)) {
    if (offset >= include.span.start && offset <= include.span.end) {
      return include;
    }
  }

  return null;
}

function lineContaining(lines: NeonLine[], offset: number): NeonLine | null {
  for (const line of lines) {
    if (offset >= line.start && offset <= line.end) {
      return line;
    }
  }

  return null;
}

/**
 * True when class completion should be offered for `line`'s value: an anonymous
 * `- ` service entry, or a keyed value that is not a known non-class sub-key -
 * and, either way, not a line nested (at any depth) under an enclosing
 * non-class sub-key, such as a `- setDebug(1)` list item under a multi-line
 * `setup:` block (§F3: single-line `setup: setDebug(1)` was already excluded
 * via the line's own `keyName`; a multi-line block's list items carry no key
 * of their own, so they need the ancestor check too).
 */
function isCompletionEligible(line: NeonLine): boolean {
  if (line.suppressedByEnclosingKey) {
    return false;
  }

  if (line.keyName === null) {
    return line.isListItem;
  }

  return !NON_CLASS_SERVICE_KEYS.has(line.keyName);
}

/**
 * Returns the class-completion context at `offset`, or `null`. Completion is
 * offered only inside `services:`, at a value position, when everything typed
 * so far is a class-name fragment (no `@`, `%`, spaces, or quotes).
 */
export function neonServiceClassCompletionContextAt(
  source: string,
  offset: number,
): NeonServiceClassCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const line = lineContaining(buildLineModels(source), offset);

  if (!line || line.isInert || line.section !== SERVICES_SECTION) {
    return null;
  }

  if (line.valueStart === null || offset < line.valueStart) {
    return null;
  }

  if (offset > line.commentStart) {
    return null;
  }

  if (!isCompletionEligible(line)) {
    return null;
  }

  for (let index = line.valueStart; index < offset; index += 1) {
    if (!isClassTokenChar(source[index] ?? "")) {
      return null;
    }
  }

  let end = offset;

  while (end < line.commentStart && isClassTokenChar(source[end] ?? "")) {
    end += 1;
  }

  return {
    prefix: source.slice(line.valueStart, offset),
    span: { start: line.valueStart, end },
  };
}

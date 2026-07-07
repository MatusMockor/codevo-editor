/**
 * Pure, filesystem-free NEON **dependency-injection** semantics for the Nette
 * stack (Phase 2/3 of the Nette+Latte support design, §9). This is the DI layer
 * that sits on top of {@link ./neonConfig} (navigation of service classes /
 * includes): it understands the MEANING of a `config.neon`/`services.neon`
 * document rather than just its class-reference tokens.
 *
 * It answers, over a raw NEON source string (and, for navigation/completion, a
 * cursor offset):
 *
 *   1. What are the `parameters:` (flat, nested and inline-map, with dotted
 *      names such as `mail.from`)? - `neonParametersFromSource`.
 *   2. Is the cursor on a `%param%` reference? - `detectNeonParameterReferenceAt`.
 *   3. Is the cursor typing a `%param%` (completion)? - `neonParameterCompletionContextAt`.
 *   4. What services does the document register (name / class / factory)? -
 *      `neonServicesFromSource`.
 *   5. Is the cursor on an `@service` / `@\App\Class` reference? -
 *      `detectNeonServiceReferenceAt`.
 *   6. Is the cursor typing an `@service` reference (completion)? -
 *      `neonServiceReferenceCompletionContextAt`.
 *
 * plus one PHP-side helper for autowiring receiver types:
 *
 *   7. Which typed properties/parameters does a presenter/service inject
 *      (`#[Inject]`, `@inject` docblock, `inject*()` methods, constructor
 *      promoted / typed params)? - `netteInjectedPropertyTypes`.
 *
 * Resolving a parameter/service/class name to a concrete definition or file is
 * the integration layer's job (it also MERGES services/parameters across the
 * several `.neon` files a project includes). This module only reports the
 * constructs and their offsets over a single source.
 *
 * PARSING APPROACH: NEON is line-oriented, so the NEON parsing is line-based -
 * a single linear pass builds a per-line model (indent, enclosing top-level
 * section, key + value spans, comment boundary). Value scanning (`%param%`,
 * `@service`, class/factory tokens) is a bounded left-to-right walk that skips
 * string literals; inline maps/lists are split with a bracket/quote-aware
 * scanner and recursion is depth-capped. The PHP helper uses linear regexes and
 * a bracket-matched parameter walk. Everything makes strict forward progress, so
 * it stays hang-safe on malformed or very large input (50k+ lines, deep nesting,
 * `%%` escapes, `%`/`@` inside strings). It is CONSERVATIVE: any ambiguous
 * position resolves to `null` / is dropped.
 */

export interface NeonSpan {
  /** Offset of the first character. */
  start: number;
  /** Offset one past the last character. */
  end: number;
}

/** A `parameters:` leaf (scalar or inline-list value). */
export interface NeonParameter {
  /** Dotted logical name (`dbHost`, `mail.from`). */
  name: string;
  /** Raw value text (trimmed, comment stripped; quotes NOT stripped). */
  value: string;
  /** Go-to-definition anchor: the start of the (leaf) key. Equals `span.start`. */
  offset: number;
  /** The leaf key's source range (the physical text to highlight). */
  span: NeonSpan;
}

export interface NeonParameterReference {
  /** Dotted parameter name referenced (`dbHost`, `mail.from`). */
  name: string;
  /** The whole `%name%` token, both percents included. */
  span: NeonSpan;
}

export interface NeonParameterCompletionContext {
  /** The parameter-name characters already typed after `%` (may be empty). */
  prefix: string;
  /** The range the completion replaces (the partial name, no percents). */
  span: NeonSpan;
}

/** A registered service (anonymous services carry `serviceName === null`). */
export interface NeonService {
  /** The service key (case preserved), or `null` for an anonymous `- ` entry. */
  serviceName: string | null;
  /**
   * The statically-known produced class FQN, or `null` when it cannot be
   * determined from NEON alone (a `Class::method` factory or an `@alias`).
   */
  className: string | null;
  /** A `Class::method` static-factory expression, or `null`. */
  factory: string | null;
  /**
   * Go-to-definition anchor: the service name for a named service, or the
   * class/factory token for an anonymous one (falling back to the entry start).
   */
  offset: number;
}

export interface NeonGeneratedServiceName {
  /** Nette's generated service id for an explicit anonymous service. */
  name: string;
  /** The anonymous service this generated name points at. */
  service: NeonService;
}

export interface NeonServiceReference {
  /** The referenced name/type without the leading `@` (`logger`, `\App\Repo`). */
  name: string;
  /** The whole `@name` token, the `@` included. */
  span: NeonSpan;
}

export interface NeonServiceMethodReference {
  /** The referenced service name/type without the leading `@`. */
  serviceName: string;
  /** The method name after `::`. */
  methodName: string;
  /** The whole `@service` token, the `@` included. */
  serviceSpan: NeonSpan;
  /** The method-name token range after `::`. */
  methodSpan: NeonSpan;
}

export interface NeonServiceReferenceCompletionContext {
  /** The characters already typed after `@` (may be empty). */
  prefix: string;
  /** The range the completion replaces (the partial name, no `@`). */
  span: NeonSpan;
}

export interface NeonServiceSetupMethod {
  /** The setup method name (`setLogger`, `addExtension`, ...). */
  methodName: string;
  /** The method-name token range, excluding the opening parenthesis. */
  span: NeonSpan;
  /** The service whose setup block contains the method call. */
  service: NeonService;
}

export interface NeonServiceSetupMethodCompletionContext {
  /** The method-name characters already typed at the cursor. */
  prefix: string;
  /** The range the completion replaces (the partial method name). */
  span: NeonSpan;
  /** The service whose setup block contains the method call. */
  service: NeonService;
}

/** A typed injected identifier (property or constructor/inject-method param). */
export interface NetteInjectedProperty {
  /** The identifier without its `$` (`foo`, `products`). */
  name: string;
  /** The declared class-like type (nullable `?` stripped; FQN kept). */
  type: string;
  /** Offset of the identifier name (the char after `$`). */
  offset: number;
}

const MAX_INLINE_MAP_DEPTH = 32;

const PHP_BUILTIN_TYPES: ReadonlySet<string> = new Set([
  "int",
  "integer",
  "float",
  "double",
  "string",
  "bool",
  "boolean",
  "array",
  "iterable",
  "callable",
  "object",
  "mixed",
  "void",
  "null",
  "false",
  "true",
  "self",
  "static",
  "parent",
  "never",
]);

const SERVICE_CLASS_KEYS: ReadonlySet<string> = new Set([
  "class",
  "type",
]);

const SERVICE_FACTORY_KEYS: ReadonlySet<string> = new Set([
  "create",
  "factory",
]);

function isSpace(character: string): boolean {
  return character === " " || character === "\t";
}

function isParamNameChar(character: string): boolean {
  return /[A-Za-z0-9_.-]/.test(character);
}

function isServiceNameChar(character: string): boolean {
  return /[A-Za-z0-9_.\\-]/.test(character);
}

function isServiceNameStart(character: string): boolean {
  return /[A-Za-z0-9_\\]/.test(character);
}

function isClassTokenChar(character: string): boolean {
  return /[A-Za-z0-9_\\]/.test(character);
}

function isIdentifierContinuation(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

function isMethodNameStart(character: string): boolean {
  return /[A-Za-z_]/.test(character);
}

/**
 * A namespaced FQN: identifier segments joined by single backslashes, optional
 * leading backslash. Rejects trailing / doubled backslashes.
 */
function isPlausibleFqn(token: string): boolean {
  return /^\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)+$/.test(token);
}

/** A class token is plausible as an FQN, or a single uppercase-leading name. */
function isPlausibleClass(token: string): boolean {
  if (token.includes("\\")) {
    return isPlausibleFqn(token);
  }

  return /^[A-Z]/.test(token);
}

/**
 * Advances past the string literal opening at `open` (honouring `\` escapes).
 * Returns the offset just past the closing quote, or `limit` when unclosed -
 * always making progress.
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
 * content start or preceded by whitespace, outside any string), or `limit`.
 */
function findCommentStart(source: string, from: number, limit: number): number {
  let index = from;

  while (index < limit) {
    const character = source[index] ?? "";

    if (character === "'" || character === '"') {
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

interface NeonKey {
  rawName: string;
  keyStart: number;
  keyEnd: number;
  valueStart: number;
}

/**
 * Recognises a `key:` mapping at `cursor` (a `[\w.-]+` name followed by a colon
 * that ends the line or is followed by whitespace). Returns `null` otherwise, so
 * `http://…`, `Class::method`, and `10:30` are never read as keys. The raw
 * (case-preserved) name is returned - service/parameter names are case sensitive.
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

  return { rawName: source.slice(cursor, index), keyStart: cursor, keyEnd: index, valueStart };
}

interface NeonLine {
  start: number;
  end: number;
  contentStart: number;
  contentLimit: number;
  indent: number;
  isInert: boolean;
  isListItem: boolean;
  /** Enclosing top-level section key (lowercased), or `null`. */
  section: string | null;
  /** Raw (case-preserved) key name, or `null`. */
  keyNameRaw: string | null;
  keyStart: number | null;
  keyEnd: number | null;
  /** Offset where the value begins (after `- ` and/or `key:`). */
  valueStart: number;
  /** Offset of the inline comment, or the content limit. */
  commentStart: number;
}

function inertLine(
  start: number,
  end: number,
  contentLimit: number,
  section: string | null,
): NeonLine {
  return {
    start,
    end,
    contentStart: contentLimit,
    contentLimit,
    indent: 0,
    isInert: true,
    isListItem: false,
    section,
    keyNameRaw: null,
    keyStart: null,
    keyEnd: null,
    valueStart: contentLimit,
    commentStart: contentLimit,
  };
}

function buildLine(
  source: string,
  start: number,
  end: number,
  contentLimit: number,
  currentSection: string | null,
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
    return inertLine(start, end, contentLimit, currentSection);
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
  const section = indent === 0 && key ? key.rawName.toLowerCase() : currentSection;

  return {
    start,
    end,
    contentStart,
    contentLimit,
    indent,
    isInert: false,
    isListItem,
    section,
    keyNameRaw: key ? key.rawName : null,
    keyStart: key ? key.keyStart : null,
    keyEnd: key ? key.keyEnd : null,
    valueStart: key ? key.valueStart : cursor,
    commentStart,
  };
}

/** A single linear pass; each line is examined once. */
function buildLines(source: string): NeonLine[] {
  const lines: NeonLine[] = [];
  let currentSection: string | null = null;
  let lineStart = 0;

  while (lineStart <= source.length) {
    const newlineIndex = source.indexOf("\n", lineStart);
    const end = newlineIndex < 0 ? source.length : newlineIndex;
    const contentLimit =
      end > lineStart && source[end - 1] === "\r" ? end - 1 : end;

    const model = buildLine(source, lineStart, end, contentLimit, currentSection);
    currentSection = model.section;
    lines.push(model);

    if (newlineIndex < 0) {
      break;
    }

    lineStart = newlineIndex + 1;
  }

  return lines;
}

function lineContaining(lines: NeonLine[], offset: number): NeonLine | null {
  for (const line of lines) {
    if (offset >= line.start && offset <= line.end) {
      return line;
    }
  }

  return null;
}

/** The string-free sub-ranges of `[start, end)` (string interiors removed). */
function stringFreeRuns(source: string, start: number, end: number): NeonSpan[] {
  const runs: NeonSpan[] = [];
  let runStart = start;
  let index = start;

  while (index < end) {
    const character = source[index] ?? "";

    if (character === "'" || character === '"') {
      runs.push({ start: runStart, end: index });
      index = skipString(source, index, end);
      runStart = index;
      continue;
    }

    index += 1;
  }

  runs.push({ start: runStart, end });

  return runs;
}

function runContaining(runs: NeonSpan[], offset: number): NeonSpan | null {
  for (const run of runs) {
    if (offset >= run.start && offset <= run.end) {
      return run;
    }
  }

  return null;
}

/**
 * Returns the offset of the character matching the bracket that opens at
 * `openOffset`, honouring quotes, or `null` when unbalanced.
 */
function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

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

/** Splits `[start, end)` on a top-level `separator`, honouring quotes/brackets. */
function splitTopLevelRanges(
  source: string,
  start: number,
  end: number,
  separator: string,
): NeonSpan[] {
  const ranges: NeonSpan[] = [];
  let depth = 0;
  let quote: "'" | '"' | null = null;
  let partStart = start;

  for (let index = start; index < end; index += 1) {
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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || character !== separator) {
      continue;
    }

    ranges.push({ start: partStart, end: index });
    partStart = index + 1;
  }

  ranges.push({ start: partStart, end });

  return ranges;
}

/** The offset of the first top-level `:` in `[start, end)`, or `-1`. */
function findTopLevelColon(source: string, start: number, end: number): number {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = start; index < end; index += 1) {
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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && character === ":") {
      return index;
    }
  }

  return -1;
}

/** Trims whitespace off `[start, end)`, returning the inner span. */
function trimRange(source: string, start: number, end: number): NeonSpan {
  let s = start;
  let e = end;

  while (s < e && isSpace(source[s] ?? "")) {
    s += 1;
  }

  while (e > s && isSpace(source[e - 1] ?? "")) {
    e -= 1;
  }

  return { start: s, end: e };
}

// --- parameters ---------------------------------------------------------------

interface ParamStackEntry {
  indent: number;
  segment: string;
}

/**
 * Extracts every `parameters:` leaf (flat, nested block, and inline map) with a
 * dotted logical name. Only scalar / inline-list leaves are emitted; a block
 * parent (`mail:` with children) contributes only its children.
 */
export function neonParametersFromSource(source: string): NeonParameter[] {
  const lines = buildLines(source);
  const out: NeonParameter[] = [];
  const stack: ParamStackEntry[] = [];

  for (const line of lines) {
    if (line.isInert || line.section !== "parameters" || line.indent === 0) {
      continue;
    }

    while (stack.length > 0 && (stack[stack.length - 1] as ParamStackEntry).indent >= line.indent) {
      stack.pop();
    }

    if (line.keyNameRaw === null) {
      continue;
    }

    const prefix = stack.map((entry) => entry.segment).join(".");
    const fullBase = prefix.length > 0 ? `${prefix}.${line.keyNameRaw}` : line.keyNameRaw;
    const trimmed = source.slice(line.valueStart, line.commentStart).trim();

    stack.push({ indent: line.indent, segment: line.keyNameRaw });

    if (trimmed.length === 0) {
      continue;
    }

    if (trimmed[0] === "{") {
      collectInlineParams(source, line.valueStart, line.commentStart, fullBase, 0, out);
      continue;
    }

    out.push({
      name: fullBase,
      value: trimmed,
      offset: line.keyStart as number,
      span: { start: line.keyStart as number, end: line.keyEnd as number },
    });
  }

  return out;
}

function collectInlineParams(
  source: string,
  regionStart: number,
  regionEnd: number,
  prefix: string,
  depth: number,
  out: NeonParameter[],
): void {
  if (depth > MAX_INLINE_MAP_DEPTH) {
    return;
  }

  const braceOpen = firstNonSpace(source, regionStart, regionEnd);

  if (braceOpen < 0 || source[braceOpen] !== "{") {
    return;
  }

  const close = matchingBracketOffset(source, braceOpen, "{", "}");

  if (close === null) {
    return;
  }

  for (const part of splitTopLevelRanges(source, braceOpen + 1, close, ",")) {
    const colon = findTopLevelColon(source, part.start, part.end);

    if (colon < 0) {
      continue;
    }

    const keyRange = trimRange(source, part.start, colon);

    if (keyRange.start >= keyRange.end) {
      continue;
    }

    const keyName = source.slice(keyRange.start, keyRange.end);
    const name = `${prefix}.${keyName}`;
    const valueTrimmed = source.slice(colon + 1, part.end).trim();

    if (valueTrimmed[0] === "{") {
      collectInlineParams(source, colon + 1, part.end, name, depth + 1, out);
      continue;
    }

    out.push({
      name,
      value: valueTrimmed,
      offset: keyRange.start,
      span: keyRange,
    });
  }
}

function firstNonSpace(source: string, start: number, end: number): number {
  for (let index = start; index < end; index += 1) {
    if (!isSpace(source[index] ?? "")) {
      return index;
    }
  }

  return -1;
}

// --- %param% references + completion ------------------------------------------

interface PercentToken {
  open: number;
  nameStart: number;
  nameEnd: number;
  closed: boolean;
}

/**
 * Scans `[start, end)` for `%…%` tokens, pairing openers with closers and
 * skipping `%%` escapes. Each token records its name region; `closed` tells a
 * complete `%name%` from an unterminated `%name…`. Strictly forward-progressing.
 */
function scanPercentTokens(source: string, start: number, end: number): PercentToken[] {
  const tokens: PercentToken[] = [];
  let index = start;

  while (index < end) {
    if (source[index] !== "%") {
      index += 1;
      continue;
    }

    if (index + 1 < end && source[index + 1] === "%") {
      index += 2;
      continue;
    }

    const nameStart = index + 1;
    let cursor = nameStart;

    while (cursor < end && isParamNameChar(source[cursor] ?? "")) {
      cursor += 1;
    }

    const closed = cursor < end && source[cursor] === "%";
    tokens.push({ open: index, nameStart, nameEnd: cursor, closed });
    index = closed ? cursor + 1 : Math.max(cursor, index + 1);
  }

  return tokens;
}

/** Every complete `%name%` reference in the document, in order. */
function neonParameterReferences(source: string): NeonParameterReference[] {
  const references: NeonParameterReference[] = [];

  for (const line of buildLines(source)) {
    if (line.isInert) {
      continue;
    }

    for (const run of stringFreeRuns(source, line.contentStart, line.commentStart)) {
      for (const token of scanPercentTokens(source, run.start, run.end)) {
        if (!token.closed || token.nameEnd <= token.nameStart) {
          continue;
        }

        references.push({
          name: source.slice(token.nameStart, token.nameEnd),
          span: { start: token.open, end: token.nameEnd + 1 },
        });
      }
    }
  }

  return references;
}

/** The `%param%` reference at `offset`, or `null`. */
export function detectNeonParameterReferenceAt(
  source: string,
  offset: number,
): NeonParameterReference | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const reference of neonParameterReferences(source)) {
    if (offset >= reference.span.start && offset <= reference.span.end) {
      return reference;
    }
  }

  return null;
}

/** The `%param%` completion context at `offset`, or `null`. */
export function neonParameterCompletionContextAt(
  source: string,
  offset: number,
): NeonParameterCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const line = lineContaining(buildLines(source), offset);

  if (!line || line.isInert || offset < line.contentStart || offset > line.commentStart) {
    return null;
  }

  const runs = stringFreeRuns(source, line.contentStart, line.commentStart);
  const run = runContaining(runs, offset);

  if (!run) {
    return null;
  }

  for (const token of scanPercentTokens(source, run.start, run.end)) {
    if (offset >= token.nameStart && offset <= token.nameEnd) {
      return {
        prefix: source.slice(token.nameStart, offset),
        span: { start: token.nameStart, end: token.nameEnd },
      };
    }
  }

  return null;
}

// --- services -----------------------------------------------------------------

interface ServiceSource {
  key: string | null;
  valueStart: number;
  valueEnd: number;
}

interface SetupSource {
  valueStart: number;
  valueEnd: number;
}

interface ClassifiedValue {
  className: string | null;
  factory: string | null;
  tokenOffset: number | null;
}

/**
 * Classifies a service value region as a produced class, a `Class::method`
 * static factory, or neither (alias `@x`, `%param%`, string, scalar).
 */
function classifyServiceValue(
  source: string,
  start: number,
  end: number,
): ClassifiedValue {
  const range = trimRange(source, start, end);
  const empty: ClassifiedValue = { className: null, factory: null, tokenOffset: null };

  if (range.start >= range.end) {
    return empty;
  }

  const first = source[range.start] ?? "";

  if (first === "@" || first === "%" || first === "'" || first === '"' || first === "{" || first === "[") {
    return empty;
  }

  let cursor = range.start;

  while (cursor < range.end && isClassTokenChar(source[cursor] ?? "")) {
    cursor += 1;
  }

  const token = source.slice(range.start, cursor);

  if (token.length === 0) {
    return empty;
  }

  if (source[cursor] === ":" && source[cursor + 1] === ":") {
    let method = cursor + 2;

    while (method < range.end && isIdentifierContinuation(source[method] ?? "")) {
      method += 1;
    }

    return {
      className: null,
      factory: source.slice(range.start, method),
      tokenOffset: range.start,
    };
  }

  if (!isPlausibleClass(token)) {
    return empty;
  }

  return { className: token, factory: null, tokenOffset: range.start };
}

/** Expands an inline `{ … }` service map into class/factory value sources. */
function collectMapSources(
  source: string,
  regionStart: number,
  regionEnd: number,
  out: ServiceSource[],
): void {
  const braceOpen = firstNonSpace(source, regionStart, regionEnd);

  if (braceOpen < 0 || source[braceOpen] !== "{") {
    return;
  }

  const close = matchingBracketOffset(source, braceOpen, "{", "}");

  if (close === null) {
    return;
  }

  for (const part of splitTopLevelRanges(source, braceOpen + 1, close, ",")) {
    const colon = findTopLevelColon(source, part.start, part.end);

    if (colon < 0) {
      out.push({ key: null, valueStart: part.start, valueEnd: part.end });
      continue;
    }

    const keyRange = trimRange(source, part.start, colon);
    const key = source.slice(keyRange.start, keyRange.end).toLowerCase();
    out.push({ key, valueStart: colon + 1, valueEnd: part.end });
  }
}

interface ServiceGroup {
  head: NeonLine;
  body: NeonLine[];
}

function serviceGroups(lines: NeonLine[]): ServiceGroup[] {
  const serviceLines = lines.filter(
    (line) => !line.isInert && line.section === "services" && line.indent > 0,
  );

  if (serviceLines.length === 0) {
    return [];
  }

  const entryIndent = serviceLines.reduce(
    (min, line) => Math.min(min, line.indent),
    Number.POSITIVE_INFINITY,
  );
  const groups: ServiceGroup[] = [];

  for (const line of serviceLines) {
    if (line.indent === entryIndent) {
      groups.push({ head: line, body: [] });
      continue;
    }

    const current = groups[groups.length - 1];

    if (current) {
      current.body.push(line);
    }
  }

  return groups;
}

function serviceSources(source: string, head: NeonLine, body: NeonLine[]): ServiceSource[] {
  const sources: ServiceSource[] = [];
  const headTrimmed = source.slice(head.valueStart, head.commentStart).trim();

  if (headTrimmed.length > 0 && headTrimmed[0] === "{") {
    collectMapSources(source, head.valueStart, head.commentStart, sources);
  }

  if (headTrimmed.length > 0 && headTrimmed[0] !== "{") {
    const headKey = head.isListItem && head.keyNameRaw ? head.keyNameRaw.toLowerCase() : null;
    sources.push({ key: headKey, valueStart: head.valueStart, valueEnd: head.commentStart });
  }

  for (const line of body) {
    if (line.keyNameRaw === null) {
      continue;
    }

    sources.push({
      key: line.keyNameRaw.toLowerCase(),
      valueStart: line.valueStart,
      valueEnd: line.commentStart,
    });
  }

  return sources;
}

function parseServiceGroup(source: string, head: NeonLine, body: NeonLine[]): NeonService | null {
  const serviceName = head.isListItem ? null : head.keyNameRaw;
  const sources = serviceSources(source, head, body);

  let className: string | null = null;
  let factory: string | null = null;
  let classOffset: number | null = null;

  for (const entry of sources) {
    const classified = classifyServiceValue(source, entry.valueStart, entry.valueEnd);

    if (entry.key !== null && SERVICE_CLASS_KEYS.has(entry.key)) {
      if (classified.className !== null && className === null) {
        className = classified.className;
        classOffset = classified.tokenOffset;
      }

      continue;
    }

    if (entry.key === null || SERVICE_FACTORY_KEYS.has(entry.key)) {
      if (classified.factory !== null && factory === null) {
        factory = classified.factory;

        if (classOffset === null) {
          classOffset = classified.tokenOffset;
        }
      }

      if (classified.className !== null && className === null) {
        className = classified.className;
        classOffset = classified.tokenOffset;
      }
    }
  }

  if (serviceName === null && className === null && factory === null) {
    return null;
  }

  const offset =
    serviceName !== null
      ? (head.keyStart as number)
      : classOffset !== null
        ? classOffset
        : head.contentStart;

  return { serviceName, className, factory, offset };
}

function collectInlineSetupSources(
  source: string,
  regionStart: number,
  regionEnd: number,
  out: SetupSource[],
): void {
  const mapSources: ServiceSource[] = [];
  collectMapSources(source, regionStart, regionEnd, mapSources);

  for (const entry of mapSources) {
    if (entry.key === "setup") {
      out.push({ valueStart: entry.valueStart, valueEnd: entry.valueEnd });
    }
  }
}

function setupSources(source: string, head: NeonLine, body: NeonLine[]): SetupSource[] {
  const sources: SetupSource[] = [];
  const headTrimmed = source.slice(head.valueStart, head.commentStart).trim();

  if (headTrimmed.startsWith("{")) {
    collectInlineSetupSources(source, head.valueStart, head.commentStart, sources);
  }

  for (let index = 0; index < body.length; index += 1) {
    const line = body[index] as NeonLine;

    if (line.keyNameRaw === null || line.keyNameRaw.toLowerCase() !== "setup") {
      continue;
    }

    if (line.valueStart < line.commentStart) {
      sources.push({ valueStart: line.valueStart, valueEnd: line.commentStart });
    }

    for (let nestedIndex = index + 1; nestedIndex < body.length; nestedIndex += 1) {
      const nested = body[nestedIndex] as NeonLine;

      if (nested.indent <= line.indent) {
        break;
      }

      sources.push({
        valueStart: nested.valueStart,
        valueEnd: nested.commentStart,
      });
    }
  }

  return sources;
}

/** Every service registered in `source`, in document order. */
export function neonServicesFromSource(source: string): NeonService[] {
  const lines = buildLines(source);
  const services: NeonService[] = [];

  for (const group of serviceGroups(lines)) {
    const parsed = parseServiceGroup(source, group.head, group.body);

    if (parsed) {
      services.push(parsed);
    }
  }

  return services;
}

export function neonGeneratedServiceNamesFromServices(
  services: readonly NeonService[],
  startIndex = 1,
): NeonGeneratedServiceName[] {
  const names: NeonGeneratedServiceName[] = [];
  let anonymousIndex = startIndex;

  for (const service of services) {
    if (service.serviceName !== null) {
      continue;
    }

    names.push({
      name: `0${anonymousIndex}`,
      service,
    });
    anonymousIndex += 1;
  }

  return names;
}

// --- setup method contexts ----------------------------------------------------

function isSetupMethodBoundary(source: string, start: number): boolean {
  const previous = source[start - 1] ?? "";

  return (
    previous !== "@" &&
    previous !== "\\" &&
    previous !== ":" &&
    previous !== "(" &&
    !isIdentifierContinuation(previous)
  );
}

function parenDepthBefore(source: string, start: number, end: number): number {
  let depth = 0;

  for (let index = start; index < end; index += 1) {
    const character = source[index] ?? "";

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

function methodCallSpanAt(
  source: string,
  runStart: number,
  start: number,
  end: number,
): NeonSpan | null {
  if (!isMethodNameStart(source[start] ?? "")) {
    return null;
  }

  if (!isSetupMethodBoundary(source, start)) {
    return null;
  }

  if (parenDepthBefore(source, runStart, start) > 0) {
    return null;
  }

  let cursor = start + 1;

  while (cursor < end && isIdentifierContinuation(source[cursor] ?? "")) {
    cursor += 1;
  }

  let openParen = cursor;

  while (openParen < end && isSpace(source[openParen] ?? "")) {
    openParen += 1;
  }

  if (source[openParen] !== "(") {
    return null;
  }

  return { start, end: cursor };
}

function setupMethodCallsInRun(
  source: string,
  start: number,
  end: number,
  service: NeonService,
  out: NeonServiceSetupMethod[],
): void {
  let index = start;

  while (index < end) {
    const span = methodCallSpanAt(source, start, index, end);

    if (!span) {
      index += 1;
      continue;
    }

    out.push({
      methodName: source.slice(span.start, span.end),
      span,
      service,
    });
    index = span.end;
  }
}

function setupMethodCompletionInRun(
  source: string,
  offset: number,
  run: NeonSpan,
  service: NeonService,
): NeonServiceSetupMethodCompletionContext | null {
  let start = offset;

  while (start > run.start && isIdentifierContinuation(source[start - 1] ?? "")) {
    start -= 1;
  }

  if (!isMethodNameStart(source[start] ?? "")) {
    return null;
  }

  if (!isSetupMethodBoundary(source, start)) {
    return null;
  }

  if (parenDepthBefore(source, run.start, start) > 0) {
    return null;
  }

  let end = offset;

  while (end < run.end && isIdentifierContinuation(source[end] ?? "")) {
    end += 1;
  }

  let next = end;

  while (next < run.end && isSpace(source[next] ?? "")) {
    next += 1;
  }

  if (next < run.end && source[next] !== "(") {
    return null;
  }

  return {
    prefix: source.slice(start, offset),
    span: { start, end },
    service,
  };
}

function neonServiceSetupMethods(source: string): NeonServiceSetupMethod[] {
  const lines = buildLines(source);
  const methods: NeonServiceSetupMethod[] = [];

  for (const group of serviceGroups(lines)) {
    const service = parseServiceGroup(source, group.head, group.body);

    if (!service) {
      continue;
    }

    for (const setupSource of setupSources(source, group.head, group.body)) {
      for (const run of stringFreeRuns(source, setupSource.valueStart, setupSource.valueEnd)) {
        setupMethodCallsInRun(source, run.start, run.end, service, methods);
      }
    }
  }

  return methods;
}

/** The setup method call at `offset`, including the owning service, or `null`. */
export function detectNeonServiceSetupMethodAt(
  source: string,
  offset: number,
): NeonServiceSetupMethod | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const method of neonServiceSetupMethods(source)) {
    if (offset >= method.span.start && offset <= method.span.end) {
      return method;
    }
  }

  return null;
}

/** The setup method completion context at `offset`, or `null`. */
export function neonServiceSetupMethodCompletionContextAt(
  source: string,
  offset: number,
): NeonServiceSetupMethodCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const lines = buildLines(source);

  for (const group of serviceGroups(lines)) {
    const service = parseServiceGroup(source, group.head, group.body);

    if (!service) {
      continue;
    }

    for (const setupSource of setupSources(source, group.head, group.body)) {
      if (offset < setupSource.valueStart || offset > setupSource.valueEnd) {
        continue;
      }

      const run = runContaining(
        stringFreeRuns(source, setupSource.valueStart, setupSource.valueEnd),
        offset,
      );

      if (!run) {
        continue;
      }

      const completion = setupMethodCompletionInRun(source, offset, run, service);

      if (completion) {
        return completion;
      }
    }
  }

  return null;
}

// --- @service references + completion -----------------------------------------

function scanServiceRefsInRun(
  source: string,
  start: number,
  end: number,
  out: NeonServiceReference[],
): void {
  let index = start;

  while (index < end) {
    if (source[index] !== "@") {
      index += 1;
      continue;
    }

    const before = source[index - 1] ?? "";

    if (index > 0 && isIdentifierContinuation(before)) {
      index += 1;
      continue;
    }

    const nameStart = index + 1;

    if (nameStart >= end || !isServiceNameStart(source[nameStart] ?? "")) {
      index += 1;
      continue;
    }

    let cursor = nameStart;

    while (cursor < end && isServiceNameChar(source[cursor] ?? "")) {
      cursor += 1;
    }

    out.push({
      name: source.slice(nameStart, cursor),
      span: { start: index, end: cursor },
    });
    index = cursor;
  }
}

function neonServiceReferences(source: string): NeonServiceReference[] {
  const references: NeonServiceReference[] = [];

  for (const line of buildLines(source)) {
    if (line.isInert) {
      continue;
    }

    for (const run of stringFreeRuns(source, line.contentStart, line.commentStart)) {
      scanServiceRefsInRun(source, run.start, run.end, references);
    }
  }

  return references;
}

/** The `@service` / `@\App\Class` reference at `offset`, or `null`. */
export function detectNeonServiceReferenceAt(
  source: string,
  offset: number,
): NeonServiceReference | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const reference of neonServiceReferences(source)) {
    if (offset >= reference.span.start && offset <= reference.span.end) {
      return reference;
    }
  }

  return null;
}

/** The method part of an `@service::method` reference at `offset`, or `null`. */
export function detectNeonServiceMethodReferenceAt(
  source: string,
  offset: number,
): NeonServiceMethodReference | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  for (const reference of neonServiceReferences(source)) {
    const separatorStart = reference.span.end;
    const methodStart = separatorStart + 2;

    if (
      source[separatorStart] !== ":" ||
      source[separatorStart + 1] !== ":" ||
      !isMethodNameStart(source[methodStart] ?? "")
    ) {
      continue;
    }

    let methodEnd = methodStart + 1;

    while (isIdentifierContinuation(source[methodEnd] ?? "")) {
      methodEnd += 1;
    }

    if (offset < methodStart || offset > methodEnd) {
      continue;
    }

    return {
      methodName: source.slice(methodStart, methodEnd),
      methodSpan: { start: methodStart, end: methodEnd },
      serviceName: reference.name,
      serviceSpan: reference.span,
    };
  }

  return null;
}

/** The `@service` completion context at `offset`, or `null`. */
export function neonServiceReferenceCompletionContextAt(
  source: string,
  offset: number,
): NeonServiceReferenceCompletionContext | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const line = lineContaining(buildLines(source), offset);

  if (!line || line.isInert || offset < line.contentStart || offset > line.commentStart) {
    return null;
  }

  const run = runContaining(stringFreeRuns(source, line.contentStart, line.commentStart), offset);

  if (!run) {
    return null;
  }

  let nameStart = offset;

  while (nameStart > run.start && isServiceNameChar(source[nameStart - 1] ?? "")) {
    nameStart -= 1;
  }

  if (nameStart - 1 < run.start || source[nameStart - 1] !== "@") {
    return null;
  }

  const beforeAt = source[nameStart - 2] ?? "";

  if (nameStart - 2 >= 0 && isIdentifierContinuation(beforeAt)) {
    return null;
  }

  let end = offset;

  while (end < run.end && isServiceNameChar(source[end] ?? "")) {
    end += 1;
  }

  return {
    prefix: source.slice(nameStart, offset),
    span: { start: nameStart, end },
  };
}

// --- PHP inject / constructor autowiring types --------------------------------

const INJECT_ATTRIBUTE_PROPERTY =
  /#\[[^\]]*\bInject\b[^\]]*\]\s*(?:public|protected|private)\s+(?:readonly\s+)?((?:\?)?[\\A-Za-z_][\\A-Za-z0-9_|&]*)\s+\$([A-Za-z_][A-Za-z0-9_]*)/g;

const DOCBLOCK = /\/\*\*[\s\S]*?\*\//g;

const DOCBLOCK_PROPERTY =
  /^\s*(?:public|protected|private)\s+(?:readonly\s+)?((?:\?)?[\\A-Za-z_][\\A-Za-z0-9_|&]*)?\s*\$([A-Za-z_][A-Za-z0-9_]*)/;

const DOCBLOCK_VAR = /@var\s+((?:\?)?[\\A-Za-z_][\\A-Za-z0-9_|&[\]]*)/;

const INJECT_METHOD = /\bfunction\s+inject(?:[A-Z][A-Za-z0-9_]*)?\s*\(/g;

const CONSTRUCTOR = /\bfunction\s+__construct\s*\(/g;

const PARAM_TYPE_NAME =
  /^\s*(?:(?:public|protected|private)\s+)?(?:readonly\s+)?(?:(?:public|protected|private)\s+)?((?:\?)?[\\A-Za-z_][\\A-Za-z0-9_|&]*)\s+(?:&\s*)?(?:\.\.\.\s*)?\$([A-Za-z_][A-Za-z0-9_]*)/;

/**
 * Accepts a class-like receiver type: strips a nullable `?`, rejects
 * union/intersection types (ambiguous receiver) and builtin scalars.
 */
function acceptReceiverType(rawType: string): string | null {
  const type = rawType.replace(/^\?/, "").trim();

  if (type.length === 0 || type.includes("|") || type.includes("&")) {
    return null;
  }

  if (PHP_BUILTIN_TYPES.has(type.toLowerCase())) {
    return null;
  }

  return type;
}

function nameOffset(fragment: string, fragmentStart: number, name: string): number {
  return fragmentStart + fragment.lastIndexOf(`$${name}`) + 1;
}

function collectInjectAttributes(source: string, out: NetteInjectedProperty[]): void {
  for (const match of source.matchAll(INJECT_ATTRIBUTE_PROPERTY)) {
    const type = acceptReceiverType(match[1] ?? "");
    const name = match[2] ?? "";

    if (!type || !name) {
      continue;
    }

    out.push({ name, type, offset: nameOffset(match[0], match.index ?? 0, name) });
  }
}

function docblockVarType(block: string): string | null {
  const match = block.match(DOCBLOCK_VAR);

  return match ? (match[1] ?? null) : null;
}

function collectDocblockInjects(source: string, out: NetteInjectedProperty[]): void {
  for (const match of source.matchAll(DOCBLOCK)) {
    const block = match[0];

    if (!/@inject\b/.test(block)) {
      continue;
    }

    const afterStart = (match.index ?? 0) + block.length;
    const property = source.slice(afterStart).match(DOCBLOCK_PROPERTY);

    if (!property) {
      continue;
    }

    const rawType = property[1] ?? docblockVarType(block) ?? "";
    const type = acceptReceiverType(rawType);
    const name = property[2] ?? "";

    if (!type || !name) {
      continue;
    }

    out.push({ name, type, offset: nameOffset(property[0], afterStart, name) });
  }
}

function collectTypedParams(source: string, openParen: number, out: NetteInjectedProperty[]): void {
  const close = matchingBracketOffset(source, openParen, "(", ")");

  if (close === null) {
    return;
  }

  const base = openParen + 1;

  for (const part of splitTopLevelRanges(source, base, close, ",")) {
    const range = trimRange(source, part.start, part.end);
    const fragment = source.slice(range.start, range.end);
    const match = fragment.match(PARAM_TYPE_NAME);

    if (!match) {
      continue;
    }

    const type = acceptReceiverType(match[1] ?? "");
    const name = match[2] ?? "";

    if (!type || !name) {
      continue;
    }

    out.push({ name, type, offset: nameOffset(match[0], range.start, name) });
  }
}

function collectMethodParams(
  source: string,
  pattern: RegExp,
  out: NetteInjectedProperty[],
): void {
  for (const match of source.matchAll(pattern)) {
    const openParen = (match.index ?? 0) + match[0].length - 1;
    collectTypedParams(source, openParen, out);
  }
}

/**
 * Reports every typed injected identifier a presenter/service exposes:
 * `#[Inject]` / `/** @inject *\/` public properties, `inject*()` setter-method
 * params, and constructor promoted / typed params. Conservative: typed only,
 * builtins and union/intersection receivers dropped, deduplicated by offset and
 * returned in document order.
 */
export function netteInjectedPropertyTypes(phpSource: string): NetteInjectedProperty[] {
  const collected: NetteInjectedProperty[] = [];

  collectInjectAttributes(phpSource, collected);
  collectDocblockInjects(phpSource, collected);
  collectMethodParams(phpSource, INJECT_METHOD, collected);
  collectMethodParams(phpSource, CONSTRUCTOR, collected);

  const seen = new Set<number>();
  const unique: NetteInjectedProperty[] = [];

  for (const entry of collected) {
    if (seen.has(entry.offset)) {
      continue;
    }

    seen.add(entry.offset);
    unique.push(entry);
  }

  return unique.sort((a, b) => a.offset - b.offset);
}

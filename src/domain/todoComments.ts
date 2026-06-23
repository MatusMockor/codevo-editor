/**
 * Pure, filesystem-free harvesting of TODO-style comments for the TODO panel.
 *
 * The input is the raw text of a single file. The extractor is conservative:
 * tags are only recognised when they appear inside an actual comment, so a
 * `TODO` living in a string literal or in code never produces a result.
 *
 * Comment syntaxes understood (covering PHP / JS / TS / Blade / HTML):
 *   - `// ... ` line comments
 *   - `# ...`   line comments (PHP / shell-style; not Blade `#[...]` attributes)
 *   - `/* ... *\/` block comments
 *   - `{{-- ... --}}` Blade comments
 *   - `<!-- ... -->` HTML comments
 *
 * String literals (`'...'`, `"..."`, `` `...` ``) are skipped while scanning so
 * that tags inside strings are not mistaken for comments.
 */

export interface TodoComment {
  column: number;
  line: number;
  tag: string;
  text: string;
}

export interface ExtractTodoCommentsOptions {
  tags?: string[];
}

interface CommentSpan {
  start: number;
  text: string;
}

const DEFAULT_TAGS: readonly string[] = [
  "TODO",
  "FIXME",
  "HACK",
  "XXX",
  "BUG",
  "NOTE",
];

export function extractTodoComments(
  source: string,
  options?: ExtractTodoCommentsOptions,
): TodoComment[] {
  const tags = normalizeTags(options?.tags);

  if (tags.length === 0) {
    return [];
  }

  const matcher = buildTagMatcher(tags);
  const lineStarts = computeLineStarts(source);

  return collectCommentSpans(source).flatMap((span) =>
    extractFromSpan(span, matcher, lineStarts),
  );
}

function normalizeTags(tags: string[] | undefined): string[] {
  const source = tags ?? DEFAULT_TAGS;

  return source.map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

/**
 * Matches a tag that is the leading meaningful token of a (possibly indented
 * and `*`/`-` decorated) line. This keeps a tag mentioned inside another tag's
 * descriptive text from being harvested as a separate entry.
 */
function buildTagMatcher(tags: string[]): RegExp {
  const alternation = tags.map(escapeRegExp).join("|");

  return new RegExp(
    `(?:^|\\n)[ \\t]*[*\\-!]*[ \\t]*(${alternation})(?![A-Za-z0-9_])`,
    "g",
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function extractFromSpan(
  span: CommentSpan,
  matcher: RegExp,
  lineStarts: number[],
): TodoComment[] {
  const results: TodoComment[] = [];
  matcher.lastIndex = 0;

  for (
    let match = matcher.exec(span.text);
    match;
    match = matcher.exec(span.text)
  ) {
    const tag = match[1];

    if (!tag) {
      continue;
    }

    const tagIndexInSpan = (match.index ?? 0) + match[0].lastIndexOf(tag);
    const offset = span.start + tagIndexInSpan;
    const position = offsetToPosition(offset, lineStarts);

    results.push({
      column: position.column,
      line: position.line,
      tag,
      text: extractTagText(span.text, tagIndexInSpan + tag.length),
    });
  }

  return results;
}

function extractTagText(commentText: string, afterTag: number): string {
  const rest = commentText.slice(afterTag);
  const withoutSeparator = rest.replace(/^\s*:?\s*/, "");

  return stripTrailingBlockNoise(withoutSeparator).trim();
}

function stripTrailingBlockNoise(text: string): string {
  const firstLine = text.split("\n")[0] ?? text;

  return firstLine;
}

/**
 * Walks the source once, masking string literals and capturing the inner text
 * (and absolute start offset) of every comment span across the supported
 * syntaxes. Guard-clause driven, no nested branching on comment kind.
 */
function collectCommentSpans(source: string): CommentSpan[] {
  const spans: CommentSpan[] = [];
  let index = 0;

  while (index < source.length) {
    const quote = stringQuoteAt(source, index);

    if (quote) {
      index = skipString(source, index, quote);
      continue;
    }

    const opener = commentOpenerAt(source, index);

    if (!opener) {
      index += 1;
      continue;
    }

    const closeOffset = findCommentClose(source, opener, index);
    const innerStart = index + opener.open.length;

    spans.push({
      start: innerStart,
      text: source.slice(innerStart, closeOffset.contentEnd),
    });
    index = closeOffset.nextIndex;
  }

  return spans;
}

interface CommentOpener {
  close: string;
  isLine: boolean;
  open: string;
}

const BLOCK_OPENERS: readonly CommentOpener[] = [
  { open: "{{--", close: "--}}", isLine: false },
  { open: "<!--", close: "-->", isLine: false },
  { open: "/*", close: "*/", isLine: false },
];

const LINE_OPENERS: readonly CommentOpener[] = [
  { open: "//", close: "\n", isLine: true },
  { open: "#", close: "\n", isLine: true },
];

function commentOpenerAt(source: string, index: number): CommentOpener | null {
  const block = BLOCK_OPENERS.find((opener) =>
    source.startsWith(opener.open, index),
  );

  if (block) {
    return block;
  }

  return matchLineOpener(source, index);
}

function matchLineOpener(source: string, index: number): CommentOpener | null {
  const opener = LINE_OPENERS.find((candidate) =>
    source.startsWith(candidate.open, index),
  );

  if (!opener) {
    return null;
  }

  if (opener.open === "#" && source[index + 1] === "[") {
    return null;
  }

  return opener;
}

interface CommentClose {
  contentEnd: number;
  nextIndex: number;
}

function findCommentClose(
  source: string,
  opener: CommentOpener,
  index: number,
): CommentClose {
  const searchFrom = index + opener.open.length;
  const closeOffset = source.indexOf(opener.close, searchFrom);

  if (closeOffset < 0) {
    return { contentEnd: source.length, nextIndex: source.length };
  }

  if (opener.isLine) {
    return { contentEnd: closeOffset, nextIndex: closeOffset };
  }

  return {
    contentEnd: closeOffset,
    nextIndex: closeOffset + opener.close.length,
  };
}

function stringQuoteAt(source: string, index: number): string | null {
  const character = source[index];

  if (character === "'" || character === '"' || character === "`") {
    return character;
  }

  return null;
}

function skipString(source: string, openIndex: number, quote: string): number {
  for (let index = openIndex + 1; index < source.length; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index + 1;
    }
  }

  return source.length;
}

function computeLineStarts(source: string): number[] {
  const starts = [0];

  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

interface Position {
  column: number;
  line: number;
}

function offsetToPosition(offset: number, lineStarts: number[]): Position {
  const lineIndex = findLineIndex(offset, lineStarts);
  const lineStart = lineStarts[lineIndex] ?? 0;

  return { column: offset - lineStart + 1, line: lineIndex + 1 };
}

function findLineIndex(offset: number, lineStarts: number[]): number {
  let low = 0;
  let high = lineStarts.length - 1;

  while (low < high) {
    const mid = Math.ceil((low + high) / 2);

    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid;
      continue;
    }

    high = mid - 1;
  }

  return low;
}

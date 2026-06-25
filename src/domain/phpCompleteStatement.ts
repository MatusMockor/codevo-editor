/**
 * Pure domain logic for the "Complete Current Statement" editor action
 * (PhpStorm Cmd+Shift+Enter).
 *
 * Given the text of the current line plus the caret column, it figures out the
 * smallest safe edit that turns the line into a syntactically complete PHP
 * statement and reports where the caret should land:
 *
 *   - `$x = 5`        -> `$x = 5;`            (caret after the `;`)
 *   - `foo(1, 2`      -> `foo(1, 2);`         (unbalanced `(` closed first)
 *   - `$arr[0`        -> `$arr[0]`            (subscript closed, no `;`)
 *   - `if ($x)`       -> `if ($x) {` + body   (block opened, caret in body)
 *
 * The analysis is intentionally line-scoped and conservative: when the line is
 * already complete, or the situation is ambiguous, it prefers to do nothing
 * rather than guess wrong. String / comment contents are masked (mirroring
 * `phpScopeCompletions.ts`) so a `(`, `[` or `;` inside a literal never drives
 * the decision.
 *
 * The module is free of Monaco / React dependencies so it can be unit-tested in
 * isolation; the editor surface translates the result into an `executeEdits`
 * call (for `replaceLine`) or a snippet insertion (for `insertBlock`).
 */

export interface ReplaceLineCompletion {
  /** 1-based column the caret should move to within the rewritten line. */
  caretColumn: number;
  kind: "replaceLine";
  /** Full replacement text for the current line. */
  newText: string;
}

export interface InsertBlockCompletion {
  /** Leading whitespace of the header line, reused to indent the new body. */
  indent: string;
  kind: "insertBlock";
  /** The header line rewritten to open a brace block (e.g. `if ($x) {`). */
  keepHeader: string;
}

export type PhpStatementCompletion =
  | InsertBlockCompletion
  | ReplaceLineCompletion;

const CONTROL_HEADER_KEYWORDS = [
  "if",
  "elseif",
  "else if",
  "for",
  "foreach",
  "while",
  "function",
  "catch",
] as const;

export function completePhpStatement(
  lineText: string,
  _caretColumn: number,
  precedingSource = "",
): PhpStatementCompletion | null {
  const trimmedEnd = lineText.replace(/\s+$/, "");

  if (trimmedEnd.trim().length === 0) {
    return null;
  }

  const masked = maskLineStringsAndComments(trimmedEnd);
  const commentStart = lineCommentStart(masked);
  const codeEnd = commentStart === null ? trimmedEnd.length : commentStart;
  const code = trimmedEnd.slice(0, codeEnd).replace(/\s+$/, "");
  const codeMasked = masked.slice(0, code.length);

  if (code.trim().length === 0) {
    return null;
  }

  // A heredoc / nowdoc literal spans multiple lines and its body is opaque string
  // content. Whether the caret sits on the opener (`$x = <<<EOT`), on a body line
  // or on the closing identifier, appending a `;` / `)` / `]` here would inject
  // punctuation into the string (or truncate the opener), corrupting the literal.
  // We carry the heredoc state across the preceding source plus the caret line and
  // decline the moment the caret line is part of a heredoc/nowdoc construct.
  if (isInsideHeredocConstruct(precedingSource, lineText)) {
    return null;
  }

  // When the caret sits inside a multiline construct (an array literal, call
  // argument list, closure body or `match` body opened on an earlier line), the
  // current line is only a fragment of a larger statement. Appending a `;` or
  // closing a brace here corrupts the enclosing construct, so we do nothing and
  // let the developer keep typing. Same for lines that obviously continue onto
  // the next one (a trailing `,` / `=>`, an array or match arm, or a line that
  // itself opens a block whose body is still to come).
  if (isInsideMultilineConstruct(precedingSource)) {
    return null;
  }

  if (isContinuationLine(code, codeMasked)) {
    return null;
  }

  if (leadingControlKeyword(codeMasked)) {
    return controlHeaderCompletion(code, codeMasked, lineText);
  }

  return expressionCompletion(trimmedEnd, code, codeMasked, commentStart);
}

// True when the source preceding the caret line has more opening than closing
// brackets (after masking strings/comments), i.e. the caret is nested inside an
// unclosed `(`, `[` or `{` from an earlier line. Completing a statement here is
// never safe because the relevant context lives outside the current line.
function isInsideMultilineConstruct(precedingSource: string): boolean {
  if (precedingSource.length === 0) {
    return false;
  }

  const masked = maskMultilineSource(precedingSource);
  let depth = 0;

  for (const character of masked) {
    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth > 0;
}

// True when the caret line is part of a heredoc / nowdoc literal — its opener
// line, any body line, or the closing-identifier line. We scan the preceding
// source plus the caret line carrying the open-tag across line boundaries; the
// caret line is "inside" when the heredoc was already open before it (body or
// closer) or it opens a new heredoc itself (opener). In all three cases the line
// is literal-or-delimiter text where injecting `;` / `)` / `]` corrupts the
// string, so the caller must decline.
function isInsideHeredocConstruct(
  precedingSource: string,
  caretLine: string,
): boolean {
  const state: HeredocState = { tag: null };

  for (const line of splitPrecedingLines(precedingSource)) {
    scanHeredocLine(line, state);
  }

  const openBefore = state.tag !== null;
  scanHeredocLine(caretLine, state);
  const openAfter = state.tag !== null;

  return openBefore || openAfter;
}

// Splits `precedingSource` (joined caret-preceding lines, terminated by a
// trailing `\n`) into its line array, dropping the synthetic trailing empty
// segment so a phantom blank line never advances the heredoc scan.
function splitPrecedingLines(precedingSource: string): string[] {
  if (precedingSource.length === 0) {
    return [];
  }

  const lines = precedingSource.split("\n");

  if (lines[lines.length - 1] === "") {
    lines.pop();
  }

  return lines;
}

interface HeredocState {
  // Closing identifier of the heredoc/nowdoc currently open, or null when none.
  tag: string | null;
}

// Advances the cross-line heredoc state by one line. When already inside a
// heredoc, only its closing-identifier line clears the tag; otherwise a `<<<TAG`
// opener (heredoc `<<<EOT` / `<<<"EOT"` or nowdoc `<<<'EOT'`) on this line opens
// one. Comments are stripped first so a `<<<` mention in a `//` / `#` comment is
// never read as an opener; the masked line is consulted to ensure the `<<<` does
// not actually sit inside a string literal.
function scanHeredocLine(line: string, state: HeredocState): void {
  if (state.tag !== null) {
    if (isHeredocCloser(line, state.tag)) {
      state.tag = null;
    }

    return;
  }

  state.tag = heredocOpenerTag(line);
}

// Matches the closing-identifier line of a heredoc/nowdoc. PHP allows the closer
// to be indented and to be followed immediately by `;`, `,`, `)` or `]` (or
// nothing). The identifier must stand on a word boundary so `EOTHER` never closes
// an `EOT` heredoc.
function isHeredocCloser(line: string, tag: string): boolean {
  return new RegExp(`^\\s*${tag}\\b`).test(line);
}

// Detects a heredoc/nowdoc opener on a raw line and returns its closing
// identifier. `<<<EOT`, `<<<"EOT"` (heredoc) and `<<<'EOT'` (nowdoc) share the
// closing identifier `EOT`. The tag is matched on the raw text (the masker would
// blank the quoted nowdoc / double-quoted tag), but only after the `//` / `#`
// comment body is dropped. Every `<<<` on the line is examined so a `<<<` sitting
// inside a string literal (verified against the masked line) never hides a real
// opener that follows it later on the same line. Returns null when none is real.
function heredocOpenerTag(line: string): string | null {
  const masked = maskLineStringsAndComments(line);
  const commentStart = lineCommentStart(masked);
  const codeEnd = commentStart === null ? line.length : commentStart;
  const code = line.slice(0, codeEnd);
  const codeMasked = masked.slice(0, codeEnd);

  const pattern = /<<<\s*['"]?([A-Za-z_]\w*)['"]?/g;

  for (
    let match = pattern.exec(code);
    match !== null;
    match = pattern.exec(code)
  ) {
    if (codeMasked.slice(match.index, match.index + 3) === "<<<") {
      return match[1];
    }
  }

  return null;
}

// True when the caret line is a fragment that continues onto the next line and
// therefore owns no statement terminator of its own: an array key/value or
// `match` arm, a `case`/`default` label, or any code that ends on a trailing
// `,`, `=>` or `{` (the latter opens a body completed on later lines).
function isContinuationLine(code: string, codeMasked: string): boolean {
  const trimmed = code.trim();
  const trimmedMasked = codeMasked.trim();

  if (/(?:,|=>|\{)\s*$/.test(trimmedMasked)) {
    return true;
  }

  if (/^(?:case\b|default\b)/.test(trimmedMasked)) {
    return true;
  }

  return /^(?:'[^']*'|"[^"]*"|\d[\w.]*|\$[A-Za-z_]\w*)\s*=>/.test(trimmed);
}

// A line whose leading keyword is a control header is handled exclusively here:
// it either opens a brace block or (when it is already complete) yields no edit,
// never falling through to the generic expression terminator.
function controlHeaderCompletion(
  code: string,
  codeMasked: string,
  lineText: string,
): InsertBlockCompletion | null {
  if (/[{};:]\s*$/.test(codeMasked)) {
    return null;
  }

  const closers = unbalancedClosers(codeMasked);
  const closedCode = `${code}${closers}`;

  if (!/\)\s*$/.test(maskLineStringsAndComments(closedCode))) {
    return null;
  }

  return {
    indent: leadingWhitespace(lineText),
    kind: "insertBlock",
    keepHeader: `${closedCode} {`,
  };
}

function expressionCompletion(
  fullLine: string,
  code: string,
  codeMasked: string,
  commentStart: number | null,
): ReplaceLineCompletion | null {
  const closers = unbalancedClosers(codeMasked);
  const closedMasked = maskLineStringsAndComments(`${code}${closers}`);
  const needsSemicolon =
    !isLoneSubscriptAccess(closedMasked) && !endsStatement(closedMasked);

  if (closers.length === 0 && !needsSemicolon) {
    return null;
  }

  const terminator = needsSemicolon ? ";" : "";
  const insertion = `${closers}${terminator}`;
  const trailing = commentStart === null ? "" : ` ${fullLine.slice(commentStart).trim()}`;
  const newCode = `${code}${insertion}`;

  return {
    caretColumn: newCode.length + 1,
    kind: "replaceLine",
    newText: `${newCode}${trailing}`,
  };
}

// Masks every line of a multi-line source independently so structural brackets
// inside strings, `/* */` and (critically) `//` / `#` line comments do not leak
// into the bracket-depth scan. The single-line masker copies a line-comment body
// verbatim, which is safe per line but would otherwise swallow whole lines if the
// joined source were masked in one pass.
function maskMultilineSource(source: string): string {
  return source
    .split("\n")
    .map((line) => stripLineComment(maskLineStringsAndComments(line)))
    .join("\n");
}

// Drops a trailing `//` / `#` comment body (already isolated by the line masker)
// so its characters never reach the bracket counter.
function stripLineComment(maskedLine: string): string {
  const start = lineCommentStart(maskedLine);

  if (start === null) {
    return maskedLine;
  }

  return maskedLine.slice(0, start);
}

function leadingControlKeyword(codeMasked: string): string | null {
  const match = /^\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/.exec(codeMasked);

  if (!match) {
    return null;
  }

  const candidate = match[1].toLowerCase().replace(/\s+/g, " ");
  const keyword = CONTROL_HEADER_KEYWORDS.find((entry) =>
    candidate === entry || candidate.startsWith(`${entry} `),
  );

  if (!keyword) {
    return null;
  }

  const afterKeyword = codeMasked.slice(match.index + match[0].length);

  if (!/^\s*\(/.test(afterKeyword)) {
    return null;
  }

  return keyword;
}

// Returns the closing characters needed to balance every still-open `(` / `[`
// on the line, innermost first. Mismatched closers on the line are ignored so a
// stray `)` never produces a negative depth.
function unbalancedClosers(codeMasked: string): string {
  const stack: string[] = [];

  for (const character of codeMasked) {
    if (character === "(" || character === "[" || character === "{") {
      stack.push(character);
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      popMatching(stack, character);
    }
  }

  return stack
    .reverse()
    .map((opener) => closerFor(opener))
    .join("");
}

function popMatching(stack: string[], closer: string): void {
  const expected = openerFor(closer);
  const top = stack[stack.length - 1];

  if (top === expected) {
    stack.pop();
  }
}

function openerFor(closer: string): string {
  if (closer === ")") {
    return "(";
  }

  if (closer === "]") {
    return "[";
  }

  return "{";
}

function closerFor(opener: string): string {
  if (opener === "(") {
    return ")";
  }

  if (opener === "[") {
    return "]";
  }

  return "}";
}

// A bare variable subscript access such as `$arr[0]` or `$grid[1][2]` is treated
// as balancing only: closing the bracket completes the access and PhpStorm does
// not append a `;`. The moment there is an assignment, call, or other tokens it
// becomes a statement and is terminated normally.
function isLoneSubscriptAccess(closedMasked: string): boolean {
  return /^\s*\$[A-Za-z_][A-Za-z0-9_]*(?:\s*\[[^\]]*\])+\s*$/.test(closedMasked);
}

function endsStatement(codeMasked: string): boolean {
  return /[;{}:]\s*$/.test(codeMasked);
}

function lineCommentStart(masked: string): number | null {
  const slash = masked.indexOf("//");
  const hash = masked.indexOf("#");
  const candidates = [slash, hash].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return null;
  }

  return Math.min(...candidates);
}

function leadingWhitespace(value: string): string {
  return /^\s*/.exec(value)?.[0] ?? "";
}

// Replaces the contents of single-line string literals and the `//`/`#`/`/* */`
// comment bodies with spaces so structural characters inside them never affect
// brace / paren balancing. The comment openers themselves are preserved so the
// caller can still locate where a trailing comment begins.
function maskLineStringsAndComments(line: string): string {
  let masked = "";
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] || "";
    const next = line[index + 1] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        masked += "  ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      masked += " ";
      continue;
    }

    if (character === "/" && next === "/") {
      masked += line.slice(index);
      return padToLength(masked, line.length);
    }

    if (character === "#") {
      masked += line.slice(index);
      return padToLength(masked, line.length);
    }

    if (character === "/" && next === "*") {
      masked += "/*";
      index += 1;
      const closeIndex = line.indexOf("*/", index + 1);

      if (closeIndex < 0) {
        masked += " ".repeat(line.length - masked.length);
        return masked;
      }

      masked += " ".repeat(closeIndex - masked.length);
      masked += "*/";
      index = closeIndex + 1;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      masked += " ";
      continue;
    }

    masked += character;
  }

  return masked;
}

function padToLength(value: string, length: number): string {
  if (value.length >= length) {
    return value.slice(0, length);
  }

  return value + " ".repeat(length - value.length);
}

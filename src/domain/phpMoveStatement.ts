/**
 * Pure domain logic for the "Move Statement Up / Down" editor action
 * (PhpStorm Cmd+Shift+Up / Cmd+Shift+Down).
 *
 * Unlike "Move Line" (which shifts a single physical line), this moves the
 * whole statement under the caret as one unit and swaps it with the adjacent
 * statement. When the caret sits on (or inside) a brace block - `if`,
 * `foreach`, `while`, `for`, `function`, `try`/`catch`, `match`, a closure body
 * and friends - the entire block travels together:
 *
 *   $before = 1;            if ($ready) {
 *   if ($ready) {     ->        doStuff();
 *       doStuff();          }
 *   }                       $before = 1;
 *
 * The analysis is intentionally conservative. It works on physical-line ranges
 * whose braces balance (after masking strings and comments). The moment a range
 * is ambiguous - an unbalanced block, a multi-line expression fragment, a
 * continuation line, a blank line, or a file edge - it returns `null` and the
 * caller leaves the document untouched (or falls back to Move Line). Better to
 * do nothing than to corrupt code.
 *
 * The module is free of Monaco / React dependencies so it can be unit-tested in
 * isolation; the editor surface translates the result into an `executeEdits`
 * call over the combined line range.
 */

export type MoveStatementDirection = "down" | "up";

export interface MoveStatementEdit {
  /** 1-based line the caret should land on after the swap. */
  caretLine: number;
  /** 1-based last line of the combined range that is rewritten. */
  endLine: number;
  /** Replacement text for the combined range (the swapped order). */
  newText: string;
  /** 1-based first line of the combined range that is rewritten. */
  startLine: number;
}

interface StatementRange {
  end: number;
  start: number;
}

export function phpMoveStatement(
  source: string,
  caretLine: number,
  direction: MoveStatementDirection,
): MoveStatementEdit | null {
  const lines = source.split("\n");

  if (caretLine < 1 || caretLine > lines.length) {
    return null;
  }

  if (lines[caretLine - 1].trim().length === 0) {
    return null;
  }

  const { heredocLines, masked } = maskSourceLines(lines);

  if (isUnsafeBoundaryLine(masked, caretLine)) {
    return null;
  }

  const current = statementRangeAt(lines, masked, caretLine);

  if (!current) {
    return null;
  }

  const neighbour = neighbourRange(lines, masked, current, direction);

  if (!neighbour) {
    return null;
  }

  if (crossesUnsafeBoundary(masked, heredocLines, current, neighbour)) {
    return null;
  }

  return buildSwapEdit(lines, current, neighbour, direction);
}

// The caret line is itself non-swappable when it is a chain-continuation arm
// (`} else {`, `} catch (...) {`, ...) or a `switch` arm label: treating it as a
// standalone statement and swapping it would break the construct it belongs to.
function isUnsafeBoundaryLine(masked: string[], line: number): boolean {
  const maskedLine = masked[line - 1] || "";

  return isChainContinuationLine(maskedLine) || isCaseLabelLine(maskedLine);
}

// Rejects a swap whose seam would split a brace chain, a `switch` arm, or a
// heredoc/nowdoc literal. A range whose first line is a chain continuation, a
// case label, or a heredoc line is not a self-contained statement - it is a
// fragment of a larger construct - so swapping it is refused and the editor falls
// back to the always-safe Move Line. Whole-construct moves are unaffected: their
// first line is the construct's own opener (`try {`, `if ($ready) {`, ...), with
// any boundary lines travelling harmlessly inside the moved range.
function crossesUnsafeBoundary(
  masked: string[],
  heredocLines: Set<number>,
  current: StatementRange,
  neighbour: StatementRange,
): boolean {
  return (
    rangeStartsOnBoundary(masked, heredocLines, current) ||
    rangeStartsOnBoundary(masked, heredocLines, neighbour)
  );
}

// True when a swap range begins on a chain continuation, a case label, or a
// heredoc line. The first line determines whether the range is a real statement
// or a fragment torn out of an enclosing construct.
function rangeStartsOnBoundary(
  masked: string[],
  heredocLines: Set<number>,
  range: StatementRange,
): boolean {
  if (heredocLines.has(range.start)) {
    return true;
  }

  const firstLine = masked[range.start - 1] || "";

  return isChainContinuationLine(firstLine) || isCaseLabelLine(firstLine);
}

// Resolves the full statement range covering `caretLine`. The range starts on
// the line that owns the statement (walking up past body / continuation lines)
// and ends on the line that closes it (matching `}` for a block, otherwise the
// owning line itself). Returns null when the boundaries cannot be trusted.
function statementRangeAt(
  lines: string[],
  masked: string[],
  caretLine: number,
): StatementRange | null {
  const start = statementStartLine(lines, masked, caretLine);

  if (start === null) {
    return null;
  }

  return statementRangeFrom(masked, start);
}

// Resolves the line that begins the statement under the caret. Two ways a caret
// line is not itself the start:
//   1. The caret sits on a block's closing line (net negative brackets, e.g. a
//      lone `}`); the statement begins on the matching opener line above.
//   2. The caret continues a multi-line expression opened on the line(s) above
//      (an unclosed `(` / `[`, or a trailing operator / comma / `=>`).
// Block bodies are NOT treated as part of the enclosing statement: a complete
// statement inside a block moves within that block (PhpStorm parity).
function statementStartLine(
  lines: string[],
  masked: string[],
  caretLine: number,
): number | null {
  const caretMasked = stripLineComment(masked[caretLine - 1]);

  if (bracketDelta(caretMasked) < 0) {
    return blockOpenerLineFor(masked, caretLine);
  }

  let line = caretLine;

  while (line > 1) {
    const previous = previousCodeLine(lines, line);

    if (previous === null) {
      return line;
    }

    if (!continuesPrevious(masked, previous)) {
      return line;
    }

    line = previous;
  }

  return line;
}

// Walks upward from a closing line until the bracket depth balances, returning
// the line that opened the block. Null when the brackets never balance (an
// unterminated fragment), which keeps the move conservative.
function blockOpenerLineFor(masked: string[], closingLine: number): number | null {
  let depth = 0;

  for (let line = closingLine; line >= 1; line -= 1) {
    depth += bracketDelta(stripLineComment(masked[line - 1]));

    if (depth === 0) {
      return line;
    }

    if (depth > 0) {
      return null;
    }
  }

  return null;
}

// True when a statement starting on `line` continues an expression opened on the
// `previous` code line: either `previous` leaves a bracket open (`(` / `[`) that
// has not been balanced by `line`, or it ends with a token demanding more input
// (`,`, `=>`, `->`, `.`, an arithmetic / logical operator, `=`). A trailing block
// brace (`{`) is excluded so block bodies are not folded into their header.
function continuesPrevious(masked: string[], previous: number): boolean {
  const previousMasked = stripLineComment(masked[previous - 1]).replace(
    /\s+$/,
    "",
  );

  if (previousMasked.length === 0) {
    return false;
  }

  if (parenDelta(previousMasked) > 0) {
    return true;
  }

  return endsWithInlineContinuation(previousMasked);
}

function endsWithInlineContinuation(previousMasked: string): boolean {
  return /(?:,|=>|->|\?\?|\.|\+|-|\*|\/|&&|\|\||=|\b(?:and|or)\b)\s*$/.test(
    previousMasked,
  );
}

// True for a masked line that closes one arm of a brace chain and continues it:
// `} else {`, `} elseif (...) {`, `} else`, `} catch (...) {`, `} finally {` and
// the `} while (...)` tail of a do/while. These begin with `}` (closing the
// previous arm) followed by a chain keyword and/or a reopening `{`, so they are
// never a standalone statement and no swap may split them from the chain.
//
// A bare block close - a lone `}` or `};` / `},` (closure, array, match arm) -
// is NOT a chain continuation: it has a net-negative bracket delta and is already
// resolved to its opener by `blockOpenerLineFor`, so the whole block still moves.
function isChainContinuationLine(maskedLine: string): boolean {
  const trimmed = stripLineComment(maskedLine).trim();

  if (!trimmed.startsWith("}")) {
    return false;
  }

  const afterClose = trimmed.slice(1).trim();

  if (/^(?:else\b|elseif\b|catch\b|finally\b|while\b)/.test(afterClose)) {
    return true;
  }

  // Closes the previous arm and reopens another block on the same line.
  return afterClose.includes("{");
}

// True for a `switch` arm label (`case ...:` / `default:`). Case bodies carry no
// braces, so a label is the only boundary between fall-through arms; a swap that
// crosses one would scramble the control flow.
function isCaseLabelLine(maskedLine: string): boolean {
  const trimmed = stripLineComment(maskedLine).trim();

  return /^case\b/.test(trimmed) || /^default\s*:/.test(trimmed);
}

// Net change in `(` / `[` depth only (ignores `{`). Used to detect inline
// expression continuations without mistaking a block opener for one.
function parenDelta(maskedLine: string): number {
  let delta = 0;

  for (const character of maskedLine) {
    if (character === "(" || character === "[") {
      delta += 1;
      continue;
    }

    if (character === ")" || character === "]") {
      delta -= 1;
    }
  }

  return delta;
}

// Given a confirmed statement start line, finds the line that ends it. When the
// start line opens more brackets than it closes, the statement is a block and we
// scan forward to the line where the depth returns to zero. Otherwise the
// statement is a single line. Returns null if the block never balances.
function statementRangeFrom(
  masked: string[],
  start: number,
): StatementRange | null {
  let depth = bracketDelta(stripLineComment(masked[start - 1]));

  if (depth < 0) {
    return null;
  }

  if (depth === 0) {
    return { end: start, start };
  }

  for (let line = start + 1; line <= masked.length; line += 1) {
    depth += bracketDelta(stripLineComment(masked[line - 1]));

    if (depth < 0) {
      return null;
    }

    if (depth === 0) {
      return { end: line, start };
    }
  }

  return null;
}

// Locates the adjacent statement to swap with. For "up" it is the statement
// ending on the line directly above the current range; for "down" the statement
// starting directly below. Returns null at a file edge or when the neighbour
// cannot be resolved into a balanced range.
function neighbourRange(
  lines: string[],
  masked: string[],
  current: StatementRange,
  direction: MoveStatementDirection,
): StatementRange | null {
  if (direction === "up") {
    return neighbourAbove(lines, masked, current);
  }

  return neighbourBelow(lines, masked, current);
}

function neighbourAbove(
  lines: string[],
  masked: string[],
  current: StatementRange,
): StatementRange | null {
  const above = current.start - 1;

  if (above < 1) {
    return null;
  }

  if (lines[above - 1].trim().length === 0) {
    return null;
  }

  const neighbour = statementRangeAt(lines, masked, above);

  if (!neighbour || neighbour.end !== above) {
    return null;
  }

  return neighbour;
}

function neighbourBelow(
  lines: string[],
  masked: string[],
  current: StatementRange,
): StatementRange | null {
  const below = current.end + 1;

  if (below > lines.length) {
    return null;
  }

  if (lines[below - 1].trim().length === 0) {
    return null;
  }

  const neighbour = statementRangeAt(lines, masked, below);

  if (!neighbour || neighbour.start !== below) {
    return null;
  }

  return neighbour;
}

// Produces the combined edit that swaps the two adjacent ranges. The caret
// follows the moved statement to its new first line.
function buildSwapEdit(
  lines: string[],
  current: StatementRange,
  neighbour: StatementRange,
  direction: MoveStatementDirection,
): MoveStatementEdit {
  if (direction === "up") {
    const startLine = neighbour.start;
    const endLine = current.end;
    const currentLines = lines.slice(current.start - 1, current.end);
    const neighbourLines = lines.slice(neighbour.start - 1, neighbour.end);

    return {
      caretLine: startLine,
      endLine,
      newText: [...currentLines, ...neighbourLines].join("\n"),
      startLine,
    };
  }

  const startLine = current.start;
  const endLine = neighbour.end;
  const currentLines = lines.slice(current.start - 1, current.end);
  const neighbourLines = lines.slice(neighbour.start - 1, neighbour.end);
  const caretLine = startLine + neighbourLines.length;

  return {
    caretLine,
    endLine,
    newText: [...neighbourLines, ...currentLines].join("\n"),
    startLine,
  };
}

// Returns the index of the closest non-blank line above `line`, or null when
// there is none.
function previousCodeLine(lines: string[], line: number): number | null {
  for (let candidate = line - 1; candidate >= 1; candidate -= 1) {
    if (lines[candidate - 1].trim().length > 0) {
      return candidate;
    }
  }

  return null;
}

// Net change in bracket depth for a masked line, counting `(`, `[`, `{` as +1
// and their closers as -1.
function bracketDelta(maskedLine: string): number {
  let delta = 0;

  for (const character of maskedLine) {
    if (character === "(" || character === "[" || character === "{") {
      delta += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      delta -= 1;
    }
  }

  return delta;
}

// Drops a trailing `//` / `#` comment body so its characters never reach the
// bracket counter. The opener position is found on the already-masked line.
function stripLineComment(maskedLine: string): string {
  const slash = maskedLine.indexOf("//");
  const hash = maskedLine.indexOf("#");
  const candidates = [slash, hash].filter((index) => index >= 0);

  if (candidates.length === 0) {
    return maskedLine;
  }

  return maskedLine.slice(0, Math.min(...candidates));
}

interface MaskState {
  // Closing identifier of the heredoc/nowdoc currently open, or null when none.
  heredocTag: string | null;
  insideBlockComment: boolean;
}

export interface MaskedSource {
  // 1-based line numbers that belong to a heredoc/nowdoc literal: the opener
  // line, every body line, and the closing-identifier line. Splitting a swap
  // through any of these turns code into a string (or vice versa), so they are
  // hard boundaries.
  heredocLines: Set<number>;
  masked: string[];
}

// Masks every line while carrying `/* */` block-comment and heredoc/nowdoc state
// across line boundaries, so a construct opened on one line keeps masking the
// brackets on the lines below it. Single-line maskers cannot do this, which would
// otherwise let braces inside a multi-line comment or heredoc literal corrupt the
// bracket-depth scan. Also collects the heredoc line span for boundary guards.
function maskSourceLines(lines: string[]): MaskedSource {
  const state: MaskState = { heredocTag: null, insideBlockComment: false };
  const heredocLines = new Set<number>();

  const masked = lines.map((line, index) => {
    const openBefore = state.heredocTag;
    const result = maskLine(line, state);
    const openAfter = state.heredocTag;
    const isHeredocLine = openBefore !== null || openAfter !== null;

    if (isHeredocLine) {
      heredocLines.add(index + 1);
    }

    return result;
  });

  return { heredocLines, masked };
}

// Matches the closing identifier line of a heredoc/nowdoc. PHP allows the closer
// to be indented and to be followed immediately by `;`, `,`, `)` or `]` (or
// nothing). Anything after that is irrelevant to brace balancing here.
function isHeredocCloser(line: string, tag: string): boolean {
  const closer = new RegExp(`^\\s*${tag}\\b`);

  return closer.test(line);
}

// Detects a heredoc/nowdoc opener on a line and returns its closing identifier.
// `<<<EOT`, `<<<"EOT"` (heredoc) and `<<<'EOT'` (nowdoc) all share the same
// closing identifier `EOT`. Returns null when the line opens no heredoc.
function heredocOpenerTag(maskedLine: string): string | null {
  const match = /<<<\s*['"]?([A-Za-z_]\w*)['"]?/.exec(maskedLine);

  if (!match) {
    return null;
  }

  return match[1] || null;
}

// Blanks an entire line to spaces, preserving length so column-based logic is
// unaffected. Used for heredoc/nowdoc body lines, whose contents are literal.
function blankLine(line: string): string {
  return " ".repeat(line.length);
}

// Replaces the contents of single-line string literals and `/* */` comment
// bodies with spaces so structural characters inside them never affect brace
// balancing. The `//` / `#` openers are preserved so `stripLineComment` can find
// them; their bodies are copied verbatim (safe per line). `state` is mutated to
// report whether the line ends still inside an open block comment or heredoc.
function maskLine(line: string, state: MaskState): string {
  if (state.heredocTag !== null) {
    const closed = isHeredocCloser(line, state.heredocTag);
    state.heredocTag = closed ? null : state.heredocTag;

    // Both the body and the closing-identifier line are literal text for our
    // purposes: blank them so any braces they hold never reach the scanner.
    return blankLine(line);
  }

  let masked = "";
  let quote: string | null = null;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index] || "";
    const next = line[index + 1] || "";

    if (state.insideBlockComment) {
      if (character === "*" && next === "/") {
        masked += "  ";
        index += 1;
        state.insideBlockComment = false;
        continue;
      }

      masked += " ";
      continue;
    }

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
      return finishMaskedLine(masked, state);
    }

    if (character === "#") {
      masked += line.slice(index);
      return finishMaskedLine(masked, state);
    }

    if (character === "/" && next === "*") {
      masked += "  ";
      index += 1;
      state.insideBlockComment = true;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      masked += " ";
      continue;
    }

    masked += character;
  }

  return finishMaskedLine(masked, state);
}

// Finalises a masked line: if it opened a heredoc/nowdoc, records the closing
// identifier in `state` so the masker blanks every body line that follows. The
// opener's own `<<<TAG` text stays as-is on this line (it carries no braces).
// The trailing line-comment body is dropped first so a `// <<<EOT` mention never
// masks the lines below it as a phantom heredoc.
function finishMaskedLine(masked: string, state: MaskState): string {
  const tag = heredocOpenerTag(stripLineComment(masked));
  state.heredocTag = tag === null ? state.heredocTag : tag;

  return masked;
}

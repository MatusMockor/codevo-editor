/**
 * Pure planning for the "Extract variable" refactoring on PHP source.
 *
 * Given a character selection that forms an expression, this produces a plan
 * that an editor adapter can apply as two edits:
 *   1. insert `<indent>$name = <expr>;\n` on its own line before the enclosing
 *      statement, and
 *   2. replace the original selection with `$name`.
 *
 * The planner is intentionally conservative: when the selection is not a
 * confidently-usable expression (empty, whitespace, contains a statement
 * terminator, has unbalanced brackets/quotes, or sits at out-of-range offsets)
 * it returns `null` rather than offering a risky extraction.
 *
 * It follows the masking/balanced/offset style of `phpClassStructure.ts`:
 * strings and comments are masked to spaces before structural reasoning so
 * that punctuation inside literals never affects validation or line detection.
 */

export interface ExtractVariablePlan {
  declarationOffset: number;
  declarationText: string;
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
}

const DEFAULT_VARIABLE_NAME = "$extracted";

export function planExtractVariable(
  source: string,
  selectionStart: number,
  selectionEnd: number,
  variableName?: string,
): ExtractVariablePlan | null {
  const range = normalizeSelection(source, selectionStart, selectionEnd);

  if (!range) {
    return null;
  }

  const trimmed = trimSelection(source, range.start, range.end);

  if (!trimmed) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const maskedSelection = masked.slice(trimmed.start, trimmed.end);
  const rawSelection = source.slice(trimmed.start, trimmed.end);

  if (!isExtractableExpression(rawSelection, maskedSelection)) {
    return null;
  }

  // The operator guards reason over a STRUCTURAL view where masked-out literal
  // bodies (strings/heredocs/comments) become a value placeholder, so a string
  // at the boundary (`$a . 'foo'`) is not mistaken for a dangling operator and
  // adjacency/precedence sees the literal as real content.
  const structural = structuralMask(source, masked);

  // A selection that ends or starts with a dangling binary/arrow operator is an
  // incomplete expression; extracting it produces broken code (`$a +;`) or
  // merges identifiers (`$a->` + `b` → `$extractedb`).
  if (hasDanglingOperator(structural, trimmed.start, trimmed.end)) {
    return null;
  }

  // A clean sub-expression must not be "masked" by a higher-precedence operator
  // immediately outside it: extracting `$a ?? $b` out of `$base + $a ?? $b`
  // silently re-parses the statement. Reject when an adjacent operator binds
  // tighter than the selection's own lowest-precedence top-level operator.
  if (!isPrecedenceSafe(structural, trimmed.start, trimmed.end)) {
    return null;
  }

  const name = normalizeVariableName(variableName);

  if (!name) {
    return null;
  }

  const expression = source.slice(trimmed.start, trimmed.end);
  const lineStart = lineStartOffset(source, trimmed.start);
  const indent = indentOf(source, lineStart);

  return {
    declarationOffset: lineStart,
    declarationText: `${indent}${name} = ${expression};\n`,
    replaceStart: trimmed.start,
    replaceEnd: trimmed.end,
    replacementText: name,
  };
}

function normalizeSelection(
  source: string,
  selectionStart: number,
  selectionEnd: number,
): { start: number; end: number } | null {
  if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) {
    return null;
  }

  if (selectionStart < 0 || selectionEnd > source.length) {
    return null;
  }

  if (selectionStart >= selectionEnd) {
    return null;
  }

  return { start: selectionStart, end: selectionEnd };
}

function trimSelection(
  source: string,
  start: number,
  end: number,
): { start: number; end: number } | null {
  let trimmedStart = start;
  let trimmedEnd = end;

  while (trimmedStart < trimmedEnd && isWhitespace(source[trimmedStart])) {
    trimmedStart += 1;
  }

  while (trimmedEnd > trimmedStart && isWhitespace(source[trimmedEnd - 1])) {
    trimmedEnd -= 1;
  }

  if (trimmedStart >= trimmedEnd) {
    return null;
  }

  return { start: trimmedStart, end: trimmedEnd };
}

function isExtractableExpression(
  rawSelection: string,
  maskedSelection: string,
): boolean {
  if (!rawSelection.trim()) {
    return false;
  }

  if (containsStatementTerminator(maskedSelection)) {
    return false;
  }

  if (!hasBalancedBrackets(maskedSelection)) {
    return false;
  }

  return hasExpressionContent(rawSelection, maskedSelection);
}

function containsStatementTerminator(maskedSelection: string): boolean {
  return (
    maskedSelection.includes(";") ||
    maskedSelection.includes("{") ||
    maskedSelection.includes("}")
  );
}

/**
 * Rejects selections whose masked form is nothing but operators/whitespace.
 * A usable expression must contain an identifier, variable, literal digit, or a
 * balanced bracket group in its masked (structural) form. A selection that
 * masks down to whitespace is only accepted when its raw form is a complete,
 * single string literal (e.g. `'a;b'`) rather than a comment fragment.
 */
function hasExpressionContent(
  rawSelection: string,
  maskedSelection: string,
): boolean {
  if (/[A-Za-z0-9_$]/.test(maskedSelection) || /[(\[]/.test(maskedSelection)) {
    return true;
  }

  return isCompleteStringLiteral(rawSelection);
}

function isCompleteStringLiteral(rawSelection: string): boolean {
  return /^'(?:\\.|[^'\\])*'$/s.test(rawSelection) || /^"(?:\\.|[^"\\])*"$/s.test(rawSelection);
}

function hasBalancedBrackets(maskedSelection: string): boolean {
  const stack: string[] = [];
  const closing: Record<string, string> = { ")": "(", "]": "[", "}": "{" };

  for (const character of maskedSelection) {
    if (character === "(" || character === "[" || character === "{") {
      stack.push(character);
      continue;
    }

    const expectedOpen = closing[character];

    if (!expectedOpen) {
      continue;
    }

    if (stack.pop() !== expectedOpen) {
      return false;
    }
  }

  return stack.length === 0;
}

/**
 * Binary / accessor operators ordered LONGEST-FIRST so a maximal-munch scan
 * never mistakes a prefix (`<` of `<<`, `?` of `??`, `-` of `->`) for a shorter
 * operator. Each carries a PHP precedence level (higher binds tighter); accessor
 * operators (`->`, `?->`, `::`) sit above every arithmetic operator. The level
 * is only meaningful for binary operators — accessors are listed so a trailing
 * accessor is recognised as a dangling (incomplete) operator.
 */
const BINARY_OPERATORS: { token: string; precedence: number }[] = [
  { token: "?->", precedence: 20 },
  { token: "->", precedence: 20 },
  { token: "::", precedence: 20 },
  { token: "**", precedence: 19 },
  { token: "<<", precedence: 14 },
  { token: ">>", precedence: 14 },
  { token: "<=>", precedence: 12 },
  { token: "===", precedence: 11 },
  { token: "!==", precedence: 11 },
  { token: "==", precedence: 11 },
  { token: "!=", precedence: 11 },
  { token: "<=", precedence: 12 },
  { token: ">=", precedence: 12 },
  { token: "&&", precedence: 7 },
  { token: "||", precedence: 6 },
  { token: "??", precedence: 5 },
  { token: "*", precedence: 18 },
  { token: "/", precedence: 18 },
  { token: "%", precedence: 18 },
  { token: "+", precedence: 17 },
  { token: "-", precedence: 17 },
  { token: ".", precedence: 17 },
  { token: "<", precedence: 12 },
  { token: ">", precedence: 12 },
  { token: "&", precedence: 10 },
  { token: "^", precedence: 9 },
  { token: "|", precedence: 8 },
  { token: "?", precedence: 4 },
  { token: ":", precedence: 4 },
];

const TRAILING_OPERATOR_TOKENS = BINARY_OPERATORS.map(
  (operator) => operator.token,
);

// Unary prefix characters that legitimately START an expression (`!$x`, `-$x`,
// `+$x`, `~$x`); a leading occurrence of one of these is not a dangling binary
// operator and must not block extraction.
const UNARY_PREFIX_CHARS = new Set(["!", "-", "+", "~"]);

const LITERAL_PLACEHOLDER = "0";

/**
 * A structural view of the source for the operator guards: identical to the
 * string/comment-masked source, except every position that the mask blanked to a
 * space while the RAW source held a non-whitespace character (a string/heredoc
 * body or comment) becomes a value placeholder. This keeps operators, brackets
 * and identifiers exactly where they are while making a boundary literal count
 * as real content — so `$a . 'foo'` no longer looks like a trailing `.` and a
 * literal next to the selection is seen by the adjacency/precedence checks.
 */
function structuralMask(source: string, masked: string): string {
  let output = "";

  for (let index = 0; index < masked.length; index += 1) {
    const maskedChar = masked[index] || "";
    const rawChar = source[index] || "";
    const isMaskedLiteral =
      maskedChar === " " && rawChar !== " " && !isWhitespace(rawChar);

    output += isMaskedLiteral ? LITERAL_PLACEHOLDER : maskedChar;
  }

  return output;
}

/**
 * True when the masked selection (`[start, end)`) is an incomplete expression
 * because it ends with a trailing binary/accessor operator (`$a +`, `$a->`,
 * `Foo::`) or begins with a leading binary operator that is not a unary prefix
 * (`+ $b`, `. $b`, `->b`). A trailing operator is ALWAYS incomplete; a leading
 * binary operator is incomplete unless it is a genuine unary prefix (`!`, `-`,
 * `+`, `~`) — disambiguated against the source character before the selection.
 */
function hasDanglingOperator(
  masked: string,
  start: number,
  end: number,
): boolean {
  const trimmed = masked.slice(start, end).trim();

  if (trimmed.length === 0) {
    return false;
  }

  return endsWithOperator(trimmed) || startsWithBinaryOperator(masked, start, trimmed);
}

function endsWithOperator(trimmed: string): boolean {
  return TRAILING_OPERATOR_TOKENS.some((token) => trimmed.endsWith(token));
}

/**
 * True when the trimmed selection opens with a leading binary operator rather
 * than a unary prefix. An accessor (`->`, `?->`, `::`) is always a dangling
 * leading operator. A leading `-`/`+`/`!`/`~` is a unary prefix (allowed) UNLESS
 * a value immediately precedes the selection in the source, which makes it the
 * tail of a binary operator (`$a + $b` with `+ $b` selected).
 */
function startsWithBinaryOperator(
  masked: string,
  start: number,
  trimmed: string,
): boolean {
  const leadingOperator = binaryOperatorAt(trimmed, 0);

  if (!leadingOperator) {
    return false;
  }

  if (isAccessorToken(leadingOperator.token)) {
    return true;
  }

  if (!UNARY_PREFIX_CHARS.has(leadingOperator.token)) {
    return true;
  }

  return valuePrecedesSelection(masked, start);
}

/**
 * True when a value (identifier/variable/literal char or closing bracket)
 * immediately precedes the selection start in the masked source — meaning a
 * leading `+`/`-`/etc. is a binary continuation, not a unary prefix.
 */
function valuePrecedesSelection(masked: string, start: number): boolean {
  let index = start - 1;

  while (index >= 0 && isWhitespace(masked[index])) {
    index -= 1;
  }

  if (index < 0) {
    return false;
  }

  const previousChar = masked[index] || "";

  return (
    /[A-Za-z0-9_$]/.test(previousChar) ||
    previousChar === ")" ||
    previousChar === "]" ||
    previousChar === "}"
  );
}

/**
 * True when extracting the selection cannot change how the statement parses.
 *
 * Safe when the selection is a single primary (no top-level binary operator) or
 * when no adjacent operator binds at least as tightly as the selection's own
 * lowest-precedence top-level operator. Unsafe (returns false) when an operator
 * immediately before OR after the selection has precedence GREATER THAN OR EQUAL
 * to that lowest operator:
 *   - a strictly-higher neighbour pulls the selection out of a tighter binding
 *     (`$base + $a ?? $b` → extracting `$a ?? $b` re-parses the statement),
 *   - an EQUAL-precedence neighbour re-associates a left-associative chain
 *     (`$a - $b - $c` → extracting `$b - $c` flips `(a-b)-c` to `a-(b-c)`),
 *     which silently changes the result for non-commutative operators.
 * Conservatively declines both rather than reasoning about per-operator
 * associativity/commutativity. A neighbour binding strictly LOOSER than the
 * selection (extracting a tighter sub-expression) stays safe.
 */
function isPrecedenceSafe(
  masked: string,
  start: number,
  end: number,
): boolean {
  const lowest = lowestTopLevelPrecedence(masked.slice(start, end));

  if (lowest === null) {
    return true;
  }

  const before = adjacentOperatorBefore(masked, start);
  const after = adjacentOperatorAfter(masked, end);

  if (before !== null && before >= lowest) {
    return false;
  }

  return after === null || after < lowest;
}

/**
 * The precedence of the lowest-binding binary operator at bracket-depth 0 within
 * the masked selection, or `null` when the selection has no top-level binary
 * operator (a single primary: variable, literal, call, whole `(...)`/`[...]`).
 * Accessor operators (`->`, `?->`, `::`) are skipped: a property/method chain is
 * a single primary, not a re-associable binary expression.
 */
function lowestTopLevelPrecedence(maskedSelection: string): number | null {
  let depth = 0;
  let lowest: number | null = null;
  let index = 0;

  while (index < maskedSelection.length) {
    const character = maskedSelection[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      index += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      index += 1;
      continue;
    }

    if (depth > 0) {
      index += 1;
      continue;
    }

    const operator = binaryOperatorAt(maskedSelection, index);

    if (!operator) {
      index += 1;
      continue;
    }

    if (!isAccessorToken(operator.token) && isBinaryPosition(maskedSelection, index)) {
      lowest = lowest === null ? operator.precedence : Math.min(lowest, operator.precedence);
    }

    index += operator.token.length;
  }

  return lowest;
}

/**
 * The longest binary/accessor operator token starting exactly at `index` in the
 * masked text, or `null` when no operator begins there. Maximal-munch over
 * {@link BINARY_OPERATORS} (already ordered longest-first).
 */
function binaryOperatorAt(
  masked: string,
  index: number,
): { token: string; precedence: number } | null {
  for (const operator of BINARY_OPERATORS) {
    if (masked.startsWith(operator.token, index)) {
      return operator;
    }
  }

  return null;
}

function isAccessorToken(token: string): boolean {
  return token === "->" || token === "?->" || token === "::";
}

/**
 * Distinguishes a BINARY operator occurrence from a unary prefix. An operator at
 * `index` is binary only when a value (identifier/variable/literal char or a
 * closing bracket) precedes it; a leading `-`/`+`/`!`/`~` with no preceding value
 * is a unary prefix and must not count as a top-level binary operator.
 */
function isBinaryPosition(masked: string, index: number): boolean {
  let previous = index - 1;

  while (previous >= 0 && isWhitespace(masked[previous])) {
    previous -= 1;
  }

  if (previous < 0) {
    return false;
  }

  const previousChar = masked[previous] || "";

  return (
    /[A-Za-z0-9_$]/.test(previousChar) ||
    previousChar === ")" ||
    previousChar === "]" ||
    previousChar === "}"
  );
}

/**
 * The precedence of the binary operator that ends immediately before the
 * selection (skipping whitespace leftwards), or `null` when no binary operator
 * abuts the selection (e.g. it sits after `(`, `,`, `=`, or a statement start).
 * A leading `=`/`,`/`(`/etc. is not a re-associable binary operator here.
 */
function adjacentOperatorBefore(masked: string, start: number): number | null {
  let index = start - 1;

  while (index >= 0 && isWhitespace(masked[index])) {
    index -= 1;
  }

  if (index < 0) {
    return null;
  }

  return operatorEndingAt(masked, index);
}

/**
 * The precedence of the binary operator that begins immediately after the
 * selection (skipping whitespace rightwards), or `null` when no binary operator
 * abuts the selection (e.g. it is followed by `)`, `,`, `;`, or end of input).
 */
function adjacentOperatorAfter(masked: string, end: number): number | null {
  let index = end;

  while (index < masked.length && isWhitespace(masked[index])) {
    index += 1;
  }

  if (index >= masked.length) {
    return null;
  }

  const operator = binaryOperatorAt(masked, index);

  return operator ? operator.precedence : null;
}

/**
 * The precedence of the binary/accessor operator whose LAST character sits at
 * `index`, or `null` when no operator ends there. Tries the longest tokens first
 * so `>>` is not read as a single `>`.
 */
function operatorEndingAt(masked: string, index: number): number | null {
  for (const operator of BINARY_OPERATORS) {
    const tokenStart = index - operator.token.length + 1;

    if (tokenStart < 0) {
      continue;
    }

    if (masked.startsWith(operator.token, tokenStart)) {
      return operator.precedence;
    }
  }

  return null;
}

function normalizeVariableName(variableName: string | undefined): string | null {
  if (variableName === undefined) {
    return DEFAULT_VARIABLE_NAME;
  }

  const withoutDollar = variableName.trim().replace(/^\$+/, "");

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(withoutDollar)) {
    return null;
  }

  return `$${withoutDollar}`;
}

function lineStartOffset(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", offset - 1);

  return newline + 1;
}

function indentOf(source: string, lineStart: number): string {
  let index = lineStart;

  while (index < source.length && isHorizontalWhitespace(source[index])) {
    index += 1;
  }

  return source.slice(lineStart, index);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

/**
 * Masks string literals, comments and heredocs to spaces (newlines preserved)
 * so structural punctuation inside them is ignored. Mirrors the masking style
 * used by `phpClassStructure.ts` but kept self-contained to this module.
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

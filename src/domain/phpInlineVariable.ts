/**
 * Pure planning for the PhpStorm-parity "Inline variable" refactoring on PHP
 * source — the inverse of "Extract variable" (`phpExtractVariable.ts`).
 *
 * Given a cursor offset that lands on a local variable with a simple
 * single-assignment declaration (`$var = <expr>;`) inside one function/method
 * body, this plans a set of non-overlapping edits that:
 *   1. delete the declaration statement (the whole `<indent>$var = expr;\n`
 *      line), and
 *   2. replace every later usage of `$var` in that body with `<expr>`,
 *      parenthesised when the surrounding operator precedence requires it.
 *
 * The planner is deliberately CONSERVATIVE — a refactor must never silently
 * change behaviour. It returns `null` (no action offered) when inlining could be
 * unsafe or its correctness is uncertain:
 *   - the variable is assigned more than once (its value changes),
 *   - the declaration is not a plain `$var = expr;` (`+=`, `.=`, `foreach as`,
 *     parameter, list assignment, …),
 *   - the variable is read before its declaration,
 *   - the declaration's right-hand side references the variable itself,
 *   - the value would be DUPLICATED (used more than once) and its expression may
 *     carry side effects (contains a function/method call) — re-running it would
 *     change semantics,
 *   - `$this` (never a plain local), or the cursor is not on a local variable.
 *
 * It follows the masking/balanced/offset style of `phpExtractVariable.ts` and
 * `phpIntroduceMember.ts`: strings and comments are masked to spaces before any
 * structural reasoning, so punctuation inside literals never affects detection.
 * Offsets in the masked string map 1:1 to the original.
 */

export interface InlineVariableEdit {
  end: number;
  start: number;
  text: string;
}

export interface InlineVariablePlan {
  edits: InlineVariableEdit[];
}

interface VariableToken {
  end: number;
  name: string;
  start: number;
}

interface Declaration {
  exprEnd: number;
  exprStart: number;
  semicolon: number;
  varStart: number;
}

interface FunctionBody {
  end: number;
  start: number;
}

export function planInlineVariable(
  source: string,
  offset: number,
): InlineVariablePlan | null {
  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const variable = variableAt(masked, offset);

  if (!variable || variable.name === "this") {
    return null;
  }

  const body = enclosingFunctionBody(masked, variable.start);

  if (!body) {
    return null;
  }

  // The variable's value may be read by name (`compact('x')`, `extract(...)`,
  // `get_defined_vars()`, or `$$ref`) — those reads cannot be resolved to the
  // inlined expression, so inlining would silently drop the variable.
  if (bodyReadsVariablesByName(masked, body)) {
    return null;
  }

  const occurrences = variableOccurrences(masked, body, variable.name);

  if (occurrences.length < 2) {
    return null;
  }

  // A capture in a closure `use (...)` clause or any reference inside a nested
  // closure / arrow-function body is not a plain usage in the outer scope:
  // rewriting a `use ($var)` capture into an expression is a fatal parse error,
  // and substituting into a nested scope that captured the value changes
  // semantics. Decline whenever any occurrence falls in either position.
  if (occurrences.some((occurrence) => isCaptureOrNestedReference(masked, body, occurrence))) {
    return null;
  }

  const declaration = simpleAssignmentDeclaration(
    source,
    masked,
    occurrences[0],
  );

  if (!declaration) {
    return null;
  }

  const usages = occurrences.slice(1);

  if (usages.some((usage) => isAssignmentTarget(masked, usage))) {
    return null;
  }

  // Also include the declaration occurrence: a by-ref pass / write on the very
  // declaration line (rare, but `sort($x)` could appear there) still mutates it.
  if (occurrences.some((usage) => passedToByReferenceBuiltin(masked, usage))) {
    return null;
  }

  if (referencesSelf(masked, declaration, variable.name)) {
    return null;
  }

  const expression = source.slice(declaration.exprStart, declaration.exprEnd);

  if (!isSafeToDuplicate(masked, declaration, usages.length)) {
    return null;
  }

  return {
    edits: [
      deleteDeclarationEdit(source, declaration),
      ...usages.map((usage) => replaceUsageEdit(masked, usage, expression)),
    ],
  };
}

/**
 * Resolves the `$name` local variable token the cursor sits on (anywhere on the
 * `$` or the identifier). Returns `null` when the offset is not within a
 * variable token.
 */
function variableAt(masked: string, offset: number): VariableToken | null {
  const start = variableStartAt(masked, offset);

  if (start === null) {
    return null;
  }

  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(masked.slice(start));
  const name = match?.[1];

  if (!name) {
    return null;
  }

  return { end: start + match[0].length, name, start };
}

function variableStartAt(masked: string, offset: number): number | null {
  if (masked[offset] === "$") {
    return offset;
  }

  if (!isIdentifierChar(masked[offset] || "")) {
    return null;
  }

  let index = offset;

  while (index > 0 && isIdentifierChar(masked[index - 1] || "")) {
    index -= 1;
  }

  if (masked[index - 1] === "$") {
    return index - 1;
  }

  return null;
}

/**
 * Resolves the `{ ... }` body range of the function/method whose body directly
 * encloses the offset. Walks every `function` keyword and keeps the innermost
 * matching body so closures and nested functions are scoped correctly. Returns
 * `null` when the offset is not inside any function body (top-level code).
 */
function enclosingFunctionBody(
  masked: string,
  offset: number,
): FunctionBody | null {
  const pattern = /\bfunction\b/g;
  let best: FunctionBody | null = null;

  for (
    let match = pattern.exec(masked);
    match;
    match = pattern.exec(masked)
  ) {
    const body = functionBodyRange(masked, match.index ?? 0);

    if (!body || offset <= body.start || offset >= body.end) {
      continue;
    }

    if (!best || body.start > best.start) {
      best = body;
    }
  }

  return best;
}

function functionBodyRange(
  masked: string,
  functionOffset: number,
): FunctionBody | null {
  const openParen = masked.indexOf("(", functionOffset);

  if (openParen < 0) {
    return null;
  }

  const closeParen = matchingPairOffset(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const bodyStart = nextBraceOrSemicolon(masked, closeParen + 1);

  if (bodyStart === null || masked[bodyStart] !== "{") {
    return null;
  }

  const bodyEnd = matchingBraceOffset(masked, bodyStart);

  if (bodyEnd === null) {
    return null;
  }

  return { end: bodyEnd, start: bodyStart };
}

/**
 * Every `$name` occurrence (as a whole variable token) inside the function body,
 * in document order, counted over the MASKED source so a `$name` inside a string
 * or comment never counts.
 */
function variableOccurrences(
  masked: string,
  body: FunctionBody,
  name: string,
): VariableToken[] {
  const pattern = new RegExp(`\\$${name}(?![A-Za-z0-9_])`, "g");
  pattern.lastIndex = body.start;
  const tokens: VariableToken[] = [];

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < body.end;
    match = pattern.exec(masked)
  ) {
    const start = match.index ?? 0;
    tokens.push({ end: start + match[0].length, name, start });
  }

  return tokens;
}

interface Range {
  end: number;
  start: number;
}

/**
 * True when the enclosing function body reads locals by their string name —
 * `compact(...)`, `extract(...)`, `get_defined_vars()`, or a variable-variable
 * `$$ref`. Such reads resolve a local indirectly (by name, not by token), so
 * the planner cannot prove `$var` is unused after inlining and would risk
 * silently dropping its value. Conservatively declines whenever any of these
 * constructs appear anywhere in the body. Detected on the MASKED body so a
 * lookalike inside a string/comment never triggers it; `compact`/`extract` are
 * matched by callee name (their string argument is the mechanism), so the exact
 * referenced name need not be proven — presence of the call is enough. A
 * method call of the same name (`$c->compact()`, `Foo::extract()`) is excluded
 * via the `->`/`::` lookbehind so it never wrongly declines a valid inline.
 */
function bodyReadsVariablesByName(masked: string, body: FunctionBody): boolean {
  const region = masked.slice(body.start, body.end);

  if (/\$\$/.test(region)) {
    return true;
  }

  return /(?<![>:])\b(?:compact|extract|get_defined_vars)\s*\(/.test(region);
}

/**
 * True when this occurrence is not a plain outer-scope usage but a capture in a
 * closure `use (...)` clause or a reference inside a nested closure /
 * arrow-function body. Walks every nested `function`/`fn` declared inside the
 * enclosing body and tests the occurrence against its use-clause and body spans.
 */
function isCaptureOrNestedReference(
  masked: string,
  body: FunctionBody,
  occurrence: VariableToken,
): boolean {
  return nestedCallables(masked, body).some(
    (callable) =>
      isWithin(callable.body, occurrence) ||
      (callable.useClause !== null && isWithin(callable.useClause, occurrence)),
  );
}

interface NestedCallable {
  body: Range;
  useClause: Range | null;
}

/**
 * Every closure / arrow function whose declaration sits strictly INSIDE the
 * enclosing body (nested scopes), with its `use (...)` capture clause span (when
 * present) and its body span. Used to detect occurrences that are captures or
 * nested-scope references rather than plain outer-scope usages.
 */
function nestedCallables(masked: string, body: FunctionBody): NestedCallable[] {
  const callables: NestedCallable[] = [];
  const pattern = /\b(?:function|fn)\b/g;
  pattern.lastIndex = body.start + 1;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < body.end;
    match = pattern.exec(masked)
  ) {
    const keyword = match[0];
    const keywordOffset = match.index ?? 0;
    const callable = keyword === "fn"
      ? arrowCallable(masked, keywordOffset, body)
      : closureCallable(masked, keywordOffset, body);

    if (callable) {
      callables.push(callable);
    }
  }

  return callables;
}

/**
 * Resolves a nested `function (...) [use (...)] { ... }` closure: its body span
 * and the span of its `use (...)` capture clause when one is present. Returns
 * `null` for the enclosing function itself or a malformed declaration.
 */
function closureCallable(
  masked: string,
  keywordOffset: number,
  body: FunctionBody,
): NestedCallable | null {
  const openParen = masked.indexOf("(", keywordOffset);

  if (openParen < 0) {
    return null;
  }

  const closeParen = matchingPairOffset(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const useClause = closureUseClause(masked, closeParen + 1);
  const braceSearchStart = useClause ? useClause.end : closeParen + 1;
  const bodyStart = nextBraceOrSemicolon(masked, braceSearchStart);

  if (bodyStart === null || masked[bodyStart] !== "{") {
    return null;
  }

  const bodyEnd = matchingBraceOffset(masked, bodyStart);

  if (bodyEnd === null || bodyStart < body.start || bodyEnd > body.end) {
    return null;
  }

  return { body: { end: bodyEnd, start: bodyStart }, useClause };
}

/**
 * When a `use (...)` capture clause follows the closure parameter list, returns
 * its parenthesised span (so a captured `$var` there is recognised as a
 * non-inlinable capture). Returns `null` when no `use` clause is present.
 */
function closureUseClause(masked: string, from: number): Range | null {
  const index = skipWhitespace(masked, from);
  const match = /^use\b/.exec(masked.slice(index));

  if (!match) {
    return null;
  }

  const openParen = skipWhitespace(masked, index + match[0].length);

  if (masked[openParen] !== "(") {
    return null;
  }

  const closeParen = matchingPairOffset(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  return { end: closeParen + 1, start: openParen };
}

/**
 * Resolves an arrow function `fn (...) => <expr>`: its body span runs from the
 * `=>` to the end of the expression (the next top-level `;`, `,`, or closing
 * bracket of the enclosing context). Arrow functions implicitly capture every
 * referenced outer variable by value, so any reference inside this span is a
 * capture and must not be inlined.
 */
function arrowCallable(
  masked: string,
  keywordOffset: number,
  body: FunctionBody,
): NestedCallable | null {
  const openParen = masked.indexOf("(", keywordOffset);

  if (openParen < 0 || openParen >= body.end) {
    return null;
  }

  const closeParen = matchingPairOffset(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const arrow = masked.indexOf("=>", closeParen + 1);

  if (arrow < 0 || arrow >= body.end) {
    return null;
  }

  const bodyEnd = arrowBodyEnd(masked, arrow + 2, body.end);

  return { body: { end: bodyEnd, start: arrow + 2 }, useClause: null };
}

/**
 * Finds where an arrow function's implicit body expression ends: the first
 * top-level `;` or `,` or an unbalanced closing `)`/`]`/`}` at depth 0, bounded
 * by the enclosing body end.
 */
function arrowBodyEnd(masked: string, from: number, limit: number): number {
  let depth = 0;

  for (let index = from; index < limit; index += 1) {
    const character = masked[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return index;
      }

      depth -= 1;
      continue;
    }

    if ((character === ";" || character === ",") && depth === 0) {
      return index;
    }
  }

  return limit;
}

function isWithin(range: Range, occurrence: VariableToken): boolean {
  return occurrence.start >= range.start && occurrence.end <= range.end;
}

/**
 * Confirms the FIRST occurrence of the variable is a plain `$var = <expr>;`
 * declaration (not `+=`/`.=`/`==`, not `foreach (... as $var)`, not a parameter
 * or list target) and returns the declaration line span plus the right-hand-side
 * expression span. Returns `null` for any non-plain declaration.
 */
function simpleAssignmentDeclaration(
  source: string,
  masked: string,
  first: VariableToken,
): Declaration | null {
  const beforeStart = lastNonWhitespace(masked, first.start - 1);

  if (boundToForeach(masked, first.start)) {
    return null;
  }

  // The token preceding the variable must be a statement boundary, never a
  // continuation that would make this a usage rather than a fresh declaration.
  // This also rejects `static $x = …;` / `global $x;` (the keyword precedes the
  // variable), whose persistence/binding semantics differ from a plain local.
  if (beforeStart !== null && !isStatementBoundary(masked[beforeStart] || "")) {
    return null;
  }

  const equals = skipWhitespace(masked, first.end);

  if (masked[equals] !== "=" || masked[equals + 1] === "=") {
    return null;
  }

  // A reference binding (`$x =& $y;` or `$x = &$y;`) aliases identity, not value
  // — never safe to inline as a plain expression.
  if (masked[skipWhitespace(masked, equals + 1)] === "&") {
    return null;
  }

  if (isComparisonOrCompoundLeadingChar(masked[equals - 1] || "")) {
    return null;
  }

  const exprStart = skipSourceWhitespace(source, equals + 1);
  const semicolon = statementTerminator(masked, exprStart, first);

  if (semicolon === null) {
    return null;
  }

  // The trailing trim runs over the ORIGINAL source: masking blanks string
  // literals to spaces, so trimming on the masked copy would walk back OVER a
  // string/heredoc that legitimately ends the expression and truncate it.
  const exprEnd = lastSourceNonWhitespace(source, semicolon - 1);

  if (exprEnd === null || exprEnd < exprStart) {
    return null;
  }

  return {
    exprEnd: exprEnd + 1,
    exprStart,
    semicolon,
    varStart: first.start,
  };
}

/**
 * A conservative set of common standard-library functions that take their array
 * (or other) argument BY REFERENCE and mutate it in place. When `$var` is passed
 * directly to one of these the variable's value is rewritten, so inlining the
 * declaration expression would lose that mutation — the refactor declines.
 *
 * This cannot cover arbitrary user functions with `&$param` (no signature info
 * in a pure single-file planner), so it is a best-effort safety net for the
 * highest-risk builtins, not an exhaustive guarantee.
 */
const BY_REFERENCE_BUILTINS = new Set([
  "sort",
  "rsort",
  "asort",
  "arsort",
  "ksort",
  "krsort",
  "usort",
  "uasort",
  "uksort",
  "natsort",
  "natcasesort",
  "shuffle",
  "array_push",
  "array_pop",
  "array_shift",
  "array_unshift",
  "array_splice",
  "array_multisort",
  "array_walk",
  "array_walk_recursive",
  "preg_match",
  "preg_match_all",
  "str_replace",
  "str_ireplace",
  "preg_replace",
  "settype",
  "end",
  "reset",
  "next",
  "prev",
  "each",
  "sscanf",
  "fscanf",
]);

/**
 * True when `$var` is passed directly as an argument to a known by-reference
 * builtin (`sort($var)`, `preg_match(..., $var)`, …). Detected on the masked
 * source: the variable must sit at argument depth 1 inside the call whose callee
 * is one of {@link BY_REFERENCE_BUILTINS}.
 */
function passedToByReferenceBuiltin(
  masked: string,
  usage: VariableToken,
): boolean {
  const call = enclosingCall(masked, usage.start);

  if (!call) {
    return false;
  }

  return BY_REFERENCE_BUILTINS.has(call.callee.toLowerCase());
}

/**
 * Resolves the innermost `callee(...)` call whose parentheses directly enclose
 * the offset (argument depth 1, no intervening nested call/bracket). Returns the
 * callee identifier or `null` when the offset is not a direct call argument.
 */
function enclosingCall(
  masked: string,
  offset: number,
): { callee: string } | null {
  let depth = 0;

  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = masked[index] || "";

    if (character === ")" || character === "]" || character === "}") {
      depth += 1;
      continue;
    }

    if (character === ";") {
      return null;
    }

    if (character !== "(" && character !== "[" && character !== "{") {
      continue;
    }

    if (depth > 0) {
      depth -= 1;
      continue;
    }

    // The first unmatched opener while scanning left: only a `(` whose callee is
    // an identifier is a function call argument position.
    return character === "(" ? calleeBefore(masked, index) : null;
  }

  return null;
}

function calleeBefore(masked: string, openParen: number): { callee: string } | null {
  let end = openParen;

  while (end > 0 && isWhitespace(masked[end - 1])) {
    end -= 1;
  }

  let start = end;

  while (start > 0 && isIdentifierChar(masked[start - 1] || "")) {
    start -= 1;
  }

  const callee = masked.slice(start, end);

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(callee)) {
    return null;
  }

  return { callee };
}

/**
 * True when a later occurrence of `$var` mutates it — and so the variable's
 * value is NOT simply the single declaration expression, making inlining unsafe.
 * Detected writes:
 *   - a reassignment `$var =` (bare or via an index/property accessor chain,
 *     e.g. `$var[0] =`, `$var->p =`), but never the comparison `$var ==` nor an
 *     array arrow `$var =>` nor the RHS of another assignment (`... = $var`),
 *   - an in-/de-crement (`$var++`, `$var--`, `++$var`, `--$var`),
 *   - a `foreach (... as $var)` binding,
 *   - an explicit by-reference pass `&$var` (the callee may rewrite it).
 */
function isAssignmentTarget(masked: string, usage: VariableToken): boolean {
  if (boundToForeach(masked, usage.start)) {
    return true;
  }

  const before = lastNonWhitespace(masked, usage.start - 1);
  const beforeChar = before === null ? "" : masked[before] || "";
  const beforePair = before === null ? "" : masked.slice(before - 1, before + 1);

  if (beforePair === "++" || beforePair === "--") {
    return true;
  }

  // `&$var` at a call site is an explicit by-reference pass that may mutate it.
  if (beforeChar === "&") {
    return true;
  }

  const afterIncrement = skipWhitespace(masked, usage.end);

  if (
    masked.slice(afterIncrement, afterIncrement + 2) === "++" ||
    masked.slice(afterIncrement, afterIncrement + 2) === "--"
  ) {
    return true;
  }

  // Skip any `[...]` / `->id` / `::id` accessor chain so an element/property
  // write (`$var[0] = ...`, `$var->p = ...`) is recognised as a mutation.
  const after = skipAccessorChain(masked, usage.end);
  const afterChar = masked[after] || "";
  const afterPair = masked.slice(after, after + 2);

  if (afterChar !== "=") {
    return false;
  }

  if (afterPair === "==" || afterPair === "=>") {
    return false;
  }

  // A preceding `=` means this `$var` is the RHS of another assignment (a read).
  return beforeChar !== "=";
}

/**
 * Advances past a chain of array-index `[...]` and member `->id` / `::id`
 * accessors starting at `from`, returning the offset of the next significant
 * (non-whitespace) character after the chain. With no accessor it simply skips
 * whitespace.
 */
function skipAccessorChain(masked: string, from: number): number {
  let index = skipWhitespace(masked, from);

  for (;;) {
    if (masked[index] === "[") {
      const close = matchingPairOffset(masked, index, "[", "]");

      if (close === null) {
        return index;
      }

      index = skipWhitespace(masked, close + 1);
      continue;
    }

    const pair = masked.slice(index, index + 2);

    if (pair === "->" || pair === "::") {
      index = skipWhitespace(masked, index + 2);
      const member = /^[A-Za-z_][A-Za-z0-9_]*/.exec(masked.slice(index));

      if (!member) {
        return index;
      }

      index = skipWhitespace(masked, index + member[0].length);
      continue;
    }

    return index;
  }
}

/**
 * True when `$var` here is the binding target of a `foreach (... as [&]$var)`,
 * which mutates per iteration and is never a plain declaration.
 */
function boundToForeach(masked: string, variableStart: number): boolean {
  const before = masked.slice(0, variableStart);

  return /\bas\s*&?\s*$/.test(before);
}

/**
 * True when the variable's only assignment references the variable itself on the
 * right-hand side (`$x = $x + 1;`). Inlining would substitute an undefined
 * value, so the refactor declines.
 */
function referencesSelf(
  masked: string,
  declaration: Declaration,
  name: string,
): boolean {
  const expr = masked.slice(declaration.exprStart, declaration.exprEnd);
  const pattern = new RegExp(`\\$${name}(?![A-Za-z0-9_])`);

  return pattern.test(expr);
}

/**
 * Safe to duplicate when used at most once, or when the expression has no
 * function/method call (no `(` in its masked form) so re-evaluating it cannot
 * trigger side effects. A single property/array/variable access is pure enough
 * to repeat; anything that can invoke code is only inlined into one site.
 */
function isSafeToDuplicate(
  masked: string,
  declaration: Declaration,
  usageCount: number,
): boolean {
  if (usageCount <= 1) {
    return true;
  }

  const expr = masked.slice(declaration.exprStart, declaration.exprEnd);

  return !expr.includes("(");
}

/**
 * Plans the deletion of the declaration statement. When the declaration is the
 * ONLY statement on its line (only indentation before it, nothing but a newline
 * after the `;`) the whole line is removed so no blank gap is left. When other
 * statements share the line, only the exact `$var = expr;` span plus one
 * following space is removed so the siblings stay intact.
 */
function deleteDeclarationEdit(
  source: string,
  declaration: Declaration,
): InlineVariableEdit {
  const lineStart = lineStartOffset(source, declaration.varStart);
  const onlyIndentBefore = source
    .slice(lineStart, declaration.varStart)
    .split("")
    .every(isHorizontalWhitespace);
  const afterSemicolon = trailingLineEnd(source, declaration.semicolon);

  if (onlyIndentBefore && afterSemicolon !== null) {
    return { end: afterSemicolon, start: lineStart, text: "" };
  }

  const end = source[declaration.semicolon + 1] === " "
    ? declaration.semicolon + 2
    : declaration.semicolon + 1;

  return { end, start: declaration.varStart, text: "" };
}

/**
 * When only horizontal whitespace and then a line break follow the `;`, returns
 * the offset just past that break (so the line is fully consumed). Returns
 * `null` when other content shares the line after the `;`.
 */
function trailingLineEnd(source: string, semicolon: number): number | null {
  let index = semicolon + 1;

  while (index < source.length && isHorizontalWhitespace(source[index])) {
    index += 1;
  }

  if (index >= source.length) {
    return index;
  }

  if (source[index] === "\n") {
    return index + 1;
  }

  if (source[index] === "\r" && source[index + 1] === "\n") {
    return index + 2;
  }

  return null;
}

function replaceUsageEdit(
  masked: string,
  usage: VariableToken,
  expression: string,
): InlineVariableEdit {
  const text = needsParentheses(masked, usage, expression)
    ? `(${expression})`
    : expression;

  return { end: usage.end, start: usage.start, text };
}

/**
 * Decides whether the inlined expression must be parenthesised at this usage
 * site to preserve evaluation order. Conservative: a non-atomic expression
 * (anything beyond a single variable / call / literal / property / array access
 * chain) is wrapped whenever it sits next to a binding operator (`*`, `+`, `.`,
 * `->`, etc.). An atom never needs wrapping.
 */
function needsParentheses(
  masked: string,
  usage: VariableToken,
  expression: string,
): boolean {
  if (isAtomicExpression(expression)) {
    return false;
  }

  const before = lastNonWhitespace(masked, usage.start - 1);
  const after = skipWhitespace(masked, usage.end);

  return (
    isBindingNeighbour(masked, before, "before") ||
    isBindingNeighbour(masked, after, "after") ||
    hasWordOperatorBefore(masked, usage.start) ||
    hasWordOperatorAfter(masked, usage.end)
  );
}

const PRECEDING_WORD_OPERATORS = ["clone", "new", "print", "yield", "throw"];
const FOLLOWING_WORD_OPERATORS = ["instanceof", "and", "or", "xor"];

/**
 * True when a word operator that binds the value (`clone`/`new`/…) immediately
 * precedes the usage, so a bare compound value would bind only part of it.
 */
function hasWordOperatorBefore(masked: string, usageStart: number): boolean {
  const before = masked.slice(0, usageStart);

  return PRECEDING_WORD_OPERATORS.some((keyword) =>
    new RegExp(`(^|[^A-Za-z0-9_$])${keyword}\\s*$`).test(before),
  );
}

/**
 * True when a word operator (`instanceof`/`and`/`or`/`xor`) immediately follows
 * the usage, capturing the value's tail without parentheses.
 */
function hasWordOperatorAfter(masked: string, usageEnd: number): boolean {
  const after = masked.slice(usageEnd);

  return FOLLOWING_WORD_OPERATORS.some((keyword) =>
    new RegExp(`^\\s*${keyword}([^A-Za-z0-9_$]|$)`).test(after),
  );
}

/**
 * An atom is a single primary expression that binds at least as tightly as any
 * surrounding operator: a variable, a numeric/string literal, a function or
 * method call chain, a property access, or an array index — with no top-level
 * binary/ternary operator. Such expressions never need parentheses.
 */
function isAtomicExpression(expression: string): boolean {
  const masked = maskPhpStringsAndComments(expression).trim();

  if (masked.length === 0) {
    return true;
  }

  // A leading sign/parenthesis or any top-level operator character means the
  // expression is compound and must be guarded when inlined into an operator.
  return !hasTopLevelOperator(masked);
}

/**
 * Scans the masked expression for an operator character at bracket-depth 0.
 * `->` and `::` and `\\` (namespace) are member/scope accessors, not binary
 * operators, so they do not count. A leading unary `-`/`+`/`!`/`@`/`~` makes the
 * expression compound.
 */
function hasTopLevelOperator(masked: string): boolean {
  if (/^[-+!@~]/.test(masked)) {
    return true;
  }

  if (hasTopLevelWordOperator(masked)) {
    return true;
  }

  let depth = 0;

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      continue;
    }

    if (depth > 0) {
      continue;
    }

    if (isAccessorAt(masked, index)) {
      index += 1;
      continue;
    }

    if (isTopLevelOperatorChar(character)) {
      return true;
    }
  }

  return false;
}

/**
 * True when a low-precedence word operator (`and`/`or`/`xor`/`instanceof`)
 * appears at bracket-depth 0 in the masked expression, so the value is compound
 * and must be guarded when inlined into any operator context.
 */
function hasTopLevelWordOperator(masked: string): boolean {
  const pattern = /\b(?:and|or|xor|instanceof)\b/g;

  for (
    let match = pattern.exec(masked);
    match;
    match = pattern.exec(masked)
  ) {
    if (depthAt(masked, match.index ?? 0) === 0) {
      return true;
    }
  }

  return false;
}

function depthAt(masked: string, offset: number): number {
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    const character = masked[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
    }
  }

  return depth;
}

function isAccessorAt(masked: string, index: number): boolean {
  const pair = masked.slice(index, index + 2);

  return pair === "->" || pair === "::" || masked[index] === "\\";
}

function isTopLevelOperatorChar(character: string): boolean {
  return "+-*/%.<>=!&|^?:".includes(character);
}

/**
 * True when the neighbouring (non-whitespace) character on the given side is a
 * binding operator that would capture only part of a bare compound expression.
 */
function isBindingNeighbour(
  masked: string,
  index: number | null,
  side: "before" | "after",
): boolean {
  if (index === null) {
    return false;
  }

  const character = masked[index] || "";

  if (side === "before" && (character === "(" || character === "[")) {
    return false;
  }

  if (side === "before" && isStatementBoundary(character)) {
    return false;
  }

  if (side === "after" && (character === ")" || character === "]" || character === ";" || character === ",")) {
    return false;
  }

  return isBindingOperatorChar(character);
}

function isBindingOperatorChar(character: string): boolean {
  return "+-*/%.<>=!&|^?:".includes(character);
}

function isStatementBoundary(character: string): boolean {
  return character === ";" || character === "{" || character === "}";
}

function isComparisonOrCompoundLeadingChar(character: string): boolean {
  // A char immediately before `=` that turns it into `+=`, `.=`, `<=`, `!=`, …
  return "+-*/.%&|^<>!=".includes(character);
}

/**
 * Finds the `;` that terminates the declaration statement, scanning the masked
 * source from the expression start while respecting bracket nesting so a `;`
 * inside `for (...)`-like parentheses cannot end the statement early. Returns
 * `null` when no balanced terminator is found before the variable's scope ends.
 */
function statementTerminator(
  masked: string,
  exprStart: number,
  first: VariableToken,
): number | null {
  let depth = 0;

  for (let index = exprStart; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      if (depth === 0) {
        return null;
      }

      depth -= 1;
      continue;
    }

    if (character === ";" && depth === 0 && index > first.start) {
      return index;
    }
  }

  return null;
}

function lineStartOffset(source: string, offset: number): number {
  const newline = source.lastIndexOf("\n", offset - 1);

  return newline + 1;
}

function lastNonWhitespace(masked: string, from: number): number | null {
  let index = from;

  while (index >= 0 && isWhitespace(masked[index])) {
    index -= 1;
  }

  return index < 0 ? null : index;
}

/**
 * Like `lastNonWhitespace` but over the ORIGINAL source, so a string/heredoc
 * literal at the tail of an expression (masked to spaces) is not skipped.
 */
function lastSourceNonWhitespace(source: string, from: number): number | null {
  let index = from;

  while (index >= 0 && isWhitespace(source[index])) {
    index -= 1;
  }

  return index < 0 ? null : index;
}

function skipWhitespace(masked: string, from: number): number {
  let index = from;

  while (index < masked.length && isWhitespace(masked[index])) {
    index += 1;
  }

  return index;
}

function skipSourceWhitespace(source: string, from: number): number {
  let index = from;

  while (index < source.length && isWhitespace(source[index])) {
    index += 1;
  }

  return index;
}

function nextBraceOrSemicolon(masked: string, start: number): number | null {
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "{" || character === ";") {
      return index;
    }
  }

  return null;
}

function matchingPairOffset(
  masked: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index] || "";

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

function isIdentifierChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /\s/.test(character);
}

function isHorizontalWhitespace(character: string | undefined): boolean {
  return character === " " || character === "\t";
}

function isOffsetInRange(source: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= source.length;
}

/**
 * Masks string literals, comments and heredoc/nowdoc bodies to spaces (newlines
 * preserved) so structural punctuation inside them is ignored. Offsets in the
 * masked string map 1:1 to the original. Mirrors the masking style used across
 * the PHP domain modules but kept self-contained here.
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

    if (character === "#" && next === "[") {
      output += "  ";
      index += 1;
      inLineComment = true;
      continue;
    }

    if (character === "#") {
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

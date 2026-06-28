/**
 * Pure planning for the "Extract method" refactoring on PHP source (PhpStorm
 * parity). Given a character selection of one-or-more contiguous statements
 * inside a class method, this produces a plan an editor adapter applies as two
 * non-overlapping edits:
 *   1. replace the selected statements with a call to a new private method
 *      (`$this->extracted($args);` or `$x = $this->extracted($args);`), and
 *   2. insert a `private function extracted(...) { ... }` immediately after the
 *      enclosing method.
 *
 * The planner is DELIBERATELY conservative: extracting code that re-parses or
 * changes behaviour silently corrupts the user's file, so anywhere there is any
 * doubt it returns `null` (a no-op) rather than offer a risky extraction. The
 * guards below enumerate every rejected shape. It follows the
 * string/comment/heredoc masking style of `phpExtractVariable.ts` so structural
 * reasoning never trips over punctuation inside literals.
 *
 * Variable analysis (purely lexical, conservative):
 *   - A `$var` READ inside the selection that was ASSIGNED before it becomes a
 *     PARAMETER of the new method.
 *   - A `$var` ASSIGNED inside the selection and READ after it must be returned.
 *     Exactly zero (`void`) or one (`$x = call`) such variable is supported;
 *     two-or-more "outputs" are rejected (null).
 */

export interface ExtractMethodPlan {
  /** Offset where the new method block is inserted (after the enclosing method). */
  methodInsertionOffset: number;
  /** Full text of the new private method, including a leading blank line. */
  methodText: string;
  /** Start offset of the statements replaced by the call. */
  replaceStart: number;
  /** End offset of the statements replaced by the call. */
  replaceEnd: number;
  /** The call statement (with the original indent) that replaces the selection. */
  replacementText: string;
  /** Generated method name (placeholder the user can rename). */
  methodName: string;
}

const METHOD_NAME = "extracted";
const INDENT_STEP = "    ";

// PHP superglobals / pseudo-variables that are always available and must never
// be treated as a parameter or a return when seen inside the selection.
const AMBIENT_VARIABLES = new Set([
  "$this",
  "$GLOBALS",
  "$_GET",
  "$_POST",
  "$_REQUEST",
  "$_SERVER",
  "$_SESSION",
  "$_COOKIE",
  "$_FILES",
  "$_ENV",
]);

// Control-flow keywords whose presence in the selection makes a straight extract
// unsafe (the statement escapes the new method's scope) - reject conservatively.
const CONTROL_FLOW_ESCAPE = /\b(return|break|continue|yield|goto)\b/;

export function planExtractMethod(
  source: string,
  selectionStart: number,
  selectionEnd: number,
): ExtractMethodPlan | null {
  const range = normalizeSelection(source, selectionStart, selectionEnd);

  if (!range) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);

  // The selection must live entirely inside ONE class method body.
  const method = enclosingMethod(source, masked, range.start, range.end);

  if (!method) {
    return null;
  }

  // Snap to whole lines so the selection always covers complete statements; a
  // selection misaligned to statement boundaries is rejected.
  const snapped = snapToStatements(source, masked, range, method);

  if (!snapped) {
    return null;
  }

  const maskedSelection = masked.slice(snapped.start, snapped.end);
  const rawSelection = source.slice(snapped.start, snapped.end);

  if (!isSafeSelection(masked, rawSelection, maskedSelection, snapped)) {
    return null;
  }

  const analysis = analyzeVariables(masked, snapped, method);

  if (!analysis) {
    return null;
  }

  return buildPlan(source, method, snapped, analysis);
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

interface EnclosingMethod {
  /** Offset of the `function` keyword of the enclosing method. */
  functionOffset: number;
  /** Offset of the method body's opening brace. */
  bodyStart: number;
  /** Offset of the method body's closing brace. */
  bodyEnd: number;
  /** Indent (leading horizontal whitespace) of the method declaration line. */
  indent: string;
  /** Variable names (`$name`) declared in the method's parameter list. */
  parameterNames: Set<string>;
}

/**
 * Finds the single class method whose body strictly contains `[start, end)`, or
 * `null` when the selection is outside a class method, spans a method boundary,
 * or the source has no class. The method must be declared inside a `class`
 * type (not an interface/free function): we require the nearest enclosing
 * `function (...) {` to itself sit inside a `class ... { }` body.
 */
function enclosingMethod(
  source: string,
  masked: string,
  start: number,
  end: number,
): EnclosingMethod | null {
  const classBody = enclosingClassBody(masked, start, end);

  if (!classBody) {
    return null;
  }

  const pattern = /\bfunction\b\s*&?\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  pattern.lastIndex = classBody.bodyStart + 1;

  for (
    let match = pattern.exec(masked);
    match && match.index < classBody.bodyEnd;
    match = pattern.exec(masked)
  ) {
    const functionOffset = match.index;
    const openParen = masked.indexOf("(", functionOffset);
    const closeParen = matchingPair(masked, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    // The body opens at the first `{` after the parameter list. A return-type
    // declaration (`: void`, `: ?Foo`, `: A|B`) may sit between `)` and `{`, so
    // scan to the next `{` while bailing if a `;` (abstract/interface method) or
    // another `{`-less terminator appears first.
    const bodyStart = methodBodyBrace(masked, closeParen + 1);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPair(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    // Only the method whose body strictly contains the whole selection.
    if (start > bodyStart && end <= bodyEnd) {
      return {
        functionOffset,
        bodyStart,
        bodyEnd,
        indent: lineIndent(source, functionOffset),
        parameterNames: collectParameterNames(masked, openParen, closeParen),
      };
    }
  }

  return null;
}

/**
 * The body span of the innermost `class ... { }` enclosing `[start, end)`, or
 * `null` when none does. Only the `class` keyword qualifies - interfaces,
 * traits and enums are intentionally excluded so extract-method is offered only
 * where `$this`/private methods make sense and the PhpStorm action applies.
 */
function enclosingClassBody(
  masked: string,
  start: number,
  end: number,
): { bodyStart: number; bodyEnd: number } | null {
  const pattern = /\bclass\b\s+[A-Za-z_][A-Za-z0-9_]*/g;

  let best: { bodyStart: number; bodyEnd: number } | null = null;

  for (
    let match = pattern.exec(masked);
    match;
    match = pattern.exec(masked)
  ) {
    const bodyStart = masked.indexOf("{", match.index);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPair(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    if (start > bodyStart && end <= bodyEnd) {
      best = { bodyStart, bodyEnd };
    }
  }

  return best;
}

interface SnappedRange {
  start: number;
  end: number;
}

/**
 * Expands the selection to cover whole lines and validates that the resulting
 * span begins and ends on a statement boundary inside the method body. Rejects
 * (null) when expanding the selection would swallow non-whitespace that the
 * caller did not intend (i.e. the original selection started/ended in the
 * middle of code on its boundary lines).
 */
function snapToStatements(
  source: string,
  masked: string,
  range: { start: number; end: number },
  method: EnclosingMethod,
): SnappedRange | null {
  // Trim leading/trailing whitespace (incl. a trailing newline when the gesture
  // selected whole lines) so the boundary checks reason about the actual code
  // span, not an empty line the selection happened to touch.
  let effectiveStart = range.start;
  let effectiveEnd = range.end;

  while (effectiveStart < effectiveEnd && isWhitespace(source[effectiveStart])) {
    effectiveStart += 1;
  }

  while (effectiveEnd > effectiveStart && isWhitespace(source[effectiveEnd - 1])) {
    effectiveEnd -= 1;
  }

  if (effectiveStart >= effectiveEnd) {
    return null;
  }

  const lineStart = source.lastIndexOf("\n", effectiveStart - 1) + 1;
  const lineEndNewline = source.indexOf("\n", effectiveEnd);
  const lineEnd = lineEndNewline < 0 ? source.length : lineEndNewline;

  // Anything between the start of the line and the trimmed selection start must
  // be whitespace (otherwise the user's selection began mid-statement).
  if (/\S/.test(masked.slice(lineStart, effectiveStart))) {
    return null;
  }

  // Anything between the trimmed selection end and the end of its line must be
  // whitespace (otherwise the selection ended mid-statement).
  if (/\S/.test(masked.slice(effectiveEnd, lineEnd))) {
    return null;
  }

  const start = firstNonSpace(masked, lineStart, lineEnd);
  const end = lastNonSpacePlusOne(masked, lineStart, lineEnd);

  if (start < 0 || end <= start) {
    return null;
  }

  // Stay strictly inside the body braces.
  if (start <= method.bodyStart || end > method.bodyEnd) {
    return null;
  }

  // The character immediately before the snapped start (skipping whitespace)
  // must be a statement boundary: `;`, `{`, `}` or the body's opening brace.
  // This rejects a selection whose first line continues a previous statement.
  const prev = previousNonSpace(masked, start);

  if (prev >= 0 && !isStatementBoundaryChar(masked[prev])) {
    return null;
  }

  // The snapped selection itself must end on a statement boundary.
  if (!isStatementBoundaryChar(masked[end - 1])) {
    return null;
  }

  return { start, end };
}

function isStatementBoundaryChar(character: string | undefined): boolean {
  return character === ";" || character === "{" || character === "}";
}

/**
 * Structural safety gate: rejects selections that cannot be lifted verbatim into
 * a new method without risk - control-flow escapes, partial blocks (unbalanced
 * braces/parens at the selection level), closures capturing via `use(...)`,
 * heredocs, and any selection whose masked form leaves brackets unbalanced.
 */
function isSafeSelection(
  masked: string,
  rawSelection: string,
  maskedSelection: string,
  snapped: SnappedRange,
): boolean {
  if (!maskedSelection.trim()) {
    return false;
  }

  // A heredoc/nowdoc anywhere in the RAW selection is a masking hazard - bail.
  if (containsHeredoc(rawSelection)) {
    return false;
  }

  // A variable interpolated inside a double-quoted / backtick string is blanked
  // by the structural mask, so the variable analysis cannot see it. Extracting
  // would silently miss that variable as a parameter and emit a method that
  // references an undefined variable - decline.
  if (containsInterpolatedString(rawSelection)) {
    return false;
  }

  // Control-flow that escapes the new method's scope (return/break/continue/
  // yield/goto) - reject. Checked on the masked selection so a keyword inside a
  // string/comment never trips it.
  if (CONTROL_FLOW_ESCAPE.test(maskedSelection)) {
    return false;
  }

  // A closure that captures outer scope via `use (...)` complicates the
  // parameter analysis - conservatively decline.
  if (/\buse\s*\(/.test(maskedSelection)) {
    return false;
  }

  // A dynamic `$identifier` form whose `$name` is NOT a plain variable -
  // a static-property access (`self::$s`, `static::$s`, `C::$s`, `$cls::$s`), a
  // variable-variable (`$$x`, `${$x}`), or a dynamic property access
  // (`$obj->$p`, `$this->$prop`, `$obj?->$p`). The lexical `$identifier` scan
  // matches the trailing `$name` and mis-models it (a static-property name read
  // as a plain write, an indirected variable dropped, a dynamic property name
  // dropped), so extracting silently references an undefined variable. Matched
  // on the MASKED selection so a `::$`/`$$`/`->$` inside a string/comment never
  // trips it. Decline. A static class-constant or method access (`Foo::BAR`,
  // `self::make()`) and an ordinary property/method chain (`$obj->prop`,
  // `$a->b()->c()`, `$obj?->p`) contain no `::$`/`$$`/`->$` and still extract.
  if (containsDynamicIdentifierForm(maskedSelection)) {
    return false;
  }

  // A reference-bind assignment (`$ref = &$x;`) makes the left side an ALIAS of
  // the right side, so a later write through the alias mutates the aliased
  // variable. By-value extraction severs the alias and silently drops that
  // mutation. Aliasing breaks the lexical by-value model entirely, so decline
  // any selection that binds a reference. Matched on the masked selection so a
  // `&` inside a string/comment never trips it; `=` here is the single
  // assignment `=` (not `==`/`=>`, which never precede `&$`).
  if (containsReferenceBind(maskedSelection)) {
    return false;
  }

  // A `case`/`default:` label (lifting it parses outside its `switch`, and the
  // call replacing it sits bare in the `switch` body) or a `goto` target label
  // `start:` (lifting it breaks any `goto start;` that targets it) cannot be
  // extracted safely - decline.
  if (containsStatementLabel(maskedSelection)) {
    return false;
  }

  // Brackets must be balanced WITHIN the selection so we never split a block.
  if (!hasBalancedBrackets(maskedSelection)) {
    return false;
  }

  // The selection's start must not sit directly under a `switch (){ }` brace
  // BEFORE the first `case`/`default` label: a bare `$this->extracted();` is a
  // parse error there (PHP allows only `case`/`default` at that position). Once a
  // label has appeared, statements in the case body are ordinary and extractable.
  if (startsBeforeFirstSwitchLabel(masked, snapped.start)) {
    return false;
  }

  // The selection must not start in the middle of an open block: the brace depth
  // accumulated from the method body start up to the selection start must equal
  // the depth at the selection end (i.e. the selection is at the same block
  // level it started, with everything it opened also closed inside).
  return depthAt(masked, snapped.start) === depthAt(masked, snapped.end);
}

/**
 * True when the masked selection contains a statement-level label: a `case`
 * label (`case <expr>:`), a `default:` label, or a `goto` target label
 * `identifier:`. Every form is anchored on a real statement boundary (selection
 * start, or after `;`/`{`/`}`) - NOT on arbitrary whitespace - so a PHP 8 named
 * argument at line start (`default: 5`), a ternary `?:`, a `match` arm `=>`, a
 * class constant access `Foo::BAR`, an array key `'a' => 1`, or a named argument
 * inside a call never trips it. A `case` label is recognised when its keyword
 * sits at a boundary and a `:` (label colon) follows before the next `;`.
 */
/**
 * True when the masked selection contains a reference-bind assignment
 * (`$ref = &$x`, `$ref =& $x`): a single `=` (not `==`/`=>`) followed only by
 * whitespace and a `&` that introduces a `$var` or a function call returning a
 * reference. A bitwise `&` (`$a = $b & $c`) is preceded by an operand, not the
 * `=`, so it never matches; a `&&` (`$a = $b && $c`) is likewise preceded by an
 * operand. Reference parameters in a closure signature are excluded earlier by
 * the `use(...)` / signature handling and are not assignments.
 */
function containsReferenceBind(maskedSelection: string): boolean {
  const pattern = /(^|[^=!<>+\-*/.%&|^?])=\s*&\s*(\$|[A-Za-z_])/g;

  return pattern.test(maskedSelection);
}

/**
 * True when the masked selection contains a `$identifier` form whose `$name` the
 * lexical variable scan would mis-model:
 *   - `::\s*\$` - a static-property access (`self::$s`, `static::$s`, `C::$s`,
 *     `$cls::$s`): the scan reads the property NAME `$s` as a plain variable,
 *   - `\$\s*[$\{]` - a variable-variable (`$$x`, `${$x}`): the scan sees only the
 *     inner `$x`/name and drops the indirection,
 *   - `(->|\?->)\s*\$` - a dynamic property access (`$obj->$p`, `$this->$prop`,
 *     `$obj?->$p`): the scan reads the dynamic member NAME `$p` as a variable.
 * Each would emit a method referencing an undefined variable, so the selection is
 * declined. Operates on the MASKED selection so the same punctuation inside a
 * string/comment (already blanked) never trips it. Legit static const/method
 * access (`Foo::BAR`, `self::make()`) and ordinary property/method chains
 * (`$obj->prop`, `$obj?->p`, `$a->b()->c()`) contain none of these and pass.
 */
function containsDynamicIdentifierForm(maskedSelection: string): boolean {
  return /::\s*\$|\$\s*[$\{]|(->|\?->)\s*\$/.test(maskedSelection);
}

function containsStatementLabel(maskedSelection: string): boolean {
  // `default:` switch label at a statement boundary (a single colon, not `::`).
  if (/(^|[;{}])\s*default\s*:(?!:)/.test(maskedSelection)) {
    return true;
  }

  // `case <expr>:` switch label at a statement boundary: the `case` keyword,
  // then an expression with no statement terminator, up to a single label `:`.
  if (/(^|[;{}])\s*case\b[^;{}]*?:(?!:)/.test(maskedSelection)) {
    return true;
  }

  // A `goto` target label: a bare identifier at a statement boundary directly
  // followed by a single `:` (not `::`).
  const labelPattern = /(^|[;{}])\s*([A-Za-z_][A-Za-z0-9_]*)\s*:/g;

  for (
    let match = labelPattern.exec(maskedSelection);
    match;
    match = labelPattern.exec(maskedSelection)
  ) {
    const colonIndex = match.index + match[0].length - 1;

    // `::` is a scope-resolution operator (`Foo::BAR`, `self::x`), not a label.
    if (maskedSelection[colonIndex + 1] === ":") {
      continue;
    }

    return true;
  }

  return false;
}

/**
 * True when `offset` sits directly under a `switch (...) { }` brace and NO
 * `case`/`default` label appears between that brace and `offset` at the same
 * nesting level - the only position where a bare statement is a PHP parse error.
 * A statement inside a case body (after a label) is ordinary and extractable, so
 * it is NOT flagged. Finds the innermost enclosing open brace by walking back
 * over balanced braces, confirms `switch (...)` opens it, then checks for a
 * preceding label in the region `(brace, offset)`.
 */
function startsBeforeFirstSwitchLabel(masked: string, offset: number): boolean {
  let depth = 0;

  for (let index = offset - 1; index >= 0; index -= 1) {
    const character = masked[index];

    if (character === "}") {
      depth += 1;
      continue;
    }

    if (character !== "{") {
      continue;
    }

    if (depth > 0) {
      depth -= 1;
      continue;
    }

    if (!switchPrecedesBrace(masked, index)) {
      return false;
    }

    return !switchLabelBetween(masked, index + 1, offset);
  }

  return false;
}

/**
 * True when a `case`/`default` switch label appears in `[from, to)` at the top
 * nesting level of the enclosing switch (skipping any nested `{}`/`(`/`[` blocks,
 * so a label inside a nested closure/match is not counted). Used to tell a
 * pre-label position (invalid for a bare statement) from a case body (valid).
 */
function switchLabelBetween(masked: string, from: number, to: number): boolean {
  const region = masked.slice(from, to);
  let depth = 0;

  for (let index = 0; index < region.length; index += 1) {
    const character = region[index];

    if (character === "{" || character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === "}" || character === ")" || character === "]") {
      depth -= 1;
      continue;
    }

    if (depth !== 0) {
      continue;
    }

    if (/^case\b/.test(region.slice(index)) || /^default\s*:/.test(region.slice(index))) {
      return true;
    }
  }

  return false;
}

/**
 * True when the `{` at `braceIndex` is the body brace of a `switch (...)`: the
 * non-space text before it is a `)` whose matching `(` is preceded by the
 * `switch` keyword.
 */
function switchPrecedesBrace(masked: string, braceIndex: number): boolean {
  const closeParen = previousNonSpace(masked, braceIndex);

  if (closeParen < 0 || masked[closeParen] !== ")") {
    return false;
  }

  const openParen = matchingPairBackward(masked, closeParen);

  if (openParen < 0) {
    return false;
  }

  const before = masked.slice(0, openParen);

  return /\bswitch\s*$/.test(before);
}

/**
 * Index of the `(` matching the `)` at `closeIndex`, scanning backwards, or `-1`.
 */
function matchingPairBackward(masked: string, closeIndex: number): number {
  let depth = 0;

  for (let index = closeIndex; index >= 0; index -= 1) {
    const character = masked[index];

    if (character === ")") {
      depth += 1;
      continue;
    }

    if (character === "(") {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
}

function containsHeredoc(rawSelection: string): boolean {
  return /<<<[ \t]*["']?[A-Za-z_]/.test(rawSelection);
}

/**
 * True when the raw selection contains a double-quoted or backtick string that
 * interpolates a variable (`"... $x ..."`, `"... {$x} ..."`). Single-quoted
 * strings never interpolate and are ignored. Walks the selection tracking quote
 * state (honouring backslash escapes in `"`/`'` strings) so a `$` outside a
 * string, or inside a single-quoted string, does not trip it.
 */
function containsInterpolatedString(rawSelection: string): boolean {
  let quote: string | null = null;

  for (let index = 0; index < rawSelection.length; index += 1) {
    const character = rawSelection[index];

    if (quote === null) {
      if (character === '"' || character === "'" || character === "`") {
        quote = character;
      }
      continue;
    }

    if (character === "\\" && quote !== "`") {
      index += 1;
      continue;
    }

    if (character === quote) {
      quote = null;
      continue;
    }

    // Inside an interpolating string (double-quote / backtick): a `$` before an
    // identifier, or a `{$` brace form, is interpolation.
    if (quote === "'") {
      continue;
    }

    if (character === "$" && /[A-Za-z_{]/.test(rawSelection[index + 1] ?? "")) {
      return true;
    }

    if (character === "{" && rawSelection[index + 1] === "$") {
      return true;
    }
  }

  return false;
}

interface VariableAnalysis {
  /** Ordered, de-duplicated parameter variable names (with `$`). */
  parameters: string[];
  /** The single variable that must be returned (with `$`), or null. */
  returnVariable: string | null;
}

type VariableAccess = "read" | "write" | "readwrite";

interface VariableOccurrence {
  name: string;
  offset: number;
  access: VariableAccess;
}

/**
 * Classifies every `$var` occurrence in the method body into reads/writes and
 * which region (before / inside / after the selection) it lives in, then derives
 * parameters and a single return variable.
 *
 * Returns `null` (decline) whenever the data-flow cannot be modelled with the
 * supported shape - parameters (pure reads of before-defined vars) plus at most
 * one returned variable (a var freshly written inside and read after). The
 * rejected shapes that would otherwise corrupt the file:
 *   - a variable READ inside but neither defined before nor freshly written
 *     inside (an outer/closure/undefined reference we cannot pass),
 *   - a variable that is BOTH read and written inside the selection (compound
 *     assignment `$x += 1`, `$x = f($x)`, read-then-reassign): modelling it
 *     correctly needs it as a parameter AND possibly a return at once, so we
 *     decline rather than risk dropping the parameter or the mutation,
 *   - more than one variable that must be returned (multiple outputs).
 */
function analyzeVariables(
  masked: string,
  snapped: SnappedRange,
  method: EnclosingMethod,
): VariableAnalysis | null {
  const occurrences = collectVariableOccurrences(
    masked,
    method.bodyStart + 1,
    method.bodyEnd,
  );

  // Method parameters are in scope from the body's start, so they count as
  // "available before" the selection (they become arguments to the new method).
  const assignedBefore = new Set<string>(method.parameterNames);
  // First in-selection access per variable, in first-seen order. `write` means
  // the variable is born inside (a fresh local); `read`/`readwrite` means its
  // initial value comes from before the selection (an input).
  const firstAccess = new Map<string, VariableAccess>();
  const writtenInside = new Set<string>();
  // Any READ (or compound read-write) of the variable inside the selection.
  // Tracked independently of statement order so a same-statement RHS read of an
  // assignment target (`$x = $x + 1`) is not hidden by the leading LHS write.
  const readInside = new Set<string>();
  const usedAfter = new Set<string>();

  for (const occurrence of occurrences) {
    if (AMBIENT_VARIABLES.has(occurrence.name)) {
      continue;
    }

    if (occurrence.offset < snapped.start) {
      if (occurrence.access !== "read") {
        assignedBefore.add(occurrence.name);
      }
      continue;
    }

    if (occurrence.offset >= snapped.end) {
      usedAfter.add(occurrence.name);
      continue;
    }

    if (occurrence.access !== "write") {
      readInside.add(occurrence.name);
    }

    if (occurrence.access !== "read") {
      writtenInside.add(occurrence.name);
    }

    if (!firstAccess.has(occurrence.name)) {
      firstAccess.set(occurrence.name, occurrence.access);
    }
  }

  // A variable that is BOTH read and written inside the selection is only a safe
  // fresh local when it is invisible outside it. If it also exists before
  // (so an inside read might see the prior value, e.g. `$x = $x + 1` or
  // `$x += 1`) or is used after (so its mutation must propagate out), modelling
  // it needs a parameter and/or a single return simultaneously - beyond the
  // supported shape. Decline rather than risk dropping the parameter or the
  // mutation.
  for (const name of writtenInside) {
    if (!readInside.has(name)) {
      continue;
    }

    if (assignedBefore.has(name) || usedAfter.has(name)) {
      return null;
    }
  }

  const parameters = collectParameters(firstAccess, assignedBefore);

  if (parameters === null) {
    return null;
  }

  // Outputs: variables written inside and read after the selection.
  const outputs = [...writtenInside].filter((name) => usedAfter.has(name));

  if (outputs.length > 1) {
    return null;
  }

  return {
    parameters,
    returnVariable: outputs[0] ?? null,
  };
}

/**
 * Derives the parameter list: every variable whose FIRST in-selection access is
 * a plain read (its value comes from before) becomes a parameter. Returns `null`
 * when such a read targets a variable that was NOT available before (an outer /
 * undefined reference we cannot pass as an argument). Variables first WRITTEN
 * inside are fresh locals and are not parameters. (Variables first accessed via
 * a compound `readwrite` are rejected earlier when also written inside, so any
 * surviving `readwrite` here is a pure pre-existing read and treated as input.)
 */
function collectParameters(
  firstAccess: Map<string, VariableAccess>,
  assignedBefore: Set<string>,
): string[] | null {
  const parameters: string[] = [];

  for (const [name, access] of firstAccess) {
    if (access === "write") {
      continue;
    }

    if (!assignedBefore.has(name)) {
      return null;
    }

    parameters.push(name);
  }

  return parameters;
}

/**
 * The set of variable names (`$name`) appearing in a method's parameter list
 * `(openParen, closeParen)`. Conservatively collects EVERY `$identifier` in the
 * list (including any in default-value expressions); the set is only used to
 * mark names as available-before, so over-inclusion never produces corruption.
 */
function collectParameterNames(
  masked: string,
  openParen: number,
  closeParen: number,
): Set<string> {
  const names = new Set<string>();

  if (openParen < 0 || closeParen <= openParen) {
    return names;
  }

  const list = masked.slice(openParen + 1, closeParen);
  const pattern = /\$[A-Za-z_][A-Za-z0-9_]*/g;

  for (let match = pattern.exec(list); match; match = pattern.exec(list)) {
    names.add(match[0]);
  }

  return names;
}

/**
 * Every `$identifier` occurrence in `[from, to)` of the masked source, tagged
 * with how it accesses the variable:
 *   - `write`: a PLAIN `$x = ...` assignment target,
 *   - `readwrite`: a compound assignment (`$x += 1`, `$x .= 's'`, `$x ??= y`) or
 *     an increment/decrement (`$x++`, `$x--`, `++$x`, `--$x`), which both read
 *     and write the variable,
 *   - `read`: every other occurrence.
 * The distinction lets the analyzer reject mutated locals (read-and-written
 * inside the selection) instead of silently dropping a parameter or mutation.
 */
function collectVariableOccurrences(
  masked: string,
  from: number,
  to: number,
): VariableOccurrence[] {
  const occurrences: VariableOccurrence[] = [];
  const pattern = /\$[A-Za-z_][A-Za-z0-9_]*/g;
  const region = masked.slice(from, to);

  for (
    let match = pattern.exec(region);
    match;
    match = pattern.exec(region)
  ) {
    const name = match[0];
    const offset = from + match.index;
    const after = nextNonSpace(masked, offset + name.length);
    const access = classifyAccess(masked, offset, name, after);

    occurrences.push({
      name,
      offset,
      access,
    });
  }

  return occurrences;
}

/**
 * Classifies how the `$var` at `offset` (whose first non-space neighbour is at
 * `after`) accesses the underlying variable:
 *   - a PREFIX `++$x` / `--$x` is a read-write,
 *   - a write THROUGH a subscript or property accessor chain (`$a[$i] = ...`,
 *     `$a[] = ...`, `$s[0] = ...`, `$a[$i]++`, `$obj->p = ...`) mutates the base
 *     `$var` in place. PHP arrays and strings are value types, so passing the
 *     base by value into the extracted method would discard the mutation; an
 *     object property write would only propagate via the handle, but we decline
 *     that conservatively too. Every such write is reported as `read-write` so
 *     the data-flow guard rejects it when the base exists before or is used
 *     after the selection (and still allows a fresh, discarded local),
 *   - otherwise the plain/compound assignment classification applies.
 */
function classifyAccess(
  masked: string,
  offset: number,
  name: string,
  after: number,
): VariableAccess {
  if (prefixIncrementDecrement(masked, offset)) {
    return "readwrite";
  }

  if (lvalueChainWrite(masked, offset + name.length)) {
    return "readwrite";
  }

  return assignmentAccessAt(masked, after);
}

/**
 * True when the `$var` ending at `nameEnd` is the BASE of an lvalue accessor
 * chain (`[ ... ]` subscripts and/or `->`/`?->` property accesses) that is then
 * written - by a plain/compound assignment or a postfix `++`/`--`. Walks the
 * chain over balanced `[...]` subscripts and identifier property accesses, then
 * inspects the operator that follows. A chain followed by a read (comparison,
 * arrow, function call, plain use) is NOT a write.
 */
function lvalueChainWrite(masked: string, nameEnd: number): boolean {
  let cursor = nextNonSpace(masked, nameEnd);
  let sawAccessor = false;

  while (cursor >= 0) {
    if (masked[cursor] === "[") {
      const close = matchingPair(masked, cursor, "[", "]");

      if (close === null) {
        return false;
      }

      sawAccessor = true;
      cursor = nextNonSpace(masked, close + 1);
      continue;
    }

    if (isPropertyAccessor(masked, cursor)) {
      const arrowLength = masked[cursor] === "?" ? 3 : 2;
      const member = nextNonSpace(masked, cursor + arrowLength);

      // Only a static property/identifier member keeps a simple lvalue chain;
      // a dynamic `->{...}` or `->$x` is unusual - treat as not-a-write here so
      // we never misclassify, and let the plain assignment rules apply.
      if (member < 0 || !/[A-Za-z_]/.test(masked[member] ?? "")) {
        return false;
      }

      let end = member;

      while (end < masked.length && /[A-Za-z0-9_]/.test(masked[end] ?? "")) {
        end += 1;
      }

      sawAccessor = true;
      cursor = nextNonSpace(masked, end);
      continue;
    }

    break;
  }

  if (!sawAccessor || cursor < 0) {
    return false;
  }

  return chainTerminatorIsWrite(masked, cursor);
}

/**
 * True when the accessor at `index` is a `->` or `?->` property access (not a
 * `?:` ternary, `??` coalesce, or a bare `?` / `>` operator).
 */
function isPropertyAccessor(masked: string, index: number): boolean {
  if (masked[index] === "-" && masked[index + 1] === ">") {
    return true;
  }

  return (
    masked[index] === "?" &&
    masked[index + 1] === "-" &&
    masked[index + 2] === ">"
  );
}

/**
 * True when the operator at `index` (immediately after a resolved lvalue accessor
 * chain) writes the chain: a plain `=` (not `==`/`===`/`=>`), a compound
 * assignment (`+=`, `.=`, `??=`, ...), or a postfix `++`/`--`.
 */
function chainTerminatorIsWrite(masked: string, index: number): boolean {
  // `assignmentAccessAt` already maps a plain `=` to `write`, a compound
  // assignment and a postfix `$x++`/`$x--` to `readwrite`, and everything else
  // (comparison `==`, arrow `=>`, call `(`, terminator `;`) to `read`. Any
  // non-`read` classification at the chain terminator means the chain is written.
  return assignmentAccessAt(masked, index) !== "read";
}

/**
 * True when a PREFIX increment/decrement (`++$x` / `--$x`) immediately precedes
 * the `$var` at `offset`. The two operator chars must be identical (`++` or
 * `--`) so `+$x`, `-$x` (unary sign) and `) $x` are not mistaken for a mutation.
 */
function prefixIncrementDecrement(masked: string, offset: number): boolean {
  const first = previousNonSpace(masked, offset);

  if (first < 0 || (masked[first] !== "+" && masked[first] !== "-")) {
    return false;
  }

  return masked[first - 1] === masked[first];
}

/**
 * Classifies the assignment (if any) that begins at `index` (the first non-space
 * character after a `$var`) for that variable:
 *   - `write` for a plain `$x = ...` (not `==`/`===`/`=>`),
 *   - `readwrite` for a compound assignment whose operator chars precede the `=`
 *     (`+=`, `-=`, `*=`, `/=`, `.=`, `%=`, `&=`, `|=`, `^=`, `<<=`, `>>=`,
 *     `**=`, `??=`), which reads then writes the variable, or for a POSTFIX
 *     increment/decrement (`$x++`, `$x--`) which both reads and mutates it,
 *   - `read` for anything else (including comparisons and operators that do not
 *     assign).
 */
function assignmentAccessAt(masked: string, index: number): VariableAccess {
  if (index < 0) {
    return "read";
  }

  const character = masked[index];

  // Postfix `$x++` / `$x--` reads the variable AND mutates it: a read-write that
  // by-value extraction would silently drop (`$x=1;$x++;return $x;` would return
  // 1 instead of 2). The `=`/compound branches below never see `++`/`--`, so it
  // must be matched explicitly here.
  if ((character === "+" || character === "-") && masked[index + 1] === character) {
    return "readwrite";
  }

  if (character === "=") {
    return plainAssignmentOrRead(masked, index);
  }

  // A compound assignment opens with operator chars (`+`, `.`, `?`, `<`, ...)
  // that run up to a single `=` not followed by `=`/`>`. Scan the operator run.
  if (!/[-+*/.%&|^<>?~]/.test(character)) {
    return "read";
  }

  let cursor = index;

  while (cursor < masked.length && /[-+*/.%&|^<>?~]/.test(masked[cursor] ?? "")) {
    cursor += 1;
  }

  if (masked[cursor] !== "=") {
    return "read";
  }

  const afterEquals = masked[cursor + 1];

  // `$x == ...` / `$x === ...` / `$x => ...` are comparisons / arrows: reads.
  if (afterEquals === "=" || afterEquals === ">") {
    return "read";
  }

  return "readwrite";
}

/**
 * For a `=` at `index`, returns `write` for a plain assignment or `read` for a
 * comparison (`==`, `===`) / arrow (`=>`).
 */
function plainAssignmentOrRead(masked: string, index: number): VariableAccess {
  const next = masked[index + 1];

  if (next === "=" || next === ">") {
    return "read";
  }

  return "write";
}

function buildPlan(
  source: string,
  method: EnclosingMethod,
  snapped: SnappedRange,
  analysis: VariableAnalysis,
): ExtractMethodPlan {
  // `snapped.start` sits at the first non-space of the line, so the original
  // leading indentation stays in the document - the call text must NOT re-add it.
  const args = analysis.parameters.join(", ");
  const callExpression = `$this->${METHOD_NAME}(${args})`;
  const replacementText = analysis.returnVariable
    ? `${analysis.returnVariable} = ${callExpression};`
    : `${callExpression};`;

  const methodText = renderMethod(source, method, snapped, analysis);
  const insertionOffset = method.bodyEnd + 1;

  return {
    methodInsertionOffset: insertionOffset,
    methodText,
    replaceStart: snapped.start,
    replaceEnd: snapped.end,
    replacementText,
    methodName: METHOD_NAME,
  };
}

/**
 * Renders the new private method. The extracted statements are taken VERBATIM
 * from the source (preserving their original inner indentation) and a `return
 * $x;` is appended when a single output variable must be returned.
 */
function renderMethod(
  source: string,
  method: EnclosingMethod,
  snapped: SnappedRange,
  analysis: VariableAnalysis,
): string {
  const indent = method.indent;
  const bodyIndent = `${indent}${INDENT_STEP}`;
  const params = analysis.parameters.join(", ");
  const returnType = analysis.returnVariable ? "" : ": void";
  const selectionLines = source.slice(snapped.start, snapped.end).split("\n");
  const bodyLines = selectionLines.map((line) => reindentLine(line, bodyIndent));

  const lines = [
    "",
    `${indent}private function ${METHOD_NAME}(${params})${returnType}`,
    `${indent}{`,
    ...bodyLines,
    analysis.returnVariable ? `${bodyIndent}return ${analysis.returnVariable};` : null,
    `${indent}}`,
  ].filter((line): line is string => line !== null);

  return `\n${lines.join("\n")}`;
}

/**
 * Re-indents a single extracted line to sit at `bodyIndent` while preserving its
 * RELATIVE indentation within the selection. The first line's leading whitespace
 * is the base; deeper lines keep the extra indentation beyond that base. A blank
 * line stays blank.
 */
function reindentLine(line: string, bodyIndent: string): string {
  if (!line.trim()) {
    return "";
  }

  const stripped = line.replace(/^[ \t]+/, "");

  return `${bodyIndent}${stripped}`;
}

// ---------------------------------------------------------------------------
// Structural helpers
// ---------------------------------------------------------------------------

/**
 * Offset of the `{` that opens a method body, scanning forward from `from` over
 * an optional return-type declaration. Returns `-1` when a `;` (abstract /
 * interface method, no body) is reached first or no `{` follows.
 */
function methodBodyBrace(masked: string, from: number): number {
  for (let index = from; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === "{") {
      return index;
    }

    if (character === ";") {
      return -1;
    }
  }

  return -1;
}

function matchingPair(
  masked: string,
  openIndex: number,
  open: string,
  close: string,
): number | null {
  if (openIndex < 0 || masked[openIndex] !== open) {
    return null;
  }

  let depth = 0;

  for (let index = openIndex; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === open) {
      depth += 1;
      continue;
    }

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

/**
 * Net brace depth `{`/`}` (string/comment-masked) from the start of the source
 * up to (excluding) `offset`. Used to confirm the selection starts and ends at
 * the same block nesting.
 */
function depthAt(masked: string, offset: number): number {
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    if (masked[index] === "{") {
      depth += 1;
      continue;
    }

    if (masked[index] === "}") {
      depth -= 1;
    }
  }

  return depth;
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

function nextNonSpace(masked: string, index: number): number {
  let cursor = index;

  while (cursor < masked.length && isWhitespace(masked[cursor])) {
    cursor += 1;
  }

  return cursor < masked.length ? cursor : -1;
}

function previousNonSpace(masked: string, index: number): number {
  let cursor = index - 1;

  while (cursor >= 0 && isWhitespace(masked[cursor])) {
    cursor -= 1;
  }

  return cursor;
}

function firstNonSpace(masked: string, from: number, to: number): number {
  for (let index = from; index < to; index += 1) {
    if (!isWhitespace(masked[index])) {
      return index;
    }
  }

  return -1;
}

function lastNonSpacePlusOne(masked: string, from: number, to: number): number {
  for (let index = to - 1; index >= from; index -= 1) {
    if (!isWhitespace(masked[index])) {
      return index + 1;
    }
  }

  return -1;
}

function lineStartOffset(source: string, offset: number): number {
  return source.lastIndexOf("\n", offset - 1) + 1;
}

function lineIndent(source: string, offset: number): string {
  const lineStart = lineStartOffset(source, offset);
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
 * so structural punctuation inside them is ignored. Mirrors the masking used by
 * `phpExtractVariable.ts`, kept self-contained to this module.
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

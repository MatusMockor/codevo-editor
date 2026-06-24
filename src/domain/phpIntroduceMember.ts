/**
 * Pure planning for the PhpStorm-parity "Introduce constant" and "Introduce
 * field" refactorings on PHP source.
 *
 * Both are strictly LOCAL, single-file synthesises driven by the cursor offset:
 *
 *  - "Introduce constant" — when the cursor sits on a scalar literal (string or
 *    number) inside a class method, it plans a `private const NAME = <literal>;`
 *    declaration at the TOP of the class body and replaces the literal with
 *    `self::NAME`.
 *  - "Introduce field" — when the cursor sits on a scalar literal it plans a
 *    `private <type?> $name = <literal>;` property at the top of the class body
 *    and replaces the literal with `$this->name`; when the cursor sits on a
 *    local variable assignment (`$var = ...;`) it promotes the variable to a
 *    `private <type?> $name;` property and rewrites the assignment target to
 *    `$this->name`.
 *
 * The planners are deliberately conservative (the project rule: "if unclear ->
 * don't offer"). They return `null` unless the cursor confidently lands on a
 * usable literal/variable INSIDE a class body (never at a declaration, never
 * outside a class). They follow the masking/balanced/offset style of
 * `phpExtractVariable.ts` and `phpClassStructure.ts`: strings and comments are
 * masked to spaces before any structural reasoning so punctuation inside
 * literals never affects validation or offsets.
 */

export interface IntroduceConstantPlan {
  declarationOffset: number;
  declarationText: string;
  name: string;
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
}

export interface IntroduceFieldPlan {
  declarationOffset: number;
  declarationText: string;
  name: string;
  replaceStart: number;
  replaceEnd: number;
  replacementText: string;
}

interface ScalarLiteral {
  end: number;
  kind: "string" | "number";
  start: number;
  text: string;
}

interface ClassBody {
  bodyEnd: number;
  bodyStart: number;
}

const DEFAULT_CONSTANT_NAME = "CONSTANT";
const DEFAULT_FIELD_NAME = "field";
const INDENT = "    ";

export function planIntroduceConstant(
  source: string,
  offset: number,
  constantName?: string,
): IntroduceConstantPlan | null {
  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const body = locateEnclosingClassBody(masked, offset);

  if (!body) {
    return null;
  }

  const literal = scalarLiteralAt(source, masked, offset, body);

  if (!literal) {
    return null;
  }

  const name = constantNameFrom(literal, constantName);

  if (!name) {
    return null;
  }

  return {
    declarationOffset: body.bodyStart + 1,
    declarationText: renderConstantDeclaration(name, literal.text),
    name,
    replaceStart: literal.start,
    replaceEnd: literal.end,
    replacementText: `self::${name}`,
  };
}

export function planIntroduceField(
  source: string,
  offset: number,
  fieldName?: string,
): IntroduceFieldPlan | null {
  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const body = locateEnclosingClassBody(masked, offset);

  if (!body) {
    return null;
  }

  const variablePlan = introduceFieldFromVariable(
    source,
    masked,
    offset,
    body,
    fieldName,
  );

  if (variablePlan) {
    return variablePlan;
  }

  return introduceFieldFromLiteral(source, masked, offset, body, fieldName);
}

function introduceFieldFromLiteral(
  source: string,
  masked: string,
  offset: number,
  body: ClassBody,
  fieldName: string | undefined,
): IntroduceFieldPlan | null {
  const literal = scalarLiteralAt(source, masked, offset, body);

  if (!literal) {
    return null;
  }

  const name = fieldNameFrom(literal, fieldName);

  if (!name) {
    return null;
  }

  return {
    declarationOffset: body.bodyStart + 1,
    declarationText: renderFieldDeclaration(name, literal),
    name,
    replaceStart: literal.start,
    replaceEnd: literal.end,
    replacementText: `$this->${name}`,
  };
}

/**
 * When the cursor lands on the target variable of a local assignment
 * (`$var = <scalar literal>;`) inside a method body, promote the variable to a
 * property whose native type is inferred from the assigned literal, and rewrite
 * the assignment target to `$this->var`.
 */
function introduceFieldFromVariable(
  source: string,
  masked: string,
  offset: number,
  body: ClassBody,
  fieldName: string | undefined,
): IntroduceFieldPlan | null {
  const variable = localVariableAt(masked, offset, body);

  if (!variable) {
    return null;
  }

  // Only promote a freshly-assigned local that the offset-only rewrite can
  // handle safely: it must be the SOLE occurrence of `$var` in its method body
  // (the declaration). Rewriting only the assignment target while leaving other
  // reads as `$var` would otherwise leave those reads undefined — so when the
  // variable is used elsewhere we decline (conservative project rule).
  if (!isSingleVariableOccurrence(masked, body, variable)) {
    return null;
  }

  const literal = assignedScalarLiteral(source, masked, variable.end);

  if (!literal) {
    return null;
  }

  const name = normalizeFieldName(fieldName ?? variable.name);

  if (!name) {
    return null;
  }

  return {
    declarationOffset: body.bodyStart + 1,
    declarationText: renderFieldDeclaration(name, literal, { withValue: false }),
    name,
    replaceStart: variable.start,
    replaceEnd: variable.end,
    replacementText: `$this->${name}`,
  };
}

function renderConstantDeclaration(name: string, value: string): string {
  return `\n${INDENT}private const ${name} = ${value};\n`;
}

function renderFieldDeclaration(
  name: string,
  literal: ScalarLiteral,
  options: { withValue?: boolean } = {},
): string {
  const type = nativeTypeOf(literal);
  const typePrefix = type ? `${type} ` : "";
  const valueSuffix = options.withValue === false ? "" : ` = ${literal.text}`;

  return `\n${INDENT}private ${typePrefix}$${name}${valueSuffix};\n`;
}

function nativeTypeOf(literal: ScalarLiteral): string | null {
  if (literal.kind === "string") {
    return "string";
  }

  if (
    /^[+-]?\d[\d_]*$/.test(literal.text) ||
    /^[+-]?0[xX][0-9a-fA-F_]+$/.test(literal.text) ||
    /^[+-]?0[bB][01_]+$/.test(literal.text) ||
    /^[+-]?0[oO][0-7_]+$/.test(literal.text)
  ) {
    return "int";
  }

  if (
    /^[+-]?(?:\d[\d_]*\.\d*|\.\d+|\d[\d_]*(?:[eE][+-]?\d+))$/.test(literal.text)
  ) {
    return "float";
  }

  return null;
}

interface LocalVariable {
  end: number;
  name: string;
  start: number;
}

/**
 * Resolves a `$name` local variable that the cursor sits on (anywhere on the
 * `$` or the identifier) inside the class body. `$this` is never a local
 * variable, so it is rejected.
 */
function localVariableAt(
  masked: string,
  offset: number,
  body: ClassBody,
): LocalVariable | null {
  const start = variableStartAt(masked, offset);

  if (start === null || start <= body.bodyStart || start >= body.bodyEnd) {
    return null;
  }

  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)/.exec(masked.slice(start));
  const name = match?.[1];

  if (!name || name === "this") {
    return null;
  }

  return { end: start + match[0].length, name, start };
}

/**
 * True when `$<variable.name>` appears exactly once within the method body that
 * encloses it (the assignment being promoted). Counting is done over the masked
 * source, so `$name` inside a string/comment never counts. When the enclosing
 * method body cannot be resolved the variable is not in an expression position
 * and is rejected.
 */
function isSingleVariableOccurrence(
  masked: string,
  body: ClassBody,
  variable: LocalVariable,
): boolean {
  const methodBody = enclosingMethodBody(masked, body, variable.start);

  if (!methodBody) {
    return false;
  }

  if (crossesNestedClassBoundary(masked, methodBody, variable.start)) {
    return false;
  }

  const scope = masked.slice(methodBody.start, methodBody.end);
  const pattern = new RegExp(`\\$${variable.name}(?![A-Za-z0-9_])`, "g");
  const occurrences = scope.match(pattern);

  return occurrences !== null && occurrences.length === 1;
}

/**
 * Resolves the `{ ... }` body range of the top-level method whose body encloses
 * the offset, or `null` when the offset is not inside any method body.
 */
function enclosingMethodBody(
  masked: string,
  body: ClassBody,
  offset: number,
): { end: number; start: number } | null {
  const pattern = /\bfunction\b\s*&?\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  pattern.lastIndex = body.bodyStart;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < body.bodyEnd;
    match = pattern.exec(masked)
  ) {
    const functionOffset = match.index ?? 0;

    if (!isTopLevelOfBody(masked, body, functionOffset)) {
      continue;
    }

    const methodBody = methodBodyRange(masked, functionOffset, body.bodyEnd);

    if (methodBody && offset > methodBody.start && offset < methodBody.end) {
      return methodBody;
    }
  }

  return null;
}

function variableStartAt(masked: string, offset: number): number | null {
  if (masked[offset] === "$") {
    return offset;
  }
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
 * Reads a scalar literal assigned to a freshly-declared local variable: the
 * span after the variable must be `<ws>=<ws><scalar literal><ws>;`. Compound
 * assignments (`+=`, `==`, …) and any non-literal right-hand side are rejected
 * so we never promote an expression we cannot safely default-type.
 */
function assignedScalarLiteral(
  source: string,
  masked: string,
  afterVariable: number,
): ScalarLiteral | null {
  // Whitespace is skipped over the ORIGINAL source: masking blanks string
  // literals to spaces too, so a masked-only skip would step OVER the literal we
  // are trying to read. The `=` / `;` structural checks stay on the masked copy
  // so an `=` or `;` inside a string is correctly ignored.
  let index = skipSourceWhitespace(source, afterVariable);

  if (masked[index] !== "=" || masked[index + 1] === "=") {
    return null;
  }

  index = skipSourceWhitespace(source, index + 1);
  const literal = scalarLiteralStartingAt(source, masked, index);

  if (!literal) {
    return null;
  }

  const afterLiteral = skipSourceWhitespace(source, literal.end);

  if (masked[afterLiteral] !== ";") {
    return null;
  }

  return literal;
}

/**
 * Resolves the scalar literal (single/double-quoted string or numeric literal)
 * that the cursor offset falls within, provided it sits inside a METHOD BODY of
 * the class (an expression position). Literals that sit in the class body but
 * outside any method body — `const`/property/parameter defaults, enum case
 * values — are rejected so the refactor never emits self-referential or invalid
 * PHP.
 */
function scalarLiteralAt(
  source: string,
  masked: string,
  offset: number,
  body: ClassBody,
): ScalarLiteral | null {
  const stringLiteral = stringLiteralAt(source, masked, offset);
  const literal = stringLiteral ?? numberLiteralAt(source, masked, offset);

  if (!literal) {
    return null;
  }

  const methodBody = enclosingMethodBody(masked, body, literal.start);

  if (!methodBody || crossesNestedClassBoundary(masked, methodBody, literal.start)) {
    return null;
  }

  return literal;
}

function scalarLiteralStartingAt(
  source: string,
  masked: string,
  offset: number,
): ScalarLiteral | null {
  return (
    stringLiteralAt(source, masked, offset) ??
    numberLiteralAt(source, masked, offset)
  );
}

/**
 * Resolves the single/double-quoted string literal whose span (quotes included)
 * encloses the offset. Spans are scanned from the original source — masking
 * blanks both the literal AND surrounding whitespace to spaces, so it cannot
 * mark a literal boundary on its own.
 */
function stringLiteralAt(
  source: string,
  _masked: string,
  offset: number,
): ScalarLiteral | null {
  for (const span of stringLiteralSpans(source)) {
    if (offset >= span.start && offset < span.end) {
      return span;
    }
  }

  return null;
}

/**
 * Scans every single/double-quoted string literal span in the source, skipping
 * comments and heredoc/nowdoc bodies (so a quote inside a comment is never
 * treated as a literal). Backtick shell-exec strings are intentionally ignored
 * — they are not safe to lift into a constant/field.
 */
function stringLiteralSpans(source: string): ScalarLiteral[] {
  const spans: ScalarLiteral[] = [];
  let index = 0;

  while (index < source.length) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (character === "/" && next === "/") {
      index = skipLineComment(source, index + 2);
      continue;
    }

    if (character === "#" && next !== "[") {
      index = skipLineComment(source, index + 1);
      continue;
    }

    if (character === "/" && next === "*") {
      index = skipBlockComment(source, index + 2);
      continue;
    }

    const heredoc = heredocOpening(source, index);

    if (heredoc) {
      index = skipHeredoc(source, index + heredoc.length, heredoc.terminator);
      continue;
    }

    if (character === "'" || character === '"') {
      const span = readStringSpan(source, index, character);

      if (!span) {
        return spans;
      }

      spans.push(span);
      index = span.end;
      continue;
    }

    index += 1;
  }

  return spans;
}

function readStringSpan(
  source: string,
  start: number,
  quote: string,
): ScalarLiteral | null {
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index] || "";

    if (character === "\\" && quote !== "`") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return {
        end: index + 1,
        kind: "string",
        start,
        text: source.slice(start, index + 1),
      };
    }
  }

  return null;
}

function skipLineComment(source: string, start: number): number {
  const newline = source.indexOf("\n", start);

  return newline < 0 ? source.length : newline + 1;
}

function skipBlockComment(source: string, start: number): number {
  const close = source.indexOf("*/", start);

  return close < 0 ? source.length : close + 2;
}

function skipHeredoc(
  source: string,
  start: number,
  terminator: string,
): number {
  for (let index = start; index < source.length; index += 1) {
    const closing = heredocClosingLength(source, index, terminator);

    if (closing > 0) {
      return index + closing;
    }
  }

  return source.length;
}

function numberLiteralAt(
  source: string,
  masked: string,
  offset: number,
): ScalarLiteral | null {
  if (!isNumberChar(masked[offset] || "")) {
    return null;
  }

  let start = offset;

  while (start > 0 && isNumberChar(masked[start - 1] || "")) {
    start -= 1;
  }

  let end = offset;

  while (end < masked.length && isNumberChar(masked[end] || "")) {
    end += 1;
  }

  const text = source.slice(start, end);

  if (!isNumericLiteral(text) || isIdentifierChar(masked[start - 1] || "")) {
    return null;
  }

  return { end, kind: "number", start, text };
}

function isNumberChar(character: string): boolean {
  return /[0-9._eExXa-fA-F+-]/.test(character);
}

function isNumericLiteral(text: string): boolean {
  return (
    /^0[xX][0-9a-fA-F_]+$/.test(text) ||
    /^0[bB][01_]+$/.test(text) ||
    /^0[oO][0-7_]+$/.test(text) ||
    /^\d[\d_]*$/.test(text) ||
    /^(?:\d[\d_]*\.\d*|\.\d+|\d[\d_]*)(?:[eE][+-]?\d+)?$/.test(text)
  );
}

function constantNameFrom(
  literal: ScalarLiteral,
  explicitName: string | undefined,
): string | null {
  if (explicitName !== undefined) {
    return normalizeConstantName(explicitName);
  }

  if (literal.kind === "string") {
    const derived = upperSnakeCase(stringContent(literal.text));

    return derived || DEFAULT_CONSTANT_NAME;
  }

  return DEFAULT_CONSTANT_NAME;
}

function fieldNameFrom(
  literal: ScalarLiteral,
  explicitName: string | undefined,
): string | null {
  if (explicitName !== undefined) {
    return normalizeFieldName(explicitName);
  }

  if (literal.kind === "string") {
    const derived = lowerCamelCase(stringContent(literal.text));

    return derived || DEFAULT_FIELD_NAME;
  }

  return DEFAULT_FIELD_NAME;
}

function stringContent(literalText: string): string {
  return literalText.slice(1, -1);
}

function upperSnakeCase(value: string): string {
  return value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .join("_")
    .toUpperCase()
    .replace(/^([0-9])/, "_$1");
}

function lowerCamelCase(value: string): string {
  const words = value
    .replace(/[^A-Za-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return "";
  }

  const head = words[0].toLowerCase();
  const tail = words
    .slice(1)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join("");
  const name = `${head}${tail}`;

  return /^[0-9]/.test(name) ? `field${name.charAt(0).toUpperCase()}${name.slice(1)}` : name;
}

function normalizeConstantName(value: string): string | null {
  const normalized = upperSnakeCase(value);

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(normalized) ? normalized : null;
}

function normalizeFieldName(value: string): string | null {
  const withoutDollar = value.trim().replace(/^\$+/, "");
  const camel = /^[A-Za-z_][A-Za-z0-9_]*$/.test(withoutDollar)
    ? withoutDollar
    : lowerCamelCase(withoutDollar);

  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(camel) ? camel : null;
}

/**
 * Locates the innermost class/trait/enum body whose braces enclose the offset.
 * Interfaces are excluded (they cannot hold a `const` value or property the way
 * a concrete class can for this refactor). Returns `null` when the offset is not
 * inside such a body.
 */
function locateEnclosingClassBody(
  masked: string,
  offset: number,
): ClassBody | null {
  const pattern =
    /\b(?:abstract\s+|final\s+|readonly\s+)*(class|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/g;
  let best: ClassBody | null = null;

  for (
    let match = pattern.exec(masked);
    match;
    match = pattern.exec(masked)
  ) {
    const bodyStart = masked.indexOf("{", (match.index ?? 0) + match[0].length);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingBraceOffset(masked, bodyStart);

    if (bodyEnd === null) {
      continue;
    }

    if (offset <= bodyStart || offset >= bodyEnd) {
      continue;
    }

    if (!best || bodyStart > best.bodyStart) {
      best = { bodyEnd, bodyStart };
    }
  }

  return best;
}

/**
 * True when a nested class-like block (a named `class`/`trait`/`enum` or an
 * anonymous `new class { ... }`) opens between the method body start and the
 * offset and still encloses it. Inside such a block `self::` and `$this`
 * resolve to the NESTED class, so lifting the literal/variable into the OUTER
 * class would reference the wrong type — the refactor declines instead.
 */
function crossesNestedClassBoundary(
  masked: string,
  methodBody: { end: number; start: number },
  offset: number,
): boolean {
  const pattern = /\b(?:class|trait|enum)\b/g;
  pattern.lastIndex = methodBody.start;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < offset;
    match = pattern.exec(masked)
  ) {
    const braceOpen = masked.indexOf("{", (match.index ?? 0));

    if (braceOpen < 0 || braceOpen >= methodBody.end) {
      continue;
    }

    const braceClose = matchingBraceOffset(masked, braceOpen);

    if (braceClose !== null && offset > braceOpen && offset < braceClose) {
      return true;
    }
  }

  return false;
}

function methodBodyRange(
  masked: string,
  functionOffset: number,
  limit: number,
): { end: number; start: number } | null {
  const openParen = masked.indexOf("(", functionOffset);
  const closeParen =
    openParen < 0 ? null : matchingPairOffset(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const bodyStart = nextBraceOrSemicolon(masked, closeParen + 1, limit);

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
 * Finds the next `{` (method body open) or `;` (abstract/interface method) after
 * the parameter list, so an abstract method without a body is never mistaken for
 * one whose body encloses the offset.
 */
function nextBraceOrSemicolon(
  masked: string,
  start: number,
  limit: number,
): number | null {
  for (let index = start; index < limit; index += 1) {
    const character = masked[index] || "";

    if (character === "{" || character === ";") {
      return index;
    }
  }

  return null;
}

/**
 * True when the offset sits at brace-depth 1 relative to the class body (a
 * direct member position), with no open parentheses — so a `function` token
 * inside a nested closure/anonymous-class body is not treated as a top-level
 * method.
 */
function isTopLevelOfBody(
  masked: string,
  body: ClassBody,
  offset: number,
): boolean {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = body.bodyStart; index < offset; index += 1) {
    const character = masked[index] || "";

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      braceDepth -= 1;
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      parenDepth = Math.max(0, parenDepth - 1);
    }
  }

  return braceDepth === 1 && parenDepth === 0;
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

function skipSourceWhitespace(source: string, start: number): number {
  let index = start;

  while (index < source.length && /\s/.test(source[index] || "")) {
    index += 1;
  }

  return index;
}

function isIdentifierChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
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

import { phpMethodParameters } from "./phpMethodCompletions";
import { firstPhpDocTypeToken, phpDocReturnTypeToken } from "./phpDocTemplates";

/**
 * Pure planning for two PhpStorm "Alt+Enter" intentions on PHP source:
 *
 *   - **Add return type** - a method/function that declares NO return type gets
 *     `: Type` inserted before its body `{` (or before the `;` that terminates
 *     an abstract / interface declaration).
 *   - **Add parameter type hint** - a parameter with NO type hint gets `Type `
 *     inserted before its `$name`.
 *
 * Both produce a SINGLE zero-length insertion an editor adapter applies, so the
 * change is purely additive and single-file: no call-site rewriting, no
 * cross-file edits.
 *
 * The inference is DELIBERATELY conservative - it only fires when the type is
 * UNAMBIGUOUS, and returns `null` (a no-op) everywhere else, because a wrong
 * type hint silently corrupts the file's semantics (the worst failure mode for
 * this kind of action). Concretely:
 *
 *   Return type, in priority order:
 *     1. a PHPDoc `@return X` (the most reliable signal) - used verbatim
 *        (`?Foo`, `A|B`, `\App\Foo` all preserved),
 *     2. otherwise, EVERY `return` in the (directly-owned) body must agree on a
 *        single literal-derived type: no return / `return;` -> `void`;
 *        `return new Foo()` (all) -> the class name; `return $this` -> `static`;
 *        a string/int/float/bool/array literal -> its scalar type.
 *   Anything else (a mix of types, `return $var`, `return foo()`, a `return
 *   null` as the only return - which could be `?X`) yields `null`.
 *
 *   Parameter type:
 *     1. a PHPDoc `@param X $name` for that exact parameter - used verbatim,
 *     2. otherwise a literal default value: `= []` -> `array`, `= 'x'` ->
 *        `string`, `= 123` -> `int`, `= 1.5` -> `float`, `= true`/`false` ->
 *        `bool`. A `= null` default is ambiguous (`?X`) and yields `null`.
 *
 * Structural reasoning runs over a string/comment/heredoc-masked view (mirroring
 * `phpAddParameter.ts`) so punctuation inside literals never trips the parser.
 */

export interface AddReturnTypePlan {
  insertOffset: number;
  insertText: string;
  returnType: string;
}

export interface AddParameterTypePlan {
  insertOffset: number;
  insertText: string;
  parameterName: string;
  parameterType: string;
}

export function planAddReturnType(
  source: string,
  offset: number,
): AddReturnTypePlan | null {
  if (!isValidOffset(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const signature = enclosingFunction(source, masked, offset);

  if (!signature || signatureHasReturnType(masked, signature)) {
    return null;
  }

  const returnType = inferReturnType(source, masked, signature);

  if (!returnType) {
    return null;
  }

  return {
    insertOffset: signature.returnTypeAnchor,
    insertText: `: ${returnType}`,
    returnType,
  };
}

export function planAddParameterType(
  source: string,
  offset: number,
): AddParameterTypePlan | null {
  if (!isValidOffset(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const signature = enclosingFunction(source, masked, offset);

  if (!signature) {
    return null;
  }

  // The cursor must sit inside the parameter list for this to be a parameter
  // action (otherwise it is a body/return-type position).
  if (offset <= signature.openParen || offset > signature.closeParen) {
    return null;
  }

  const target = parameterUnderCursor(source, masked, signature, offset);

  if (!target || target.hasType) {
    return null;
  }

  const phpDoc = phpDocBlockBefore(source, signature.functionOffset);
  const docType = phpDocParamType(phpDoc, target.name);

  if (docType && !phpDocTypeFitsDefault(docType, target.defaultValue)) {
    // A stale / wrong PHPDoc `@param` whose type contradicts an existing literal
    // default (e.g. `@param Foo` over `$foo = true`) would be a FATAL PHP error
    // ("Cannot use bool as default value for parameter of type Foo"). Stay
    // conservative: emit no type hint rather than corrupt the signature.
    return null;
  }

  const parameterType = docType ?? inferTypeFromDefault(target.defaultValue);

  if (!parameterType) {
    return null;
  }

  return {
    insertOffset: target.insertOffset,
    insertText: `${parameterType} `,
    parameterName: target.name,
    parameterType,
  };
}

interface EnclosingFunction {
  /** Offset of the `function` keyword. */
  functionOffset: number;
  openParen: number;
  closeParen: number;
  /**
   * Offset where a return type would be inserted: just after `)` (and after any
   * whitespace) - i.e. before the body `{` or the declaration `;`.
   */
  returnTypeAnchor: number;
  /** True for an abstract / interface declaration (terminated by `;`). */
  isDeclarationOnly: boolean;
  /** Offset of the body `{` (declarations only: -1). */
  bodyStart: number;
  /** Offset of the body `}` (declarations only: -1). */
  bodyEnd: number;
}

/**
 * The innermost `function <name>(...)` whose parameter list OR body contains the
 * cursor. Unlike `phpAddParameter.ts`, abstract / interface declarations (no
 * `{}`, terminated by `;`) ARE accepted, because adding a RETURN type to them is
 * a valid single-file additive change (it does not force call-site or override
 * edits). When several functions qualify (a closure nested in a body), the one
 * whose `function` keyword is LATEST at or before the cursor wins.
 */
function enclosingFunction(
  source: string,
  masked: string,
  offset: number,
): EnclosingFunction | null {
  const pattern = /\bfunction\b\s*&?\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  let best: EnclosingFunction | null = null;

  for (
    let match = pattern.exec(masked);
    match !== null;
    match = pattern.exec(masked)
  ) {
    const candidate = buildEnclosingFunction(source, masked, match.index);

    if (!candidate) {
      continue;
    }

    const upperBound = candidate.isDeclarationOnly
      ? candidate.returnTypeAnchor
      : candidate.bodyEnd;

    if (offset < candidate.functionOffset || offset > upperBound) {
      continue;
    }

    best = candidate;
  }

  return best;
}

function buildEnclosingFunction(
  source: string,
  masked: string,
  functionOffset: number,
): EnclosingFunction | null {
  const openParen = masked.indexOf("(", functionOffset);

  if (openParen < 0) {
    return null;
  }

  const closeParen = matchingPair(masked, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const terminator = afterParenTerminator(masked, closeParen + 1);

  if (terminator === null) {
    return null;
  }

  // Defensive: the matched parentheses must be real `(`/`)` in the raw source.
  if (source[openParen] !== "(" || source[closeParen] !== ")") {
    return null;
  }

  // The return type is inserted immediately after the close `)` (before any
  // whitespace leading to `{` / `;`), so a single-line `foo()` becomes
  // `foo(): T` and a multiline `)\n {` becomes `): T\n {`.
  const returnTypeAnchor = closeParen + 1;

  if (terminator.kind === ";") {
    return {
      bodyEnd: -1,
      bodyStart: -1,
      closeParen,
      functionOffset,
      isDeclarationOnly: true,
      openParen,
      returnTypeAnchor,
    };
  }

  const bodyEnd = matchingPair(masked, terminator.offset, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  return {
    bodyEnd,
    bodyStart: terminator.offset,
    closeParen,
    functionOffset,
    isDeclarationOnly: false,
    openParen,
    returnTypeAnchor,
  };
}

/**
 * The first significant token after the parameter-list `)`: the body `{` or the
 * declaration `;`. Its offset is where a return type would be inserted. A
 * return-type declaration would normally sit here too, but callers only invoke
 * this when none is present; a stray `:` makes the result ambiguous, so it is
 * reported as a rejection (`null`).
 */
function afterParenTerminator(
  masked: string,
  from: number,
): { kind: "{" | ";"; offset: number } | null {
  for (let index = from; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === undefined || /\s/.test(character)) {
      continue;
    }

    if (character === "{") {
      return { kind: "{", offset: index };
    }

    if (character === ";") {
      return { kind: ";", offset: index };
    }

    // Anything else between `)` and the body/`;` (e.g. an existing `: Type`)
    // means we cannot safely anchor a return type here.
    return null;
  }

  return null;
}

function signatureHasReturnType(
  masked: string,
  signature: EnclosingFunction,
): boolean {
  for (let index = signature.closeParen + 1; index < masked.length; index += 1) {
    const character = masked[index];

    if (character === undefined || /\s/.test(character)) {
      continue;
    }

    return character === ":";
  }

  return false;
}

function inferReturnType(
  source: string,
  masked: string,
  signature: EnclosingFunction,
): string | null {
  const phpDoc = phpDocBlockBefore(source, signature.functionOffset);
  const docReturn = phpDocReturnTypeToken(phpDoc);

  if (docReturn && isUsableDocReturnType(docReturn)) {
    return docReturn;
  }

  if (signature.isDeclarationOnly) {
    // No body to inspect and no usable PHPDoc -> nothing to infer.
    return null;
  }

  return inferReturnTypeFromBody(source, masked, signature);
}

/**
 * A PHPDoc `@return` / `@param` token is usable verbatim only when it is a clean
 * type expression - identifiers, `\`, `|`, `&`, `?`, and `[]`. A token carrying a
 * generic (`array<int, Foo>`), a description, or other noise is rejected because
 * it is not a valid native type.
 *
 * PHP additionally FORBIDS mixing the `?` nullable shorthand with a union (`|`)
 * or intersection (`&`) type (`?Foo|Bar`, `Foo&?Bar`, ... are all parse errors).
 * Inserting such a token verbatim would corrupt the file, so any `?` combined
 * with `|`/`&` is rejected; plain `?Foo`, `Foo|Bar` and `Foo&Bar` stay usable.
 */
function isUsableDocReturnType(token: string): boolean {
  const isCleanTypeExpression =
    /^\??[\\A-Za-z_][\\A-Za-z0-9_]*(?:[|&]\??[\\A-Za-z_][\\A-Za-z0-9_]*)*$/.test(
      token,
    );

  if (!isCleanTypeExpression) {
    return false;
  }

  const mixesNullableWithUnionOrIntersection =
    token.includes("?") && /[|&]/.test(token);

  return !mixesNullableWithUnionOrIntersection;
}

/**
 * Infers a return type from the DIRECTLY-OWNED `return` statements of the body
 * (returns inside nested closures / arrow functions are excluded). All returns
 * must agree on one type, else `null`:
 *   - no return at all, or every `return;` -> `void`
 *   - every `return new Foo()` -> `Foo`
 *   - every `return $this` -> `static`
 *   - every string / int / float / bool / array literal -> its scalar type
 * A `return null` as the only signal is ambiguous (`?X`) and yields `null`.
 */
function inferReturnTypeFromBody(
  source: string,
  masked: string,
  signature: EnclosingFunction,
): string | null {
  const returns = directReturnExpressions(source, masked, signature);

  if (returns.length === 0) {
    return "void";
  }

  const types = new Set<string>();

  for (const expression of returns) {
    const type = scalarReturnType(expression);

    if (!type) {
      return null;
    }

    types.add(type);
  }

  if (types.size !== 1) {
    return null;
  }

  return [...types][0] ?? null;
}

/**
 * The trimmed source of each `return` expression directly owned by the function
 * body (depth 1 relative to the body brace), with nested function / closure /
 * arrow-function bodies skipped so their returns never leak out. A bare
 * `return;` contributes an empty string.
 */
function directReturnExpressions(
  source: string,
  masked: string,
  signature: EnclosingFunction,
): string[] {
  const body = masked.slice(signature.bodyStart + 1, signature.bodyEnd);
  const rawBody = source.slice(signature.bodyStart + 1, signature.bodyEnd);
  const expressions: string[] = [];
  const pattern = /\breturn\b/g;

  for (
    let match = pattern.exec(body);
    match !== null;
    match = pattern.exec(body)
  ) {
    const keywordIndex = match.index;

    if (nestedFunctionDepth(body, keywordIndex) > 0) {
      continue;
    }

    const valueStart = keywordIndex + "return".length;
    const stop = statementStop(body, valueStart);
    const expression = rawBody.slice(valueStart, stop).trim();

    expressions.push(expression);
  }

  return expressions;
}

/**
 * Counts how many `function`/`fn` bodies enclose `index` WITHIN the body string.
 * A `return` at depth > 0 belongs to a nested closure, not the method, so it
 * must not drive the method's return type. Detection is intentionally simple:
 * any `function`/`fn` keyword whose `{` (or `=>`) opens a scope that still
 * contains `index` counts. Operates on the masked body so literals are inert.
 */
function nestedFunctionDepth(maskedBody: string, index: number): number {
  let depth = 0;
  const pattern = /\b(?:function|fn)\b/g;

  for (
    let match = pattern.exec(maskedBody);
    match !== null && match.index < index;
    match = pattern.exec(maskedBody)
  ) {
    const isArrow = maskedBody.slice(match.index, match.index + 2) === "fn";
    const scope = isArrow
      ? arrowFunctionScope(maskedBody, match.index)
      : braceScope(maskedBody, match.index);

    if (scope && index > scope.start && index < scope.end) {
      depth += 1;
    }
  }

  return depth;
}

function braceScope(
  maskedBody: string,
  from: number,
): { start: number; end: number } | null {
  const brace = maskedBody.indexOf("{", from);

  if (brace < 0) {
    return null;
  }

  const end = matchingPair(maskedBody, brace, "{", "}");

  if (end === null) {
    return null;
  }

  return { end, start: brace };
}

/**
 * The span of an arrow function `fn (...) => <expr>`: from the `=>` to the end of
 * its single expression (the next top-level `,`, `;`, `)` or `]`). A `return`
 * cannot appear inside an arrow expression, so this is defensive; it simply
 * keeps a `fn` token from being mistaken for a brace scope.
 */
function arrowFunctionScope(
  maskedBody: string,
  from: number,
): { start: number; end: number } | null {
  const arrow = maskedBody.indexOf("=>", from);

  if (arrow < 0) {
    return null;
  }

  const end = statementStop(maskedBody, arrow + 2);

  return { end, start: arrow };
}

/**
 * The index (within `masked`) where the statement starting at `from` ends: the
 * first top-level (depth 0) `;`, or `}`/`)`/`]`/`,` that closes the enclosing
 * scope. Brackets are balanced so a `;`/`,` nested inside `(...)`/`[...]`/`{...}`
 * does not end it early.
 */
function statementStop(masked: string, from: number): number {
  let depth = 0;

  for (let index = from; index < masked.length; index += 1) {
    const character = masked[index];

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

    if (depth === 0 && (character === ";" || character === ",")) {
      return index;
    }
  }

  return masked.length;
}

/**
 * The conservative scalar/literal type of a single `return` expression, or
 * `null` when it is ambiguous (a variable, a call, an operator expression, a
 * lone `null`, ...). An empty expression is a bare `return;` -> `void`.
 */
function scalarReturnType(expression: string): string | null {
  const value = expression.trim();

  if (value.length === 0) {
    return "void";
  }

  if (value === "$this") {
    return "static";
  }

  if (value === "true" || value === "false") {
    return "bool";
  }

  if (/^['"]/.test(value) && isSingleStringLiteral(value)) {
    return "string";
  }

  if (/^-?\d+$/.test(value)) {
    return "int";
  }

  if (/^-?(?:\d+\.\d*|\.\d+|\d+\.?\d*[eE][+-]?\d+)$/.test(value)) {
    return "float";
  }

  if (isArrayLiteral(value)) {
    return "array";
  }

  const newType = newExpressionClassName(value);

  if (newType) {
    return newType;
  }

  return null;
}

/**
 * True when `value` is exactly ONE string literal and nothing trails it (so a
 * concatenation `'a' . $b` or an interpolation followed by an operator is NOT
 * mistaken for a plain string). Operates on the raw value plus a masked view of
 * it, so the quote pairing ignores escaped quotes.
 */
function isSingleStringLiteral(value: string): boolean {
  const quote = value[0];

  if (quote !== "'" && quote !== '"') {
    return false;
  }

  for (let index = 1; index < value.length; index += 1) {
    const character = value[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index === value.length - 1;
    }
  }

  return false;
}

/**
 * True when `value` is exactly one array literal: a `[...]` (or `array(...)`)
 * with the closing bracket as the final character and nothing trailing it. The
 * masked view balances brackets so inner literals are inert.
 */
function isArrayLiteral(value: string): boolean {
  if (value.startsWith("[")) {
    const masked = maskPhpStringsAndComments(value);
    const end = matchingPair(masked, 0, "[", "]");

    return end === value.length - 1;
  }

  if (/^array\s*\(/.test(value)) {
    const masked = maskPhpStringsAndComments(value);
    const open = masked.indexOf("(");
    const end = matchingPair(masked, open, "(", ")");

    return end === value.length - 1;
  }

  return false;
}

/**
 * The class name of a `new Foo(...)` expression when `value` is exactly that and
 * nothing trails the constructor's `)`, or `null`. Anonymous classes
 * (`new class {}`) and dynamic targets (`new $class`) are rejected.
 */
function newExpressionClassName(value: string): string | null {
  const match = /^new\s+(\\?[A-Za-z_][\\A-Za-z0-9_]*)\s*\(/.exec(value);
  const className = match?.[1];

  if (!className || className === "class") {
    return null;
  }

  const masked = maskPhpStringsAndComments(value);
  const open = masked.indexOf("(");
  const end = matchingPair(masked, open, "(", ")");

  if (end !== value.length - 1) {
    return null;
  }

  return className;
}

interface ParameterTarget {
  name: string;
  hasType: boolean;
  defaultValue: string | null;
  /** Offset where a type hint would be inserted (before the parameter token). */
  insertOffset: number;
}

/**
 * Resolves the single parameter whose span contains the cursor, with the offset
 * at which a type hint should be inserted - immediately before the parameter
 * declaration's leading `&` / `...` / `$name` (after any `public`/`private`/
 * `protected`/`readonly` promotion keywords, so a promoted ctor param types
 * correctly). Returns `null` when no parameter contains the cursor.
 */
function parameterUnderCursor(
  source: string,
  masked: string,
  signature: EnclosingFunction,
  offset: number,
): ParameterTarget | null {
  const listStart = signature.openParen + 1;
  const rawList = source.slice(listStart, signature.closeParen);
  const maskedList = masked.slice(listStart, signature.closeParen);
  const spans = topLevelParameterSpans(maskedList, rawList);

  for (const span of spans) {
    const absoluteStart = listStart + span.start;
    const absoluteEnd = listStart + span.end;

    if (offset < absoluteStart || offset > absoluteEnd) {
      continue;
    }

    const rawParameter = rawList.slice(span.start, span.end);

    return buildParameterTarget(rawParameter, absoluteStart);
  }

  return null;
}

function buildParameterTarget(
  rawParameter: string,
  parameterStart: number,
): ParameterTarget | null {
  const parsed = phpMethodParameters(rawParameter)[0];

  if (!parsed || !parsed.name.startsWith("$")) {
    return null;
  }

  const anchorWithin = typeHintAnchorWithin(rawParameter);

  return {
    defaultValue: parsed.defaultValue,
    hasType: parsed.type !== null && parsed.type.trim().length > 0,
    insertOffset: parameterStart + anchorWithin,
    name: parsed.name,
  };
}

/**
 * The index within a single raw parameter declaration where a type hint should
 * be written: after any leading promotion modifiers (`public`/`protected`/
 * `private`/`readonly`) and their whitespace, but BEFORE a `&` / `...` / `$`.
 * So `private &$foo` -> before `&`, yielding `private Foo &$foo`.
 */
function typeHintAnchorWithin(rawParameter: string): number {
  const modifiers =
    /^(\s*(?:public|protected|private|readonly)\b\s*)+/.exec(rawParameter);
  const start = modifiers ? modifiers[0].length : 0;
  let index = start;

  while (index < rawParameter.length && /\s/.test(rawParameter[index] ?? "")) {
    index += 1;
  }

  return index;
}

/**
 * The top-level (depth 0) parameter spans of a parameter-list body, as
 * `{start, end}` index pairs (end exclusive). Commas inside default-value
 * brackets are ignored via depth tracking. Surrounding whitespace is trimmed,
 * but a position is only treated as trimmable when it is whitespace in BOTH the
 * masked and the RAW view, so a string/heredoc default value (blanked to spaces
 * by masking) is preserved at the span's end rather than cut off.
 */
function topLevelParameterSpans(
  maskedList: string,
  rawList: string,
): Array<{ start: number; end: number }> {
  const spans: Array<{ start: number; end: number }> = [];
  let depth = 0;
  let segmentStart = 0;

  const isTrimmable = (index: number): boolean =>
    /\s/.test(maskedList[index] ?? "") && /\s/.test(rawList[index] ?? "");

  const pushSegment = (end: number) => {
    let start = segmentStart;

    while (start < end && isTrimmable(start)) {
      start += 1;
    }

    let trimmedEnd = end;

    while (trimmedEnd > start && isTrimmable(trimmedEnd - 1)) {
      trimmedEnd -= 1;
    }

    if (trimmedEnd > start) {
      spans.push({ end: trimmedEnd, start });
    }
  };

  for (let index = 0; index < maskedList.length; index += 1) {
    const character = maskedList[index];

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      pushSegment(index);
      segmentStart = index + 1;
    }
  }

  pushSegment(maskedList.length);

  return spans;
}

/**
 * The `@param X $name` type for `parameterName` (with its leading `$`) from a
 * PHPDoc block, or `null`. Uses the same scan as `firstPhpDocTypeToken`, so a
 * generic / nullable / union / namespaced type is preserved verbatim, then
 * validated as a clean native-usable type expression.
 */
function phpDocParamType(
  docBlock: string | null,
  parameterName: string,
): string | null {
  if (!docBlock) {
    return null;
  }

  const bareName = parameterName.replace(/^\$/, "");
  const pattern = new RegExp(
    `@(?:(?:phpstan|psalm)-)?param\\s+([^\\r\\n*]+?)\\s+(?:&\\s*)?(?:\\.\\.\\.)?\\$${bareName}\\b`,
  );
  const match = pattern.exec(docBlock);
  const type = firstPhpDocTypeToken(match?.[1] ?? null);

  if (!type || !isUsableDocReturnType(type)) {
    return null;
  }

  return type;
}

/**
 * Whether a PHPDoc `@param` type may legally precede an EXISTING literal default
 * value. A PHPDoc type that contradicts a concrete default is a FATAL PHP error
 * once a native type is added, so this gate keeps `planAddParameterType`
 * conservative.
 *
 * Rules (only literal defaults are judged; anything else is allowed):
 *   - `= null` is always allowed (PHP makes the parameter implicitly nullable),
 *   - a non-null literal default must match a BARE scalar docblock keyword:
 *       the keyword must equal the default's scalar type (with `array`/`iterable`
 *       and `int`->`float` widening accepted),
 *   - any doc type that is not a bare scalar keyword (class names, but also
 *     `?int`, `int|string`, `mixed`, literal types, ...) is conservatively
 *     rejected with a non-null literal default. Some of those are in fact legal
 *     PHP (`?int $x = 1`), so this is a deliberate OVER-rejection - it only
 *     suppresses a hint, it never emits an invalid one.
 */
function phpDocTypeFitsDefault(
  docType: string,
  defaultValue: string | null,
): boolean {
  if (defaultValue === null || defaultValue.trim() === "null") {
    return true;
  }

  const defaultType = inferTypeFromDefault(defaultValue);

  if (defaultType === null) {
    // Not a recognised literal (constant, expression, ...) - no contradiction we
    // can prove, so keep the existing PHPDoc-wins behaviour.
    return true;
  }

  const scalarDocKeywords = new Set([
    "int",
    "float",
    "string",
    "bool",
    "array",
    "iterable",
  ]);
  const normalisedDoc = docType.toLowerCase();

  if (!scalarDocKeywords.has(normalisedDoc)) {
    // A class / nullable / union type with a concrete non-null scalar default is
    // always incompatible.
    return false;
  }

  if (defaultType === "array") {
    return normalisedDoc === "array" || normalisedDoc === "iterable";
  }

  if (defaultType === "int" && normalisedDoc === "float") {
    // PHP widens an integer literal into a `float` default (`float $x = 123`),
    // so this pairing is legal, not a contradiction.
    return true;
  }

  return normalisedDoc === defaultType;
}

function inferTypeFromDefault(defaultValue: string | null): string | null {
  if (defaultValue === null) {
    return null;
  }

  const value = defaultValue.trim();

  if (value === "true" || value === "false") {
    return "bool";
  }

  if (/^['"]/.test(value) && isSingleStringLiteral(value)) {
    return "string";
  }

  if (/^-?\d+$/.test(value)) {
    return "int";
  }

  if (/^-?(?:\d+\.\d*|\.\d+|\d+\.?\d*[eE][+-]?\d+)$/.test(value)) {
    return "float";
  }

  if (isArrayLiteral(value)) {
    return "array";
  }

  return null;
}

/**
 * The PHPDoc `/** ... *\/` block immediately above the `function` keyword at
 * `functionOffset`, or `null`. Only the gap between the docblock's `*\/` and the
 * keyword is allowed to hold modifiers / attributes / whitespace; any other
 * token there means the docblock does not belong to this function.
 */
function phpDocBlockBefore(
  source: string,
  functionOffset: number,
): string | null {
  const before = source.slice(0, functionOffset);
  const docEnd = before.lastIndexOf("*/");

  if (docEnd < 0) {
    return null;
  }

  const docStart = before.lastIndexOf("/**", docEnd);

  if (docStart < 0) {
    return null;
  }

  const between = before
    .slice(docEnd + 2)
    .replace(/#\[[\s\S]*?\]/g, " ")
    .replace(/\b(?:abstract|final|private|protected|public|readonly|static)\b/g, " ")
    .trim();

  if (between.length > 0) {
    return null;
  }

  return before.slice(docStart, docEnd + 2);
}

function isValidOffset(source: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= source.length;
}

/**
 * The offset of the bracket that matches the `open` bracket at `openIndex`, or
 * `null` when unbalanced. Operates on a masked source so brackets inside
 * literals/comments (already blanked to spaces) never affect the count.
 */
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
 * Masks string literals, comments, heredocs and nowdocs to spaces (newlines
 * preserved) so structural punctuation inside them is ignored. Mirrors the
 * masking used by `phpAddParameter.ts`, kept self-contained to this module.
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

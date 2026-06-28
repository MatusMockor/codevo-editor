import {
  parsePhpClassStructure,
  type PhpVisibility,
} from "./phpClassStructure";

/**
 * Pure detection + signature inference for the "Create method / property from
 * usage" code action on PHP source.
 *
 * Given an offset that sits on a `$this->member(...)` call or a `$this->member`
 * property access where `member` does NOT yet exist on the enclosing class, this
 * derives the kind (method vs property), the member name and — for methods — a
 * conservative best-effort list of parameter types inferred from the call
 * arguments. The render helpers then turn that into a safe, empty-bodied stub.
 *
 * Design constraints:
 *  - Pure functions only — no filesystem, no I/O, no editor coupling.
 *  - CONSERVATIVE: when in any doubt the detector returns `null` and an argument
 *    whose type cannot be confidently inferred becomes `null` (untyped) rather
 *    than a guessed (possibly wrong) type.
 *  - Reuses `parsePhpClassStructure` to know which members already exist, so an
 *    existing method/property correctly yields `null` (nothing to create).
 *  - Follows the masking/balanced style of `phpClassStructure.ts`: strings and
 *    comments are masked to spaces before any structural reasoning so that
 *    `$this->` inside a string literal is never mistaken for a real usage.
 */

export type PhpMemberKind = "method" | "property" | "constant";

/**
 * Which class the synthesized member belongs to:
 *  - `self`: the enclosing class itself (the `$this->` / `self::` / `static::`
 *    cases — a pure single-file edit).
 *  - `parent`: the parent class named by the enclosing class's `extends` clause
 *    (the `parent::` case — a cross-file edit the controller resolves and
 *    applies, conservatively, only when the parent file is unambiguous).
 */
export type PhpCreateTarget = "self" | "parent";

export interface MissingThisMember {
  argTypes?: (string | null)[];
  /**
   * True when the usage is a static access (`self::` / `static::`) so the
   * generated method must carry the `static` modifier. Absent / false for the
   * instance `$this->` and `parent::` instance-method cases.
   */
  isStatic?: boolean;
  kind: PhpMemberKind;
  name: string;
  /**
   * Set only for `target: "parent"`: the parent class reference exactly as it
   * appears in the enclosing class's `extends` clause (still to be resolved to a
   * file by the caller). Lets the controller locate the cross-file edit target.
   */
  parentClass?: string;
  /**
   * Conservatively inferred type for a `$this->prop = <typed expr>` assignment
   * (`new Foo()` -> `Foo`, a string literal -> `string`, `[]` -> `array`).
   * Absent when the property is a plain read or the assigned value's type cannot
   * be inferred unambiguously (untyped property).
   */
  propertyType?: string | null;
  /**
   * The class the member is created on. Absent is treated as `"self"` by callers
   * for backward compatibility with the original `$this->` behaviour.
   */
  target?: PhpCreateTarget;
}

export interface RenderCreateMethodOptions {
  indent?: string;
  isStatic?: boolean;
  visibility?: PhpVisibility;
}

export interface RenderCreatePropertyOptions {
  indent?: string;
  type?: string | null;
  visibility?: PhpVisibility;
}

export interface RenderCreateConstantOptions {
  indent?: string;
  visibility?: PhpVisibility;
}

const DEFAULT_INDENT = "    ";
const DEFAULT_VISIBILITY: PhpVisibility = "private";
const THIS_ACCESS = "$this->";
const SELF_ACCESS = "self::";
const STATIC_ACCESS = "static::";
const PARENT_ACCESS = "parent::";
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

export function detectMissingThisMember(
  source: string,
  offset: number,
): MissingThisMember | null {
  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const access = locateMemberAccess(masked, offset);

  if (!access) {
    return null;
  }

  const usage = readMemberUsage(masked, access.nameStart, access.receiver);

  if (!usage) {
    return null;
  }

  if (access.receiver === "parent") {
    return toMissingParentMember(source, masked, usage);
  }

  if (memberExists(source, usage.name, usage.kind)) {
    return null;
  }

  return toMissingMember(source, masked, usage, access.receiver);
}

export function renderCreateConstantStub(
  name: string,
  options: RenderCreateConstantOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = options.visibility ?? DEFAULT_VISIBILITY;

  return `${indent}${visibility} const ${name} = null;`;
}

export function renderCreateMethodStub(
  name: string,
  argTypes: (string | null)[],
  options: RenderCreateMethodOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = options.visibility ?? DEFAULT_VISIBILITY;
  const staticModifier = options.isStatic ? "static " : "";
  const params = argTypes.map(renderParameter).join(", ");

  return [
    `${indent}${visibility} ${staticModifier}function ${name}(${params})`,
    `${indent}{`,
    `${indent}}`,
  ].join("\n");
}

export function renderCreatePropertyStub(
  name: string,
  options: RenderCreatePropertyOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = options.visibility ?? DEFAULT_VISIBILITY;
  const typePrefix = options.type ? `${options.type} ` : "";

  return `${indent}${visibility} ${typePrefix}$${name};`;
}

/**
 * The receiver the cursor's member access is qualified by. `this` is the
 * original instance access; `self` / `static` are static accesses on the
 * current class; `parent` targets the parent class's body (cross-file).
 */
type Receiver = "this" | "self" | "static" | "parent";

interface MemberAccess {
  nameStart: number;
  receiver: Receiver;
}

interface MemberUsage {
  argsEnd: number;
  argsStart: number | null;
  kind: PhpMemberKind;
  name: string;
}

interface ReceiverToken {
  prefix: string;
  receiver: Receiver;
}

// The recognised receiver prefixes, longest first so `static::` is matched
// before any shorter prefix that could be its proper substring.
const RECEIVER_TOKENS: ReceiverToken[] = [
  { prefix: STATIC_ACCESS, receiver: "static" },
  { prefix: PARENT_ACCESS, receiver: "parent" },
  { prefix: THIS_ACCESS, receiver: "this" },
  { prefix: SELF_ACCESS, receiver: "self" },
];

function renderParameter(type: string | null, index: number): string {
  const typePrefix = type ? `${type} ` : "";

  return `${typePrefix}$arg${index}`;
}

function isOffsetInRange(source: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= source.length;
}

/**
 * Find the qualified member access the offset belongs to, recognising any of
 * `$this->` / `self::` / `static::` / `parent::`. The offset may sit anywhere on
 * the member name or on the `->` / `::` operator that precedes it.
 */
function locateMemberAccess(
  masked: string,
  offset: number,
): MemberAccess | null {
  const nameStart = memberNameStart(masked, offset);

  if (nameStart === null) {
    return null;
  }

  for (const token of RECEIVER_TOKENS) {
    const accessStart = nameStart - token.prefix.length;

    if (
      accessStart < 0 ||
      masked.slice(accessStart, nameStart) !== token.prefix
    ) {
      continue;
    }

    // A receiver keyword must stand on its own; reject when an identifier
    // character abuts it (e.g. `myself::`, `$notthis->`) so we never mistake a
    // longer token's tail for a real receiver.
    if (isIdentifierChar(masked[accessStart - 1] || "")) {
      return null;
    }

    return { nameStart, receiver: token.receiver };
  }

  return null;
}

/**
 * Resolve the start offset of the member identifier that the cursor is on,
 * tolerating a cursor that sits on the `->` operator just before the name.
 */
function memberNameStart(masked: string, offset: number): number | null {
  const onName = identifierStartAt(masked, offset);

  if (onName !== null) {
    return onName;
  }

  return identifierStartAt(masked, skipForwardToIdentifier(masked, offset));
}

function skipForwardToIdentifier(masked: string, offset: number): number {
  let index = offset;

  while (index < masked.length && !isIdentifierChar(masked[index] || "")) {
    index += 1;
  }

  return index;
}

function identifierStartAt(masked: string, offset: number): number | null {
  if (!isIdentifierChar(masked[offset] || "")) {
    return null;
  }

  let start = offset;

  while (start > 0 && isIdentifierChar(masked[start - 1] || "")) {
    start -= 1;
  }

  return start;
}

function readMemberUsage(
  masked: string,
  nameStart: number,
  receiver: Receiver,
): MemberUsage | null {
  const name = readIdentifier(masked, nameStart);

  if (!name) {
    return null;
  }

  const afterName = skipWhitespace(masked, nameStart + name.length);

  if (masked[afterName] !== "(") {
    // A `::IDENT` access without a call is a class constant (`self::CONST`,
    // `static::CONST`, `parent::CONST`); only a `->ident` access without a call
    // is an instance property. PHP has no `parent::$property` access, so a
    // non-call `parent::IDENT` is a constant, never a property.
    const kind = usesScopeResolution(receiver) ? "constant" : "property";

    return { argsEnd: afterName, argsStart: null, kind, name };
  }

  const argsEnd = matchingPairOffset(masked, afterName, "(", ")");

  if (argsEnd === null) {
    return null;
  }

  return { argsEnd, argsStart: afterName + 1, kind: "method", name };
}

/**
 * Whether the receiver is accessed via the scope-resolution operator (`::`), so
 * a non-call `::IDENT` names a class constant rather than an instance property.
 * Covers `self::`, `static::` and `parent::`.
 */
function usesScopeResolution(receiver: Receiver): boolean {
  return receiver === "self" || receiver === "static" || receiver === "parent";
}

/**
 * Whether a method synthesized for this receiver must carry the `static`
 * modifier. Only `self::method()` / `static::method()` create a static method;
 * `parent::method()` creates an instance method on the parent.
 */
function createsStaticMethod(receiver: Receiver): boolean {
  return receiver === "self" || receiver === "static";
}

function toMissingMember(
  source: string,
  masked: string,
  usage: MemberUsage,
  receiver: Receiver,
): MissingThisMember {
  if (usage.kind === "constant") {
    return { kind: "constant", name: usage.name, target: "self" };
  }

  if (usage.kind === "property") {
    return toMissingProperty(source, masked, usage);
  }

  const isStatic = createsStaticMethod(receiver);

  return {
    argTypes: inferArgumentTypes(source, masked, usage),
    kind: "method",
    name: usage.name,
    ...(isStatic ? { isStatic: true, target: "self" as const } : {}),
  };
}

function toMissingProperty(
  source: string,
  masked: string,
  usage: MemberUsage,
): MissingThisMember {
  const propertyType = inferAssignedPropertyType(source, masked, usage.argsEnd);

  if (propertyType === null) {
    return { kind: "property", name: usage.name };
  }

  return { kind: "property", name: usage.name, propertyType };
}

/**
 * Resolve the `parent::` usage to a member on the parent class. Returns `null`
 * (no offer) when the enclosing class has no `extends` clause - there is no
 * parent to create the member on. Member existence on the parent is NOT checked
 * here (the parent body lives in another file); the controller resolves the
 * parent file and re-checks existence before applying the cross-file edit.
 */
function toMissingParentMember(
  source: string,
  masked: string,
  usage: MemberUsage,
): MissingThisMember | null {
  const parentClass = enclosingExtendsClause(masked, source);

  if (!parentClass) {
    return null;
  }

  // A `parent::` access is reached via the scope-resolution operator, so a
  // non-call `parent::IDENT` is a class constant - never an instance property
  // (PHP has no `parent::$property`). Only `constant` and `method` are possible.
  if (usage.kind === "constant") {
    return { kind: "constant", name: usage.name, parentClass, target: "parent" };
  }

  return {
    argTypes: inferArgumentTypes(source, masked, usage),
    kind: "method",
    name: usage.name,
    parentClass,
    target: "parent",
  };
}

/**
 * Find the parent class reference from the enclosing class's `extends` clause.
 * Conservative: returns the FIRST `extends <Name>` found in the masked source.
 * A class has at most one parent, so this is unambiguous for the common case.
 */
function enclosingExtendsClause(
  masked: string,
  _source: string,
): string | null {
  const match =
    /\bclass\s+[A-Za-z_][A-Za-z0-9_]*\s+extends\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)/.exec(
      masked,
    );

  return match?.[1] ?? null;
}

/**
 * Infer a property's declared type from a `$this->prop = <expr>;` assignment.
 * Returns the inferred short type for an unambiguous `new Foo()` / scalar /
 * array literal, otherwise `null` (untyped). Only a real assignment (`=` not
 * followed by `=`, and not preceded by a comparison/operator char) is honoured;
 * a plain read or an `==` / `>=` comparison yields `null`.
 */
function inferAssignedPropertyType(
  source: string,
  masked: string,
  afterName: number,
): string | null {
  const equalsOffset = skipWhitespace(masked, afterName);

  if (masked[equalsOffset] !== "=") {
    return null;
  }

  // Reject `==`, `===` (comparison) and compound-assignment / comparison
  // operators whose `=` we might have landed on (`>=`, `<=`, `!=`, `.=`, ...).
  if (masked[equalsOffset + 1] === "=") {
    return null;
  }

  const previous = masked[equalsOffset - 1] || "";

  if (/[=!<>+\-*/.%&|^]/.test(previous.trim() ? previous : "")) {
    return null;
  }

  // Skip leading whitespace on the ORIGINAL source so a string-literal RHS
  // (blanked to spaces in the masked source) is not skipped past. The end stop
  // still runs on the masked source so a `;` inside a string cannot end it.
  const valueStart = skipWhitespace(source, equalsOffset + 1);
  const valueEnd = findAssignmentStop(masked, valueStart);
  const expression = source.slice(valueStart, valueEnd).trim();

  return inferLiteralType(expression);
}

/**
 * Find where an assignment's right-hand-side expression ends: the first `;` at
 * bracket depth 0 (or end of source). Runs on the masked source so a `;` inside
 * a string / comment cannot terminate it early.
 */
function findAssignmentStop(masked: string, start: number): number {
  let depth = 0;

  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === ";" && depth === 0) {
      return index;
    }
  }

  return masked.length;
}

function inferArgumentTypes(
  source: string,
  masked: string,
  usage: MemberUsage,
): (string | null)[] {
  if (usage.argsStart === null) {
    return [];
  }

  const args = splitArguments(source, masked, usage.argsStart, usage.argsEnd);

  return args.map(inferLiteralType);
}

/**
 * Split a call's argument list on top-level commas, returning each raw argument
 * source slice (trimmed). An empty / whitespace-only list yields no arguments.
 *
 * Emptiness is decided on the ORIGINAL source slice, not the masked one: a
 * single string-literal argument (`'x'`) is blanked to spaces in the masked
 * source, so testing the masked slice would wrongly classify it as no-args and
 * drop the argument. Comma scanning still runs on the masked source so a comma
 * inside a string / nested call never splits an argument.
 */
function splitArguments(
  source: string,
  masked: string,
  start: number,
  end: number,
): string[] {
  if (source.slice(start, end).trim().length === 0) {
    return [];
  }

  const args: string[] = [];
  let segmentStart = start;
  let depth = 0;

  for (let index = start; index < end; index += 1) {
    const character = masked[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      args.push(source.slice(segmentStart, index).trim());
      segmentStart = index + 1;
    }
  }

  args.push(source.slice(segmentStart, end).trim());

  return args;
}

/**
 * Conservatively infer a parameter type from a single argument expression.
 * Returns `null` (untyped) for anything that is not an unambiguous literal /
 * constructor / `::class` constant.
 */
function inferLiteralType(argument: string): string | null {
  if (!argument) {
    return null;
  }

  return (
    inferScalarType(argument) ??
    inferStructuralType(argument) ??
    inferConstructorType(argument) ??
    inferClassConstantType(argument)
  );
}

function inferScalarType(argument: string): string | null {
  if (argument === "true" || argument === "false") {
    return "bool";
  }

  if (/^-?\d+$/.test(argument)) {
    return "int";
  }

  if (/^-?(?:\d+\.\d*|\.\d+|\d+(?:[eE][+-]?\d+))$/.test(argument)) {
    return "float";
  }

  if (/^(['"])/.test(argument)) {
    return "string";
  }

  return null;
}

function inferStructuralType(argument: string): string | null {
  if (argument.startsWith("[") || /^array\s*\(/.test(argument)) {
    return "array";
  }

  return null;
}

function inferConstructorType(argument: string): string | null {
  const match = /^new\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\s*\(/.exec(argument);
  const className = match?.[1];

  if (!className) {
    return null;
  }

  return shortClassName(className);
}

function inferClassConstantType(argument: string): string | null {
  if (/^\\?[A-Za-z_][A-Za-z0-9_\\]*::class$/.test(argument)) {
    return "string";
  }

  return null;
}

function shortClassName(className: string): string {
  const segments = className.split("\\").filter((segment) => segment.length > 0);

  return segments[segments.length - 1] ?? className;
}

function memberExists(
  source: string,
  name: string,
  kind: PhpMemberKind,
): boolean {
  return phpClassDeclaresMember(source, name, kind);
}

/**
 * Whether the class declares a member of `kind` named `name`. Scoped to a single
 * class by `className` (its short, declared name) so a multi-class file does not
 * leak a sibling's members - used to suppress a "create in parent" offer when
 * the same-file parent already declares the member. Omitting `className` checks
 * the first/enclosing class (the `$this->` / `self::` single-class case).
 *
 * Constants are matched textually (the structural parser does not model them);
 * methods/properties via the structural parse plus promoted-constructor params.
 */
export function phpClassDeclaresMember(
  source: string,
  name: string,
  kind: PhpMemberKind,
  className?: string,
): boolean {
  if (kind === "constant") {
    return constantExists(source, name, className);
  }

  const structure = parsePhpClassStructure(source, className);

  if (kind === "method") {
    return structure.methods.some((method) => method.name === name);
  }

  if (structure.properties.some((property) => property.name === name)) {
    return true;
  }

  return promotedConstructorPropertyExists(source, name, className);
}

/**
 * `parsePhpClassStructure` does not model class constants, so detect a declared
 * `const NAME` (optionally typed / multi-modifier) directly on the masked
 * source. Conservative: any `const NAME` token in the class body counts as
 * existing so we never offer to create a duplicate constant. Enum cases
 * (`case NAME;`) are also honoured since `Enum::NAME` resolves to a case. When
 * `className` is given the scan is scoped to that class's body so a sibling
 * class's constant in the same file does not falsely suppress the offer.
 */
function constantExists(
  source: string,
  name: string,
  className?: string,
): boolean {
  const masked = classBodyMasked(source, className);

  if (masked === null) {
    return false;
  }

  const constPattern = new RegExp(
    String.raw`\bconst\s+(?:[\\?A-Za-z_][\\A-Za-z0-9_|&?\s]*?\s+)?${name}\b`,
  );

  if (constPattern.test(masked)) {
    return true;
  }

  return new RegExp(String.raw`\bcase\s+${name}\b`).test(masked);
}

/**
 * The masked source, optionally narrowed to the body of the named class. Returns
 * the whole masked source when no class name is given; `null` when a name is
 * given but the class / its braces cannot be located.
 */
function classBodyMasked(source: string, className?: string): string | null {
  const masked = maskPhpStringsAndComments(source);

  if (!className) {
    return masked;
  }

  const pattern = new RegExp(
    String.raw`\b(?:class|interface|trait|enum)\s+${className}\b`,
  );
  const match = pattern.exec(masked);

  if (!match) {
    return null;
  }

  const bodyStart = masked.indexOf("{", match.index + match[0].length);

  if (bodyStart < 0) {
    return null;
  }

  const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  return masked.slice(bodyStart, bodyEnd + 1);
}

/**
 * `parsePhpClassStructure` only models declared properties, so a PHP 8
 * constructor-promoted property (`__construct(private Foo $bar)`) is invisible
 * to it. Detect those directly so we never offer to "create" a property that is
 * already promoted on the constructor.
 */
function promotedConstructorPropertyExists(
  source: string,
  name: string,
  className?: string,
): boolean {
  const masked = classBodyMasked(source, className);

  if (masked === null) {
    return false;
  }

  const constructor = /\bfunction\s+__construct\s*\(/i.exec(masked);

  if (!constructor) {
    return false;
  }

  const openParen = constructor.index + constructor[0].length - 1;
  const closeParen = matchingPairOffset(masked, openParen, "(", ")");

  if (closeParen === null) {
    return false;
  }

  const parameters = masked.slice(openParen + 1, closeParen);
  const promoted = new RegExp(
    String.raw`\b(?:public|protected|private|readonly)\b[^,]*?\$${name}\b`,
  );

  return promoted.test(parameters);
}

function readIdentifier(masked: string, start: number): string | null {
  const match = IDENTIFIER.exec(masked.slice(start));

  if (!match || match.index !== 0) {
    return null;
  }

  return match[0];
}

function skipWhitespace(masked: string, start: number): number {
  let index = start;

  while (index < masked.length && /\s/.test(masked[index] || "")) {
    index += 1;
  }

  return index;
}

function isIdentifierChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

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

    if (character === "'" || character === "\"" || character === "`") {
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

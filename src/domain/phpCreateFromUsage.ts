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

export type PhpMemberKind = "method" | "property";

export interface MissingThisMember {
  argTypes?: (string | null)[];
  kind: PhpMemberKind;
  name: string;
}

export interface RenderCreateMethodOptions {
  indent?: string;
  visibility?: PhpVisibility;
}

export interface RenderCreatePropertyOptions {
  indent?: string;
  type?: string | null;
  visibility?: PhpVisibility;
}

const DEFAULT_INDENT = "    ";
const DEFAULT_VISIBILITY: PhpVisibility = "private";
const THIS_ACCESS = "$this->";
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

export function detectMissingThisMember(
  source: string,
  offset: number,
): MissingThisMember | null {
  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const access = locateThisAccess(masked, offset);

  if (!access) {
    return null;
  }

  const usage = readMemberUsage(masked, access.nameStart);

  if (!usage) {
    return null;
  }

  if (memberExists(source, usage.name, usage.kind)) {
    return null;
  }

  return toMissingMember(source, masked, usage);
}

export function renderCreateMethodStub(
  name: string,
  argTypes: (string | null)[],
  options: RenderCreateMethodOptions = {},
): string {
  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = options.visibility ?? DEFAULT_VISIBILITY;
  const params = argTypes.map(renderParameter).join(", ");

  return [
    `${indent}${visibility} function ${name}(${params})`,
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

interface ThisAccess {
  nameStart: number;
}

interface MemberUsage {
  argsEnd: number;
  argsStart: number | null;
  kind: PhpMemberKind;
  name: string;
}

function renderParameter(type: string | null, index: number): string {
  const typePrefix = type ? `${type} ` : "";

  return `${typePrefix}$arg${index}`;
}

function isOffsetInRange(source: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= source.length;
}

/**
 * Find the `$this->` access that the offset belongs to. The offset may sit
 * anywhere on the member name or on the `->` operator that precedes it.
 */
function locateThisAccess(masked: string, offset: number): ThisAccess | null {
  const nameStart = memberNameStart(masked, offset);

  if (nameStart === null) {
    return null;
  }

  const accessStart = nameStart - THIS_ACCESS.length;

  if (accessStart < 0 || masked.slice(accessStart, nameStart) !== THIS_ACCESS) {
    return null;
  }

  if (isIdentifierChar(masked[accessStart - 1] || "")) {
    return null;
  }

  return { nameStart };
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

function readMemberUsage(masked: string, nameStart: number): MemberUsage | null {
  const name = readIdentifier(masked, nameStart);

  if (!name) {
    return null;
  }

  const afterName = skipWhitespace(masked, nameStart + name.length);

  if (masked[afterName] !== "(") {
    return { argsEnd: afterName, argsStart: null, kind: "property", name };
  }

  const argsEnd = matchingPairOffset(masked, afterName, "(", ")");

  if (argsEnd === null) {
    return null;
  }

  return { argsEnd, argsStart: afterName + 1, kind: "method", name };
}

function toMissingMember(
  source: string,
  masked: string,
  usage: MemberUsage,
): MissingThisMember {
  if (usage.kind === "property") {
    return { kind: "property", name: usage.name };
  }

  return {
    argTypes: inferArgumentTypes(source, masked, usage),
    kind: "method",
    name: usage.name,
  };
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
 */
function splitArguments(
  source: string,
  masked: string,
  start: number,
  end: number,
): string[] {
  if (masked.slice(start, end).trim().length === 0) {
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
  const structure = parsePhpClassStructure(source);

  if (kind === "method") {
    return structure.methods.some((method) => method.name === name);
  }

  if (structure.properties.some((property) => property.name === name)) {
    return true;
  }

  return promotedConstructorPropertyExists(source, name);
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
): boolean {
  const masked = maskPhpStringsAndComments(source);
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

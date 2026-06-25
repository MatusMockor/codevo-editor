import {
  phpMethodParameters,
  type PhpMethodParameter,
} from "./phpMethodCompletions";
import {
  firstPhpDocTypeToken,
  phpDocReturnTypeToken,
} from "./phpDocTemplates";
import { phpCurrentTypeKind } from "./phpNavigation";

/**
 * Precise structural model of the members of a PHP class/interface/trait/enum,
 * built for OOP code generation (e.g. "implement interface methods").
 *
 * Unlike `phpMethodCompletionsFromSource`, this captures EVERY member
 * (not just public ones) and preserves the information code-gen needs:
 * exact signatures, visibility, abstract/static/final modifiers and PHPDoc.
 */

export type PhpVisibility = "public" | "protected" | "private";

export type PhpTypeKind =
  | "class"
  | "interface"
  | "trait"
  | "enum"
  | "abstract-class";

export interface PhpStructuredParameter {
  defaultValue: string | null;
  isByRef: boolean;
  isOptional: boolean;
  isVariadic: boolean;
  name: string;
  type: string | null;
}

export interface PhpMethodPhpDoc {
  params: Record<string, string>;
  raw: string;
  returnType: string | null;
}

export interface PhpMethodMember {
  /**
   * Character offset of the method's `function` keyword in the original source.
   * Code-gen that inserts text relative to a method (e.g. "Generate PHPDoc"
   * above the declaration line) maps from this offset; it does not include any
   * preceding modifiers, attributes or PHPDoc.
   */
  declarationOffset: number;
  isAbstract: boolean;
  isFinal: boolean;
  isStatic: boolean;
  /**
   * Character offset of the first character that belongs to this member's
   * declaration once leading attributes (`#[...]`) and modifier keywords
   * (`public`, `static`, `final`, ...) above the `function` keyword are
   * included. Equals `declarationOffset` when nothing precedes `function`.
   *
   * Cursor-to-member matching uses this as the span's lower bound so a cursor
   * parked on an attribute or modifier line still resolves to this method.
   * Code-gen insertion still anchors on `declarationOffset` (above the
   * `function` line, below the attributes).
   */
  memberStartOffset: number;
  name: string;
  parameters: PhpStructuredParameter[];
  phpDoc: PhpMethodPhpDoc | null;
  returnType: string | null;
  visibility: PhpVisibility;
}

export interface PhpPropertyPhpDoc {
  raw: string;
  varType: string | null;
}

export interface PhpPropertyMember {
  defaultValue: string | null;
  isReadonly: boolean;
  isStatic: boolean;
  name: string;
  phpDoc: PhpPropertyPhpDoc | null;
  type: string | null;
  visibility: PhpVisibility;
}

export interface PhpClassStructure {
  kind: PhpTypeKind | null;
  methods: PhpMethodMember[];
  properties: PhpPropertyMember[];
}

interface PhpTypeDeclaration {
  bodyEnd: number;
  bodyStart: number;
  isAbstract: boolean;
  kind: "class" | "interface" | "trait" | "enum";
}

const MEMBER_MODIFIERS = [
  "abstract",
  "final",
  "private",
  "protected",
  "public",
  "readonly",
  "static",
] as const;

export function parsePhpClassStructure(
  source: string,
  className?: string,
): PhpClassStructure {
  const masked = maskPhpStringsAndComments(source);
  const declaration = locatePhpTypeDeclaration(masked, className);

  if (!declaration) {
    return { kind: fallbackKind(source), methods: [], properties: [] };
  }

  const kind = resolveTypeKind(declaration);
  const isInterface = declaration.kind === "interface";

  return {
    kind,
    methods: parsePhpMethods(source, masked, declaration, isInterface),
    properties: parsePhpProperties(source, masked, declaration),
  };
}

function fallbackKind(source: string): PhpTypeKind | null {
  const kind = phpCurrentTypeKind(source);

  if (!kind) {
    return null;
  }

  if (kind !== "class") {
    return kind;
  }

  return /\babstract\s+class\b/.test(source) ? "abstract-class" : "class";
}

function resolveTypeKind(declaration: PhpTypeDeclaration): PhpTypeKind {
  if (declaration.kind === "class" && declaration.isAbstract) {
    return "abstract-class";
  }

  return declaration.kind;
}

function locatePhpTypeDeclaration(
  masked: string,
  className: string | undefined,
): PhpTypeDeclaration | null {
  const pattern =
    /\b(abstract\s+|final\s+)*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const match of masked.matchAll(pattern)) {
    const kind = match[2];
    const name = match[3];

    if (!isDeclarableKind(kind) || !name) {
      continue;
    }

    if (className && name !== className) {
      continue;
    }

    const isAbstract = /\babstract\b/.test(match[0]);
    const declaration = buildTypeDeclaration(
      masked,
      match.index ?? 0,
      kind,
      name,
      isAbstract,
    );

    if (declaration) {
      return declaration;
    }
  }

  return null;
}

function buildTypeDeclaration(
  masked: string,
  matchOffset: number,
  kind: "class" | "interface" | "trait" | "enum",
  name: string,
  isAbstract: boolean,
): PhpTypeDeclaration | null {
  const nameOffset = masked.indexOf(name, matchOffset);
  const bodyStart = masked.indexOf("{", nameOffset + name.length);

  if (bodyStart < 0) {
    return null;
  }

  const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  return {
    bodyEnd,
    bodyStart,
    isAbstract,
    kind,
  };
}

function isDeclarableKind(
  kind: string | undefined,
): kind is "class" | "interface" | "trait" | "enum" {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "trait" ||
    kind === "enum"
  );
}

function parsePhpMethods(
  source: string,
  masked: string,
  declaration: PhpTypeDeclaration,
  isInterface: boolean,
): PhpMethodMember[] {
  const methods: PhpMethodMember[] = [];
  const pattern = /\bfunction\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  pattern.lastIndex = declaration.bodyStart;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < declaration.bodyEnd;
    match = pattern.exec(masked)
  ) {
    const name = match[1];
    const functionOffset = match.index ?? 0;

    if (!name || !isTopLevelMember(masked, declaration, functionOffset)) {
      continue;
    }

    const member = buildMethodMember(
      source,
      masked,
      declaration,
      functionOffset,
      name,
      isInterface,
    );

    if (member) {
      methods.push(member);
    }
  }

  return methods;
}

function buildMethodMember(
  source: string,
  masked: string,
  declaration: PhpTypeDeclaration,
  functionOffset: number,
  name: string,
  isInterface: boolean,
): PhpMethodMember | null {
  const openParen = masked.indexOf("(", functionOffset);
  const closeParen = matchingPairOffset(masked, openParen, "(", ")");

  if (openParen < 0 || closeParen === null) {
    return null;
  }

  const parameters = parseStructuredParameters(
    source.slice(openParen + 1, closeParen),
  );
  const returnType = parseReturnType(source, masked, closeParen + 1);
  const modifiers = modifiersBefore(masked, declaration, functionOffset);
  const phpDoc = parseMethodPhpDoc(source, declaration, functionOffset);

  return {
    declarationOffset: functionOffset,
    isAbstract: isInterface || modifiers.has("abstract"),
    isFinal: modifiers.has("final"),
    isStatic: modifiers.has("static"),
    memberStartOffset: memberStartOffset(
      source,
      masked,
      declaration,
      functionOffset,
    ),
    name,
    parameters,
    phpDoc,
    returnType,
    visibility: visibilityFromModifiers(modifiers),
  };
}

// Walks back from the `function` keyword over the run of leading modifier
// keywords (`public`, `static`, `readonly`, ...), attribute blocks (`#[...]`)
// and whitespace that decorate the declaration. Stops at the previous member
// boundary - a closing brace / semicolon of a sibling member, the class body's
// opening brace, or any other non-decorator token. The returned offset is the
// first character that belongs to this member; it never reaches into the source
// of the preceding member.
//
// Token detection runs against the ORIGINAL source because the masked source
// blanks out whole `#[...]` attribute blocks. To stay robust against `}`/`;`
// inside a string or comment in the decorator gap (e.g. a PHPDoc), boundary
// classification is cross-checked against the masked source, where such
// characters are blanked.
function memberStartOffset(
  source: string,
  masked: string,
  declaration: PhpTypeDeclaration,
  functionOffset: number,
): number {
  const lowerBound = declaration.bodyStart;
  let cursor = functionOffset;

  for (;;) {
    const previous = previousMemberToken(source, masked, lowerBound, cursor);

    if (previous === null) {
      return cursor;
    }

    cursor = previous;
  }
}

// Returns the start offset of the modifier keyword or attribute block that ends
// immediately before `cursor` (ignoring whitespace), or `null` when the run of
// member decorators is exhausted. `null` means `cursor` is already the member
// start.
function previousMemberToken(
  source: string,
  masked: string,
  lowerBound: number,
  cursor: number,
): number | null {
  let index = cursor - 1;

  while (index >= lowerBound && /\s/.test(source[index] || "")) {
    index -= 1;
  }

  if (index < lowerBound) {
    return null;
  }

  if (source[index] === "]") {
    return attributeBlockStart(source, lowerBound, index);
  }

  return modifierKeywordStart(source, masked, lowerBound, index);
}

// Given the offset of a `]` that closes an attribute block, returns the offset
// of its matching `#[` by balancing brackets in the original source. Returns
// `null` when the brackets do not resolve to a well-formed `#[...]` block within
// the class body.
//
// Known limitation: brackets that appear inside an attribute argument's STRING
// literal (e.g. `#[Route(']')]`) are counted literally, which can mis-place the
// opener. This mirrors `maskPhpStringsAndComments`, which does not honour strings
// inside `#[...]` either, so the limitation is pre-existing and consistent. The
// impact is bounded: only the cursor-matching lower bound is affected for that
// rare construct; docblock insertion still anchors on `declarationOffset`.
function attributeBlockStart(
  source: string,
  lowerBound: number,
  closeBracket: number,
): number | null {
  let depth = 0;

  for (let index = closeBracket; index >= lowerBound; index -= 1) {
    const character = source[index] || "";

    if (character === "]") {
      depth += 1;
      continue;
    }

    if (character !== "[") {
      continue;
    }

    depth -= 1;

    if (depth !== 0) {
      continue;
    }

    if (source[index - 1] === "#") {
      return index - 1;
    }

    return null;
  }

  return null;
}

// Given the offset of the last character of a contiguous identifier token that
// ends immediately before the member decorator run, returns the token's start
// offset when it is a recognised member modifier, otherwise `null` (the run is
// exhausted; this token belongs to a previous member or boundary). The token
// must be real code - if the masked source blanked it (a string/comment), it is
// not a modifier.
function modifierKeywordStart(
  source: string,
  masked: string,
  lowerBound: number,
  tokenEnd: number,
): number | null {
  let start = tokenEnd;

  while (start - 1 >= lowerBound && /[A-Za-z]/.test(source[start - 1] || "")) {
    start -= 1;
  }

  if (masked.slice(start, tokenEnd + 1) !== source.slice(start, tokenEnd + 1)) {
    return null;
  }

  const token = source.slice(start, tokenEnd + 1).toLowerCase();

  if (!(MEMBER_MODIFIERS as readonly string[]).includes(token)) {
    return null;
  }

  return start;
}

function parseStructuredParameters(
  parameterSource: string,
): PhpStructuredParameter[] {
  return phpMethodParameters(parameterSource).map(toStructuredParameter);
}

function toStructuredParameter(
  parameter: PhpMethodParameter,
): PhpStructuredParameter {
  const beforeName = (parameter.raw.split(parameter.name)[0] ?? "").trimEnd();

  return {
    defaultValue: parameter.defaultValue,
    isByRef: /&\s*(?:\.\.\.)?\s*$/.test(beforeName),
    isOptional: parameter.optional || /\.\.\.\s*$/.test(beforeName),
    isVariadic: /\.\.\.\s*$/.test(beforeName),
    name: parameter.name,
    type: normalizeType(stripParameterTypeNoise(parameter.type)),
  };
}

function stripParameterTypeNoise(type: string | null): string | null {
  if (!type) {
    return null;
  }

  return type.replace(/[&\s.]+$/, "").trim() || null;
}

function parseReturnType(
  source: string,
  masked: string,
  afterParen: number,
): string | null {
  let index = afterParen;

  while (index < masked.length && /\s/.test(masked[index] || "")) {
    index += 1;
  }

  if (masked[index] !== ":") {
    return null;
  }

  index += 1;
  const stop = findReturnTypeStop(masked, index);
  const returnType = source.slice(index, stop);

  return normalizeType(returnType);
}

function findReturnTypeStop(masked: string, start: number): number {
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "{" || character === ";" || character === "\n") {
      return index;
    }
  }

  return masked.length;
}

function modifiersBefore(
  masked: string,
  declaration: PhpTypeDeclaration,
  functionOffset: number,
): Set<string> {
  const limit = Math.max(declaration.bodyStart + 1, functionOffset - 256);
  const region = masked.slice(limit, functionOffset);
  const withoutAttributes = region.replace(/#\[[\s\S]*?\]/g, " ");
  const tail = /([A-Za-z\s]*)$/.exec(withoutAttributes)?.[1] ?? "";
  const modifiers = new Set<string>();

  for (const token of tail.toLowerCase().split(/\s+/)) {
    if ((MEMBER_MODIFIERS as readonly string[]).includes(token)) {
      modifiers.add(token);
    }
  }

  return modifiers;
}

function visibilityFromModifiers(modifiers: Set<string>): PhpVisibility {
  if (modifiers.has("private")) {
    return "private";
  }

  if (modifiers.has("protected")) {
    return "protected";
  }

  return "public";
}

function parseMethodPhpDoc(
  source: string,
  declaration: PhpTypeDeclaration,
  functionOffset: number,
): PhpMethodPhpDoc | null {
  const raw = phpDocBlockBefore(source, declaration, functionOffset);

  if (!raw) {
    return null;
  }

  return {
    params: phpDocParamTypes(raw),
    raw,
    returnType: normalizeType(phpDocReturnTypeToken(raw)),
  };
}

function phpDocParamTypes(docBlock: string): Record<string, string> {
  const params: Record<string, string> = {};

  for (const match of docBlock.matchAll(
    /@(?:(?:phpstan|psalm)-)?param\s+([^\r\n*]+?)\s+(?:&\s*)?(?:\.\.\.)?\$([A-Za-z_][A-Za-z0-9_]*)\b/g,
  )) {
    const type = firstPhpDocTypeToken(match[1] ?? null);
    const name = match[2];

    if (!type || !name) {
      continue;
    }

    params[name] = type;
  }

  return params;
}

function parsePhpProperties(
  source: string,
  masked: string,
  declaration: PhpTypeDeclaration,
): PhpPropertyMember[] {
  const properties: PhpPropertyMember[] = [];
  const pattern =
    /\b((?:(?:public|protected|private|readonly|static)\s+)+)((?:[\\?A-Za-z_][\\A-Za-z0-9_|&?\s]*?)?)\$([A-Za-z_][A-Za-z0-9_]*)/g;
  pattern.lastIndex = declaration.bodyStart;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < declaration.bodyEnd;
    match = pattern.exec(masked)
  ) {
    const declarationOffset = match.index ?? 0;

    if (!isTopLevelMember(masked, declaration, declarationOffset)) {
      continue;
    }

    const member = buildPropertyMember(source, masked, declaration, match);

    if (member) {
      properties.push(member);
    }
  }

  return properties;
}

function buildPropertyMember(
  source: string,
  masked: string,
  declaration: PhpTypeDeclaration,
  match: RegExpExecArray,
): PhpPropertyMember | null {
  const name = match[3];

  if (!name) {
    return null;
  }

  const modifiers = (match[1] ?? "").toLowerCase();
  const dollarOffset = (match.index ?? 0) + match[0].lastIndexOf("$");

  return {
    defaultValue: parsePropertyDefault(
      source,
      masked,
      dollarOffset + 1 + name.length,
    ),
    isReadonly: /\breadonly\b/.test(modifiers),
    isStatic: /\bstatic\b/.test(modifiers),
    name,
    phpDoc: parsePropertyPhpDoc(source, declaration, match.index ?? 0),
    type: normalizeType(match[2] ?? null),
    visibility: visibilityFromPropertyModifiers(modifiers),
  };
}

function visibilityFromPropertyModifiers(modifiers: string): PhpVisibility {
  if (/\bprivate\b/.test(modifiers)) {
    return "private";
  }

  if (/\bprotected\b/.test(modifiers)) {
    return "protected";
  }

  return "public";
}

function parsePropertyDefault(
  source: string,
  masked: string,
  afterName: number,
): string | null {
  let index = afterName;

  while (index < masked.length && /\s/.test(masked[index] || "")) {
    index += 1;
  }

  if (masked[index] !== "=") {
    return null;
  }

  index += 1;
  const stop = findStatementStop(masked, index);

  return normalizeWhitespace(source.slice(index, stop)) || null;
}

function findStatementStop(masked: string, start: number): number {
  let depth = 0;

  for (let index = start; index < masked.length; index += 1) {
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

  return masked.length;
}

function parsePropertyPhpDoc(
  source: string,
  declaration: PhpTypeDeclaration,
  declarationOffset: number,
): PhpPropertyPhpDoc | null {
  const raw = phpDocBlockBefore(source, declaration, declarationOffset);

  if (!raw) {
    return null;
  }

  const varMatch = /@var\s+([^\r\n*]+)/.exec(raw);

  return {
    raw,
    varType: firstPhpDocTypeToken(varMatch?.[1] ?? null),
  };
}

function phpDocBlockBefore(
  source: string,
  declaration: PhpTypeDeclaration,
  memberOffset: number,
): string | null {
  const lowerBound = declaration.bodyStart + 1;
  const before = source.slice(lowerBound, memberOffset);
  const docStart = before.lastIndexOf("/**");
  const docEnd = before.lastIndexOf("*/");

  if (docStart < 0 || docEnd < docStart) {
    return null;
  }

  const between = before
    .slice(docEnd + 2)
    .replace(/#\[[\s\S]*?\]/g, " ")
    .replace(/\b(?:abstract|final|private|protected|public|readonly|static)\b/g, " ")
    .replace(/\b(?:[\\?A-Za-z_][\\A-Za-z0-9_|&?]*)\b/g, " ")
    .trim();

  if (between) {
    return null;
  }

  return before.slice(docStart, docEnd + 2);
}

function isTopLevelMember(
  masked: string,
  declaration: PhpTypeDeclaration,
  memberOffset: number,
): boolean {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = declaration.bodyStart; index < memberOffset; index += 1) {
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

function normalizeType(type: string | null): string | null {
  const normalized = normalizeWhitespace(type ?? "")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\s*&\s*/g, "&")
    .replace(/\?\s+/g, "?");

  return normalized || null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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
  let attributeDepth = 0;

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

    if (attributeDepth > 0) {
      if (character === "[") {
        attributeDepth += 1;
      }

      if (character === "]") {
        attributeDepth -= 1;
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

    if (character === "#" && next === "[") {
      output += "  ";
      index += 1;
      attributeDepth = 1;
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

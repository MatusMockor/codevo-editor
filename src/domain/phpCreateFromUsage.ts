import {
  parsePhpClassStructure,
  type PhpVisibility,
} from "./phpClassStructure";
import { parsePhpClassUseBody } from "./phpAddImport";
import { maskPhpSource as maskPhpStringsAndComments } from "./phpSourceMask";

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
 *  - `external`: another class named by an explicit `ClassName::` receiver.
 *    When the class is declared in the same file the plan carries
 *    `sameFileExternal` and the sync path applies the edit; otherwise the
 *    controller resolves the class to a file, conservatively, like `parent`.
 */
export type PhpCreateTarget = "self" | "parent" | "external";

export type PhpCreateRenderRelationship = "self" | "parent" | "external";

export type PhpCreateRenderTargetKind =
  | "class"
  | "interface"
  | "readonly-class"
  | "trait"
  | "enum"
  | "unsupported";

export interface PhpCreateRenderTarget {
  /** The declaration that will receive the generated member. */
  kind: PhpCreateRenderTargetKind;
  /** Controls the least visibility required by the usage site. */
  relationship: PhpCreateRenderRelationship;
  /**
   * External relationships conservatively assume a namespace boundary. Set
   * `same-namespace` only when the coordinator has proved otherwise.
   */
  typeContext?: "same-namespace" | "external-namespace";
}

export interface PhpCreateDeclarationIdentity {
  bodyEndOffset: number;
  bodyStartOffset: number;
  kind: PhpCreateRenderTargetKind;
  name: string;
  namespace: string | null;
}

export interface PhpCreateFromUsagePlan {
  member: MissingThisMember;
  owner: PhpCreateDeclarationIdentity;
  sameFileExternal?: PhpCreateDeclarationIdentity;
  sameFileParent?: PhpCreateDeclarationIdentity;
}

export interface MissingThisMember {
  argTypes?: (string | null)[];
  /**
   * True when the usage is a static access (`self::` / `static::`) so the
   * generated method must carry the `static` modifier. Also true for a
   * `parent::` invocation inside a static method. Absent / false for instance
   * contexts.
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
  targetClass?: string;
}

export interface RenderCreateMethodOptions {
  indent?: string;
  isStatic?: boolean;
  target?: PhpCreateRenderTarget;
  visibility?: PhpVisibility;
}

export interface RenderCreatePropertyOptions {
  indent?: string;
  target?: PhpCreateRenderTarget;
  type?: string | null;
  visibility?: PhpVisibility;
}

export interface RenderCreateConstantOptions {
  indent?: string;
  target?: PhpCreateRenderTarget;
  visibility?: PhpVisibility;
}

const DEFAULT_INDENT = "    ";
const DEFAULT_VISIBILITY: PhpVisibility = "private";
const DEFAULT_RENDER_TARGET: PhpCreateRenderTarget = {
  kind: "class",
  relationship: "self",
};
const THIS_ACCESS = "$this->";
const SELF_ACCESS = "self::";
const STATIC_ACCESS = "static::";
const PARENT_ACCESS = "parent::";
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/;

export function detectMissingThisMember(
  source: string,
  offset: number,
): MissingThisMember | null {
  return planPhpCreateFromUsage(source, offset)?.member ?? null;
}

export function planPhpCreateFromUsage(
  source: string,
  offset: number,
): PhpCreateFromUsagePlan | null {
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

  if (isInsideAnonymousClass(masked, access.nameStart)) {
    return null;
  }

  const enclosingType = enclosingTypeDeclaration(masked, access.nameStart);

  if (!enclosingType) {
    return null;
  }

  if (access.receiver === "parent") {
    const member = toMissingParentMember(
      source,
      masked,
      usage,
      enclosingType,
      access.nameStart,
    );

    if (!member) {
      return null;
    }

    const owner = declarationIdentity(enclosingType);
    const sameFileParent = sameFileClassDeclaration(
      masked,
      member.parentClass ?? "",
      enclosingType,
    );

    return { member, owner, ...(sameFileParent ? { sameFileParent } : {}) };
  }

  if (access.receiver === "external") {
    return planSameFileExternalMember(
      source,
      masked,
      usage,
      enclosingType,
      access.receiverClass ?? "",
    );
  }

  if (memberExists(source, usage.name, usage.kind, enclosingType.bodyStart)) {
    return null;
  }

  return {
    member: toMissingMember(source, masked, usage, access.receiver),
    owner: declarationIdentity(enclosingType),
  };
}

export function renderCreateConstantStub(
  name: string,
  options: RenderCreateConstantOptions = {},
): string | null {
  const target = options.target ?? DEFAULT_RENDER_TARGET;

  if (!supportsCreateTarget(target, "constant")) {
    return null;
  }

  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = renderVisibility(target, options.visibility);

  return `${indent}${visibility} const ${name} = null;`;
}

export function renderCreateMethodStub(
  name: string,
  argTypes: (string | null)[],
  options: RenderCreateMethodOptions = {},
): string | null {
  const target = options.target ?? DEFAULT_RENDER_TARGET;

  if (!supportsCreateTarget(target, "method")) {
    return null;
  }

  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = renderVisibility(target, options.visibility);
  const staticModifier = options.isStatic ? "static " : "";
  const params = argTypes
    .map((type, index) => renderParameter(portableType(type, target), index))
    .join(", ");

  if (target.kind === "interface") {
    return `${indent}public ${staticModifier}function ${name}(${params});`;
  }

  return [
    `${indent}${visibility} ${staticModifier}function ${name}(${params})`,
    `${indent}{`,
    `${indent}}`,
  ].join("\n");
}

export function renderCreatePropertyStub(
  name: string,
  options: RenderCreatePropertyOptions = {},
): string | null {
  const target = options.target ?? DEFAULT_RENDER_TARGET;
  const type = portableType(options.type ?? null, target);

  if (!supportsCreateTarget(target, "property", type)) {
    return null;
  }

  const indent = options.indent ?? DEFAULT_INDENT;
  const visibility = renderVisibility(target, options.visibility);
  const typePrefix = type ? `${type} ` : "";

  return `${indent}${visibility} ${typePrefix}$${name};`;
}

/**
 * The receiver the cursor's member access is qualified by. `this` is the
 * original instance access; `self` / `static` are static accesses on the
 * current class; `parent` targets the parent class's body (cross-file).
 */
type Receiver = "this" | "self" | "static" | "parent" | "external";

interface MemberAccess {
  nameStart: number;
  receiver: Receiver;
  receiverClass?: string;
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

interface EnclosingTypeDeclaration {
  bodyEnd: number;
  bodyStart: number;
  headerStart: number;
  isReadonly: boolean;
  kind: "class" | "interface" | "trait" | "enum";
  name: string;
  namespace: string | null;
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

function supportsCreateTarget(
  target: PhpCreateRenderTarget,
  memberKind: PhpMemberKind,
  propertyType: string | null = null,
): boolean {
  if (target.kind === "class") {
    return true;
  }

  if (target.kind === "interface") {
    return memberKind !== "property";
  }

  if (target.relationship !== "self") {
    return false;
  }

  if (target.kind === "trait") {
    return true;
  }

  if (target.kind === "enum") {
    return memberKind !== "property";
  }

  if (target.kind === "readonly-class") {
    return memberKind !== "property" || propertyType !== null;
  }

  return false;
}

function createVisibility(target: PhpCreateRenderTarget): PhpVisibility {
  if (target.kind === "interface" || target.relationship === "external") {
    return "public";
  }

  if (target.relationship === "parent") {
    return "protected";
  }

  return DEFAULT_VISIBILITY;
}

function renderVisibility(
  target: PhpCreateRenderTarget,
  requested: PhpVisibility | undefined,
): PhpVisibility {
  if (target.kind !== "interface" && target.relationship === "self") {
    return requested ?? DEFAULT_VISIBILITY;
  }

  return createVisibility(target);
}

function portableType(
  type: string | null,
  target: PhpCreateRenderTarget,
): string | null {
  if (!type || !crossesNamespaceBoundary(target)) {
    return type;
  }

  const atoms = type.split(/([|&])/);

  if (atoms.every(isPortableTypeAtom)) {
    return type;
  }

  return null;
}
function crossesNamespaceBoundary(target: PhpCreateRenderTarget): boolean {
  if (target.typeContext === "same-namespace") {
    return false;
  }

  return (
    target.typeContext === "external-namespace" ||
    target.relationship === "external"
  );
}

function isPortableTypeAtom(atom: string): boolean {
  if (atom === "|" || atom === "&") {
    return true;
  }

  const candidate = atom.trim().replace(/^\?/, "");

  if (candidate.startsWith("\\")) {
    return /^\\[A-Za-z_][A-Za-z0-9_\\]*$/.test(candidate);
  }

  return BUILTIN_TYPES.has(candidate.toLowerCase());
}

const BUILTIN_TYPES = new Set([
  "array",
  "bool",
  "callable",
  "false",
  "float",
  "int",
  "iterable",
  "mixed",
  "never",
  "null",
  "object",
  "string",
  "true",
  "void",
]);

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
      break;
    }

    return { nameStart, receiver: token.receiver };
  }

  return locateExternalReceiverAccess(masked, nameStart);
}

function locateExternalReceiverAccess(
  masked: string,
  nameStart: number,
): MemberAccess | null {
  const operatorStart = nameStart - 2;

  if (operatorStart <= 0 || masked.slice(operatorStart, nameStart) !== "::") {
    return null;
  }

  const receiverStart = identifierStartAt(masked, operatorStart - 1);

  if (receiverStart === null) {
    return null;
  }

  const receiverClass = masked.slice(receiverStart, operatorStart);
  const previous = masked[receiverStart - 1] || "";

  if (previous === "$" || previous === "\\") {
    return null;
  }

  if (!/^[A-Za-z_]/.test(receiverClass)) {
    return null;
  }

  if (/^(?:self|static|parent)$/i.test(receiverClass)) {
    return null;
  }

  return { nameStart, receiver: "external", receiverClass };
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
  return receiver !== "this";
}

/**
 * Whether a method synthesized for this receiver must carry the `static`
 * modifier. `self::method()` / `static::method()` are always static. A
 * `parent::method()` invocation inherits static context from its containing
 * method.
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
  enclosingType: EnclosingTypeDeclaration,
  usageOffset: number,
): MissingThisMember | null {
  const parentClass = enclosingExtendsClause(masked, enclosingType);

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
    ...(isStaticInvocationContext(masked, enclosingType, usageOffset)
      ? { isStatic: true }
      : {}),
    kind: "method",
    name: usage.name,
    parentClass,
    target: "parent",
  };
}

function planSameFileExternalMember(
  source: string,
  masked: string,
  usage: MemberUsage,
  enclosingType: EnclosingTypeDeclaration,
  targetClass: string,
): PhpCreateFromUsagePlan | null {
  if (usage.kind === "property" || usage.name.toLowerCase() === "class") {
    return null;
  }

  const declared = sameFileTypeDeclaration(masked, targetClass, enclosingType);

  if (!declared) {
    return {
      member: toMissingExternalMember(source, masked, usage, targetClass),
      owner: declarationIdentity(enclosingType),
    };
  }

  if (declared.kind !== "class") {
    return null;
  }

  const sameFileExternal = declarationIdentity(declared);

  if (
    memberExists(source, usage.name, usage.kind, sameFileExternal.bodyStartOffset)
  ) {
    return null;
  }

  const owner = declarationIdentity(enclosingType);

  if (sameFileExternal.bodyStartOffset === owner.bodyStartOffset) {
    return { member: toMissingMember(source, masked, usage, "self"), owner };
  }

  return {
    member: toMissingExternalMember(source, masked, usage, targetClass),
    owner,
    sameFileExternal,
  };
}

function toMissingExternalMember(
  source: string,
  masked: string,
  usage: MemberUsage,
  targetClass: string,
): MissingThisMember {
  if (usage.kind === "constant") {
    return {
      kind: "constant",
      name: usage.name,
      target: "external",
      targetClass,
    };
  }

  return {
    argTypes: inferArgumentTypes(source, masked, usage),
    isStatic: true,
    kind: "method",
    name: usage.name,
    target: "external",
    targetClass,
  };
}

interface ExecutableScope {
  end: number;
  isStatic: boolean;
  start: number;
}

function isStaticInvocationContext(
  masked: string,
  declaration: EnclosingTypeDeclaration,
  offset: number,
): boolean {
  const scopes = [
    ...functionExecutableScopes(masked, declaration),
    ...arrowExecutableScopes(masked, declaration),
  ].filter((scope) => offset > scope.start && offset < scope.end);

  return scopes.some((scope) => scope.isStatic);
}

function functionExecutableScopes(
  masked: string,
  declaration: EnclosingTypeDeclaration,
): ExecutableScope[] {
  const pattern = /\b(?:(static)\s+)?function\b[^\S\r\n]*&?[^\S\r\n]*(?:[A-Za-z_][A-Za-z0-9_]*\s*)?\(/g;
  const scopes: ExecutableScope[] = [];
  pattern.lastIndex = declaration.bodyStart + 1;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < declaration.bodyEnd;
    match = pattern.exec(masked)
  ) {
    const start = match.index ?? 0;
    const openParen = masked.indexOf("(", start + match[0].length - 1);
    const closeParen = matchingPairOffset(masked, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const bodyStart = executableBodyStart(masked, closeParen + 1);

    if (bodyStart === null || bodyStart >= declaration.bodyEnd) {
      continue;
    }

    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    scopes.push({ end: bodyEnd, isStatic: Boolean(match[1]), start });
  }

  return scopes;
}

function executableBodyStart(masked: string, start: number): number | null {
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "{") {
      return index;
    }

    if (character === ";") {
      return null;
    }
  }

  return null;
}

function arrowExecutableScopes(
  masked: string,
  declaration: EnclosingTypeDeclaration,
): ExecutableScope[] {
  const pattern = /\b(?:(static)\s+)?fn\s*\(/g;
  const scopes: ExecutableScope[] = [];
  pattern.lastIndex = declaration.bodyStart + 1;

  for (
    let match = pattern.exec(masked);
    match && (match.index ?? 0) < declaration.bodyEnd;
    match = pattern.exec(masked)
  ) {
    const start = match.index ?? 0;
    const openParen = masked.indexOf("(", start);
    const closeParen = matchingPairOffset(masked, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const arrow = masked.indexOf("=>", closeParen + 1);

    if (arrow < 0 || arrow >= declaration.bodyEnd) {
      continue;
    }

    scopes.push({
      end: arrowExpressionEnd(masked, arrow + 2),
      isStatic: Boolean(match[1]),
      start,
    });
  }

  return scopes;
}

function arrowExpressionEnd(masked: string, start: number): number {
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

    if (depth === 0 && (character === "," || character === ";")) {
      return index;
    }
  }

  return masked.length;
}

/**
 * Find the parent reference only in the declaration containing the usage. This
 * must not fall back to an earlier class in a multi-class file.
 */
function enclosingExtendsClause(
  masked: string,
  declaration: EnclosingTypeDeclaration,
): string | null {
  if (declaration.kind !== "class") {
    return null;
  }

  const header = masked.slice(declaration.headerStart, declaration.bodyStart);
  const match = /\bextends\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)/.exec(header);

  return match?.[1] ?? null;
}

function enclosingTypeDeclaration(
  masked: string,
  offset: number,
): EnclosingTypeDeclaration | null {
  const declarations = namedTypeDeclarations(masked);
  let enclosing: EnclosingTypeDeclaration | null = null;

  for (const declaration of declarations) {
    if (
      offset <= declaration.bodyStart ||
      offset >= declaration.bodyEnd ||
      (enclosing && declaration.bodyStart <= enclosing.bodyStart)
    ) {
      continue;
    }

    enclosing = declaration;
  }

  return enclosing;
}

function namedTypeDeclarations(masked: string): EnclosingTypeDeclaration[] {
  const pattern =
    /(?<![:\\$>A-Za-z0-9_])(?:(?:abstract|final|readonly)\s+)*(class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  const declarations: EnclosingTypeDeclaration[] = [];

  for (const match of masked.matchAll(pattern)) {
    const headerStart = match.index ?? 0;
    const kind = match[1];
    const name = match[2];

    if (!isTypeDeclarationKind(kind) || !name) {
      continue;
    }

    const bodyStart = masked.indexOf("{", headerStart + match[0].length);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    declarations.push({
      bodyEnd,
      bodyStart,
      headerStart,
      isReadonly: kind === "class" && /\breadonly\b/.test(match[0]),
      kind,
      name,
      namespace: namespaceAtOffset(masked, headerStart),
    });
  }

  return declarations;
}

function declarationIdentity(
  declaration: EnclosingTypeDeclaration,
): PhpCreateDeclarationIdentity {
  return {
    bodyEndOffset: declaration.bodyEnd,
    bodyStartOffset: declaration.bodyStart,
    kind: declaration.isReadonly ? "readonly-class" : declaration.kind,
    name: declaration.name,
    namespace: declaration.namespace,
  };
}

function sameFileClassDeclaration(
  masked: string,
  reference: string,
  owner: EnclosingTypeDeclaration,
): PhpCreateDeclarationIdentity | null {
  const declared = sameFileTypeDeclaration(masked, reference, owner);

  if (!declared || declared.kind !== "class") {
    return null;
  }

  return declarationIdentity(declared);
}

function sameFileTypeDeclaration(
  masked: string,
  reference: string,
  owner: EnclosingTypeDeclaration,
): EnclosingTypeDeclaration | null {
  const expectedFqn = resolveDeclarationReference(
    masked,
    reference,
    owner,
  ).toLowerCase();

  return (
    namedTypeDeclarations(masked).find(
      (declaration) => declarationFqn(declaration).toLowerCase() === expectedFqn,
    ) ?? null
  );
}

function resolveDeclarationReference(
  masked: string,
  reference: string,
  owner: EnclosingTypeDeclaration,
): string {
  if (reference.startsWith("\\")) {
    return reference.slice(1);
  }

  if (/^namespace\\/i.test(reference)) {
    const relative = reference.replace(/^namespace\\/i, "");

    return owner.namespace ? `${owner.namespace}\\${relative}` : relative;
  }

  const segments = reference.split("\\");
  const firstSegment = segments[0] ?? reference;
  const imported = importedClassReference(masked, firstSegment, owner);

  if (imported) {
    const suffix = segments.slice(1).join("\\");

    return suffix ? `${imported}\\${suffix}` : imported;
  }

  return owner.namespace ? `${owner.namespace}\\${reference}` : reference;
}

function importedClassReference(
  masked: string,
  shortName: string,
  owner: EnclosingTypeDeclaration,
): string | null {
  const pattern = /\buse\s+([^;]+);/gi;
  const ownerDepth = braceDepthAt(masked, owner.headerStart);

  for (const match of masked.matchAll(pattern)) {
    const offset = match.index ?? 0;

    if (
      offset >= owner.headerStart ||
      braceDepthAt(masked, offset) !== ownerDepth ||
      namespaceAtOffset(masked, offset) !== owner.namespace
    ) {
      continue;
    }

    const body = match[1]?.trim() ?? "";

    if (/^(?:function|const)\b/i.test(body)) {
      continue;
    }

    const imported = parsePhpClassUseBody(body).find(
      (symbol) => symbol.alias.toLowerCase() === shortName.toLowerCase(),
    );

    if (imported) {
      return imported.fqn;
    }
  }

  return null;
}

function braceDepthAt(masked: string, offset: number): number {
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    if (masked[index] === "{") {
      depth += 1;
      continue;
    }

    if (masked[index] === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

function declarationFqn(declaration: EnclosingTypeDeclaration): string {
  return declaration.namespace
    ? `${declaration.namespace}\\${declaration.name}`
    : declaration.name;
}

function namespaceAtOffset(masked: string, offset: number): string | null {
  const pattern = /\bnamespace\s+([^;{]+?)\s*([;{])/g;
  let active: string | null = null;

  for (const match of masked.matchAll(pattern)) {
    const namespaceStart = match.index ?? 0;

    if (namespaceStart >= offset) {
      break;
    }

    const name = match[1]?.trim().replace(/^\\+/, "") || null;

    if (match[2] === ";") {
      active = name;
      continue;
    }

    const bodyStart = namespaceStart + match[0].length - 1;
    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd !== null && offset > bodyStart && offset < bodyEnd) {
      return name;
    }

    active = null;
  }

  return active;
}

function isInsideAnonymousClass(masked: string, offset: number): boolean {
  const pattern = /\bnew\s+class\b/g;

  for (const match of masked.matchAll(pattern)) {
    const start = match.index ?? 0;

    if (start >= offset) {
      break;
    }

    const bodyStart = anonymousClassBodyStart(
      masked,
      start + match[0].length,
    );

    if (bodyStart === null || bodyStart >= offset) {
      continue;
    }

    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd !== null && offset < bodyEnd) {
      return true;
    }
  }

  return false;
}

function anonymousClassBodyStart(masked: string, afterClass: number): number | null {
  let index = skipWhitespace(masked, afterClass);

  if (masked[index] === "(") {
    const argumentsEnd = matchingPairOffset(masked, index, "(", ")");

    if (argumentsEnd === null) {
      return null;
    }

    index = argumentsEnd + 1;
  }

  for (; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "{") {
      return index;
    }

    if (character !== "(" && character !== "[") {
      continue;
    }

    const close = character === "(" ? ")" : "]";
    const nestedEnd = matchingPairOffset(masked, index, character, close);

    if (nestedEnd === null) {
      return null;
    }

    index = nestedEnd;
  }

  return null;
}

function isTypeDeclarationKind(
  kind: string | undefined,
): kind is EnclosingTypeDeclaration["kind"] {
  return (
    kind === "class" ||
    kind === "interface" ||
    kind === "trait" ||
    kind === "enum"
  );
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

export function inferArgumentTypes(
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
export function splitArguments(
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
      pushArgument(args, source.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }

  pushArgument(args, source.slice(segmentStart, end));

  return args;
}

function pushArgument(args: string[], segment: string): void {
  const argument = segment.trim();

  if (!argument) {
    return;
  }

  args.push(argument);
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
  bodyStartOffset: number,
): boolean {
  return phpClassDeclaresMember(source, name, kind, { bodyStartOffset });
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
  target?: string | { bodyStartOffset: number },
): boolean {
  if (typeof target === "object") {
    const declarationSource = typeDeclarationSourceAtBody(
      source,
      target.bodyStartOffset,
    );

    if (!declarationSource) {
      return false;
    }

    return phpClassDeclaresMember(declarationSource, name, kind);
  }

  if (kind === "constant") {
    return constantExists(source, name, target);
  }

  const structure = parsePhpClassStructure(source, target);

  if (kind === "method") {
    return structure.methods.some((method) => method.name === name);
  }

  if (structure.properties.some((property) => property.name === name)) {
    return true;
  }

  return promotedConstructorPropertyExists(source, name, target);
}

function typeDeclarationSourceAtBody(
  source: string,
  expectedBodyStart: number,
): string | null {
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?<![:\\$>A-Za-z0-9_])(?:(?:abstract|final|readonly)\s+)*(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/g;

  for (const match of masked.matchAll(pattern)) {
    const bodyStart = masked.indexOf(
      "{",
      (match.index ?? 0) + match[0].length,
    );

    if (bodyStart !== expectedBodyStart) {
      continue;
    }

    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd === null) {
      return null;
    }

    return source.slice(match.index ?? 0, bodyEnd + 1);
  }

  return null;
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

export function readIdentifier(masked: string, start: number): string | null {
  const match = IDENTIFIER.exec(masked.slice(start));

  if (!match || match.index !== 0) {
    return null;
  }

  return match[0];
}

export function skipWhitespace(masked: string, start: number): number {
  let index = start;

  while (index < masked.length && /\s/.test(masked[index] || "")) {
    index += 1;
  }

  return index;
}

function isIdentifierChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
}

export function matchingPairOffset(
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

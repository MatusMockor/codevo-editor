import type { Psr4Root } from "./workspace";
import { renderConstructor } from "./phpConstructorCodeGen";
import type { PhpPropertyMember } from "./phpClassStructure";
import {
  inferArgumentTypes,
  matchingPairOffset as matchingPhpPairOffset,
  readIdentifier as readPhpIdentifier,
  renderCreateMethodStub,
  skipWhitespace as skipPhpWhitespace,
  splitArguments as splitPhpArguments,
} from "./phpCreateFromUsage";
import { maskPhpSource } from "./phpSourceMask";

/**
 * Pure detection + PSR-4 destination + skeleton synthesis for the PhpStorm
 * "Create class X" quick fix on PHP source.
 *
 * Given an offset that sits on a class-type REFERENCE (`new X()`, `X::method()`,
 * `X::CONST`, a type hint / return type, `extends X`, `implements X`,
 * `catch (X $e)`) this derives the raw reference token under the cursor and the
 * KIND of the type to create (an `implements` target reads as an interface, a
 * `new`/`extends`/type-hint target reads as a class). The controller resolves
 * that token to an FQN (use-import / current namespace) and confirms it does not
 * already exist before offering the action.
 *
 * Design constraints (deliberately CONSERVATIVE - returns `null` rather than
 * risk offering a bogus or misplaced file):
 *  - Pure functions only - no filesystem, no I/O, no editor coupling.
 *  - Strings and comments are masked to spaces before any structural reasoning
 *    so a class-looking token inside a string literal or comment is never
 *    mistaken for a real reference (mirrors `phpClassStructure.ts`).
 *  - The destination mapper returns `null` whenever no project PSR-4 root covers
 *    the FQN (uncertain destination -> the caller offers nothing), and refuses
 *    any FQN under an excluded prefix (e.g. a vendor namespace) so the action is
 *    never offered where it would write outside the app's own source roots.
 *  - The skeleton is a minimal, `php -l`-valid declaration with the namespace
 *    derived from the FQN.
 */

export type PhpCreatableKind = "class" | "interface" | "trait" | "enum";

export interface PhpUnknownClassReference {
  /**
   * The type kind inferred from the surrounding context: an `implements` target
   * is an interface, everything else defaults to a class. (`extends` could be a
   * class or an interface, but a class is the safe, dominant default.)
   */
  kind: PhpCreatableKind;
  /**
   * The raw reference token exactly as written in the source (e.g. `Foo`,
   * `Sub\Foo`, `\App\Foo`). The caller resolves this to an FQN.
   */
  reference: string;
}

export interface PhpCreateClassDestination {
  /**
   * Namespace for the new file, or `null` for a global (root-namespace) type.
   */
  namespace: string | null;
  /**
   * Absolute path of the file to create.
   */
  path: string;
}

export interface PhpTypeUsageContext {
  offset: number;
  source: string;
}

interface PhpCreateClassMethod {
  argTypes: (string | null)[];
  isStatic: boolean;
  name: string;
}

interface PhpCreateClassMembers {
  constructorProperties: PhpPropertyMember[];
  methods: PhpCreateClassMethod[];
}

interface ArgumentList {
  end: number;
  start: number;
}

interface UsageScope {
  end: number;
  start: number;
}

interface ReceiverWindow extends UsageScope {
  receiver: string;
}

const NEW_LINE = "\n";

/**
 * Detects the class-type reference under `offset` when it is one of the
 * supported "create from usage" contexts. Returns the raw reference token and
 * the kind to create, or `null` when the offset is not on such a reference
 * (e.g. a method call, a property access, a token inside a string/comment, or a
 * declaration name). The masked source guarantees string/comment immunity.
 */
export function detectUnknownClassReference(
  source: string,
  offset: number,
): PhpUnknownClassReference | null {
  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpStringsAndComments(source);
  const token = referenceTokenAt(source, masked, offset);

  if (!token) {
    return null;
  }

  if (isReservedTypeName(token.text)) {
    return null;
  }

  const kind = classifyReferenceKind(masked, token);

  if (!kind) {
    return null;
  }

  return { kind, reference: token.text };
}

/**
 * PHP reserved type keywords and scalar pseudo-types that can never be a
 * user-created type (`self` / `static` / `parent` resolve to the enclosing
 * class; `int` / `string` / ... are built-ins). A global (un-namespaced) token
 * matching one of these is never a "create class" candidate.
 */
const RESERVED_TYPE_NAMES = new Set([
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
  "parent",
  "self",
  "static",
  "string",
  "true",
  "void",
]);

function isReservedTypeName(reference: string): boolean {
  const normalized = reference.trim().replace(/^\\+/, "");

  if (normalized.includes("\\")) {
    return false;
  }

  return RESERVED_TYPE_NAMES.has(normalized.toLowerCase());
}

/**
 * Maps a fully-qualified class name to the file path + namespace it should be
 * created at, using the project's PSR-4 roots. The most specific (longest)
 * matching namespace wins, mirroring composer's resolution. Returns `null` when
 * no root covers the FQN (uncertain destination) or when the FQN falls under one
 * of `excludedPrefixes` (e.g. a vendor namespace the action must never write
 * into) so the caller offers nothing.
 */
export function phpCreateClassDestination(
  rootPath: string,
  psr4Roots: readonly Psr4Root[],
  excludedPrefixes: readonly string[],
  fqn: string,
): PhpCreateClassDestination | null {
  const normalizedFqn = fqn.trim().replace(/^\\+/, "");

  if (!normalizedFqn) {
    return null;
  }

  if (isUnderExcludedPrefix(normalizedFqn, excludedPrefixes)) {
    return null;
  }

  const match = bestPsr4Match(psr4Roots, normalizedFqn);

  if (!match) {
    return null;
  }

  const relativeClassName = normalizedFqn.slice(match.namespace.length);
  const relativePath = `${trimSlashes(match.directory)}/${relativeClassName
    .split("\\")
    .join("/")}.php`;

  return {
    namespace: namespaceOf(normalizedFqn),
    path: joinPath(rootPath, relativePath),
  };
}

/**
 * Renders the minimal, `php -l`-valid file content for a new type. The body is
 * empty; the namespace line is omitted for a global type.
 */
export function renderPhpTypeSkeleton(
  kind: PhpCreatableKind,
  shortName: string,
  namespace: string | null,
  usage?: PhpTypeUsageContext,
): string {
  const header = namespace
    ? `<?php${NEW_LINE}${NEW_LINE}namespace ${namespace};${NEW_LINE}${NEW_LINE}`
    : `<?php${NEW_LINE}${NEW_LINE}`;
  const members = usage ? inferCreateClassMembers(usage) : null;

  if (kind !== "class" || !members || !hasCreateClassMembers(members)) {
    return `${header}${kind} ${shortName}${NEW_LINE}{${NEW_LINE}}${NEW_LINE}`;
  }

  const body = renderCreateClassMembers(members);

  return `${header}${kind} ${shortName}${NEW_LINE}{${NEW_LINE}${body}${NEW_LINE}}${NEW_LINE}`;
}

function inferCreateClassMembers(
  usageContext: PhpTypeUsageContext,
): PhpCreateClassMembers | null {
  const { offset, source } = usageContext;

  if (!isOffsetInRange(source, offset)) {
    return null;
  }

  const masked = maskPhpSource(source);
  const token = referenceTokenAt(source, masked, offset);

  if (!token) {
    return null;
  }

  const scope = usageScope(masked, token.start);
  const knownTypes = knownVariableTypes(source, masked, scope, token.start);
  const constructorArguments = newExpressionArguments(masked, token);
  const constructorProperties = constructorArguments
    ? constructorPropertiesFromArguments(
        source,
        masked,
        constructorArguments,
        knownTypes,
      )
    : [];
  const receiverWindows = assignedReceiverWindows(masked, token, scope);
  const instanceMethods = receiverWindows.flatMap((window) =>
    observedInstanceMethods(source, masked, window, knownTypes),
  );
  const staticMethod = staticMethodFromUsage(
    source,
    masked,
    token,
    knownTypes,
  );
  const methods = staticMethod
    ? deduplicateMethods([staticMethod, ...instanceMethods])
    : deduplicateMethods(instanceMethods);

  return { constructorProperties, methods };
}

function hasCreateClassMembers(members: PhpCreateClassMembers): boolean {
  return members.constructorProperties.length > 0 || members.methods.length > 0;
}

function renderCreateClassMembers(members: PhpCreateClassMembers): string {
  const blocks: string[] = [];

  if (members.constructorProperties.length > 0) {
    blocks.push(
      renderConstructor(members.constructorProperties, {
        indent: "    ",
        mode: "promoted",
      }),
    );
  }

  for (const method of members.methods) {
    const stub = renderCreateMethodStub(method.name, method.argTypes, {
      isStatic: method.isStatic,
      target: { kind: "class", relationship: "external" },
    });

    if (stub) {
      blocks.push(stub);
    }
  }

  return blocks.join(`${NEW_LINE}${NEW_LINE}`);
}

function newExpressionArguments(
  masked: string,
  token: ReferenceToken,
): ArgumentList | null {
  if (keywordBefore(masked, token.start) !== "new") {
    return null;
  }

  return argumentListAfter(masked, token.end);
}

function staticMethodFromUsage(
  source: string,
  masked: string,
  token: ReferenceToken,
  knownTypes: ReadonlyMap<string, string>,
): PhpCreateClassMethod | null {
  let cursor = skipPhpWhitespace(masked, token.end);

  if (masked.slice(cursor, cursor + 2) !== "::") {
    return null;
  }

  cursor = skipPhpWhitespace(masked, cursor + 2);
  const name = readPhpIdentifier(masked, cursor);

  if (!name) {
    return null;
  }

  const args = argumentListAfter(masked, cursor + name.length);

  if (!args) {
    return null;
  }

  return {
    argTypes: argumentTypes(source, masked, args, knownTypes),
    isStatic: true,
    name,
  };
}

function constructorPropertiesFromArguments(
  source: string,
  masked: string,
  args: ArgumentList,
  knownTypes: ReadonlyMap<string, string>,
): PhpPropertyMember[] {
  const expressions = splitPhpArguments(source, masked, args.start, args.end);
  const types = argumentTypes(source, masked, args, knownTypes);

  return expressions.map((expression, index) => ({
    defaultValue: null,
    isReadonly: false,
    isStatic: false,
    name: variableName(expression) ?? `arg${index}`,
    phpDoc: null,
    type: types[index] ?? null,
    visibility: "private",
  }));
}

function observedInstanceMethods(
  source: string,
  masked: string,
  window: ReceiverWindow,
  knownTypes: ReadonlyMap<string, string>,
): PhpCreateClassMethod[] {
  const methods: PhpCreateClassMethod[] = [];
  const pattern = new RegExp(`\\$${window.receiver}\\s*->\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`, "g");
  pattern.lastIndex = window.start;

  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    if (match.index >= window.end) {
      break;
    }

    const openParen = pattern.lastIndex - 1;
    const end = matchingPhpPairOffset(masked, openParen, "(", ")");

    if (end === null || end > window.end) {
      continue;
    }

    methods.push({
      argTypes: argumentTypes(
        source,
        masked,
        { end, start: openParen + 1 },
        knownTypes,
      ),
      isStatic: false,
      name: match[1] ?? "",
    });
  }

  return methods.filter((method) => method.name.length > 0);
}

function deduplicateMethods(
  methods: PhpCreateClassMethod[],
): PhpCreateClassMethod[] {
  const names = new Set<string>();

  return methods.filter((method) => {
    const name = method.name.toLowerCase();

    if (names.has(name)) {
      return false;
    }

    names.add(name);
    return true;
  });
}

function argumentTypes(
  source: string,
  masked: string,
  args: ArgumentList,
  knownTypes: ReadonlyMap<string, string>,
): (string | null)[] {
  const inferred = inferArgumentTypes(source, masked, {
    argsEnd: args.end,
    argsStart: args.start,
    kind: "method",
    name: "usage",
  });
  const expressions = splitPhpArguments(source, masked, args.start, args.end);

  return inferred.map((type, index) => {
    if (type) {
      return type;
    }

    const name = variableName(expressions[index] ?? "");
    return name ? knownTypes.get(name) ?? null : null;
  });
}

function variableName(expression: string): string | null {
  return /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression.trim())?.[1] ?? null;
}

function assignedReceiverWindows(
  masked: string,
  token: ReferenceToken,
  scope: UsageScope,
): ReceiverWindow[] {
  if (keywordBefore(masked, token.start) !== "new") {
    return [];
  }

  const className = escapeRegExp(token.text);
  const pattern = new RegExp(
    `\\$([A-Za-z_][A-Za-z0-9_]*)\\s*=\\s*new\\s+${className}\\s*\\(`,
    "g",
  );
  const windows: ReceiverWindow[] = [];
  pattern.lastIndex = scope.start;

  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    if (match.index >= scope.end) {
      break;
    }

    const receiver = match[1];
    const openParen = pattern.lastIndex - 1;
    const closeParen = matchingPhpPairOffset(masked, openParen, "(", ")");

    if (!receiver || closeParen === null || closeParen >= scope.end) {
      continue;
    }

    windows.push({
      end: nextReceiverAssignment(masked, receiver, closeParen + 1, scope.end),
      receiver,
      start: closeParen + 1,
    });
  }

  return windows;
}

function nextReceiverAssignment(
  masked: string,
  receiver: string,
  start: number,
  scopeEnd: number,
): number {
  const assignment = new RegExp(
    `\\$${receiver}\\s*(?:\\?\\?|<<|>>|[+\\-*\\/.%&|^])?=(?![=>])`,
    "g",
  );
  assignment.lastIndex = start;
  const match = assignment.exec(masked);

  if (!match || match.index >= scopeEnd) {
    return scopeEnd;
  }

  return match.index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function knownVariableTypes(
  source: string,
  masked: string,
  scope: UsageScope,
  usageOffset: number,
): ReadonlyMap<string, string> {
  const types = new Map<string, string>();
  const pattern = /(?:^|[(,])\s*(\??[A-Za-z_\\][A-Za-z0-9_\\|&?]*)\s+\$([A-Za-z_][A-Za-z0-9_]*)/g;
  const scopedMasked = masked.slice(scope.start, usageOffset);

  for (let match = pattern.exec(scopedMasked); match; match = pattern.exec(scopedMasked)) {
    const typeStart = scope.start + match.index + (match[0]?.indexOf(match[1] ?? "") ?? 0);
    const type = source.slice(typeStart, typeStart + (match[1]?.length ?? 0));
    const name = match[2];

    if (name && type) {
      types.set(name, type);
    }
  }

  return types;
}

function usageScope(masked: string, offset: number): UsageScope {
  let best: UsageScope = { end: masked.length, start: 0 };
  const pattern = /\bfunction\b[^;{]*\{/g;

  for (let match = pattern.exec(masked); match; match = pattern.exec(masked)) {
    const openBrace = pattern.lastIndex - 1;
    const end = matchingPhpPairOffset(masked, openBrace, "{", "}");

    if (end === null || offset < match.index || offset > end) {
      continue;
    }

    if (end - match.index < best.end - best.start) {
      best = { end, start: match.index };
    }
  }

  return best;
}

function argumentListAfter(masked: string, offset: number): ArgumentList | null {
  const openParen = skipPhpWhitespace(masked, offset);

  if (masked[openParen] !== "(") {
    return null;
  }

  const end = matchingPhpPairOffset(masked, openParen, "(", ")");
  return end === null ? null : { end, start: openParen + 1 };
}

interface ReferenceToken {
  end: number;
  start: number;
  text: string;
}

function isOffsetInRange(source: string, offset: number): boolean {
  return Number.isInteger(offset) && offset >= 0 && offset <= source.length;
}

/**
 * Returns the namespace-qualified type token (e.g. `Foo`, `Sub\Foo`,
 * `\App\Foo`) whose span contains `offset`, read from the ORIGINAL source (so
 * the returned text is verbatim) but VALIDATED against the masked source so a
 * token inside a string / comment yields `null`.
 */
function referenceTokenAt(
  source: string,
  masked: string,
  offset: number,
): ReferenceToken | null {
  const pattern = /\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*/g;

  for (let match = pattern.exec(source); match; match = pattern.exec(source)) {
    const start = match.index;
    const end = start + match[0].length;

    if (offset < start || offset > end) {
      continue;
    }

    // The token must be live code, not a masked string / comment span.
    if (masked.slice(start, end) !== match[0]) {
      return null;
    }

    return { end, start, text: match[0] };
  }

  return null;
}

/**
 * Decides the kind of type to create from the keyword immediately preceding the
 * reference, and rejects references that are NOT a class-type usage (a method
 * call `->name(`, a property access `->name`, a declaration name, a namespace /
 * use statement, or a `::`-suffixed token that is a member rather than the
 * receiver class).
 */
function classifyReferenceKind(
  masked: string,
  token: ReferenceToken,
): PhpCreatableKind | null {
  if (isMemberSuffix(masked, token)) {
    return null;
  }

  const precedingKeyword = keywordBefore(masked, token.start);

  if (precedingKeyword === "implements") {
    return "interface";
  }

  if (isClassUsageKeyword(precedingKeyword)) {
    return "class";
  }

  if (isStaticReceiver(masked, token)) {
    return "class";
  }

  if (isTypePositionReference(masked, token)) {
    return "class";
  }

  return null;
}

/**
 * A token that is preceded by `->`, `::`, `$`, `function ` or `->` is a member /
 * variable / function name rather than a class reference. `::`-PREFIXED is the
 * member side of a static access (`Foo::BAR` -> `BAR`), which must not be
 * treated as a class.
 */
function isMemberSuffix(masked: string, token: ReferenceToken): boolean {
  const before = nonSpaceBefore(masked, token.start);

  if (before.text === "->" || before.text === "::") {
    return true;
  }

  if (before.text === "$") {
    return true;
  }

  return precededByKeyword(masked, token.start, "function");
}

/**
 * `Foo::` (the receiver of a static access) is a class usage. Confirmed by a
 * `::` immediately AFTER the token (skipping whitespace) and NOT a `::`
 * immediately before it (which would make this the member, handled earlier).
 */
function isStaticReceiver(masked: string, token: ReferenceToken): boolean {
  const after = nonSpaceAfter(masked, token.end);

  return after === "::";
}

/**
 * A bare type position: a type hint (`Foo $x`), a return type (`: Foo`), or a
 * `new Foo`, `extends Foo`, `catch (Foo`. The keyword/`:`/`(` lead-ins are
 * matched by `keywordBefore` / the punctuation before the token; for a type
 * hint the token is followed by a `$variable`.
 */
function isTypePositionReference(
  masked: string,
  token: ReferenceToken,
): boolean {
  const keyword = keywordBefore(masked, token.start);

  if (keyword === "new" || keyword === "extends" || keyword === "catch") {
    return true;
  }

  const before = nonSpaceBefore(masked, token.start);

  // Return type `: Foo`, union/intersection member `Foo|Bar` / `Foo&Bar`, a
  // nullable `?Foo`, a catch list `catch (A | Foo`, or the first param after
  // `(`.
  if (
    before.text === ":" ||
    before.text === "?" ||
    before.text === "|" ||
    before.text === "&" ||
    before.text === "(" ||
    before.text === ","
  ) {
    return isTypeContext(masked, token, before);
  }

  return false;
}

/**
 * Disambiguates a `(` / `,` / `:` / `?` / `|` / `&` lead-in that could be a TYPE
 * position from one that is not. A type hint is `Foo $var` (token followed by a
 * `$variable`); a return type is `): Foo` (the `:` follows a `)`); a nullable /
 * union chain (`?Foo`, `A|Foo`, `A&Foo`) is anchored back to one of those true
 * type slots. A ternary `cond ? Foo : bar` is excluded because the `?` does not
 * anchor to a type slot (it follows a value, not a `(` / `,` / return-type `:`).
 */
function isTypeContext(
  masked: string,
  token: ReferenceToken,
  before: NonSpaceToken,
): boolean {
  if (before.text === ":") {
    return isReturnTypeColon(masked, before.offset);
  }

  // `(` / `,` -> a parameter type hint, confirmed by a trailing `$variable`
  // (optionally variadic / by-ref) after the token.
  if (before.text === "(" || before.text === ",") {
    return followedByVariable(masked, token.end);
  }

  // `?` (nullable) / `|` (union) / `&` (intersection) only open / continue a
  // type when the chain they belong to anchors back to a real type slot. This
  // rejects the ternary `cond ? Foo : bar` (the `?` follows a value) and the
  // bitwise `$a | Foo` (the `|` follows a `$variable`).
  return anchorsToTypeSlot(masked, before.offset);
}

/**
 * Whether a `:` at `colonOffset` is a RETURN-TYPE colon (`): Foo`) rather than a
 * label / ternary colon: it must directly follow the parameter list's `)`.
 */
function isReturnTypeColon(masked: string, colonOffset: number): boolean {
  return nonSpaceBefore(masked, colonOffset).text === ")";
}

/**
 * Walks backward from a `?` / `|` / `&` over a contiguous type chain (more
 * `?`/`|`/`&` and type-name segments) to the anchoring punctuation and reports
 * whether that anchor is a true type slot: a `(` / `,` (parameter list) or a
 * return-type `:`. Anything else (a `$variable`, a `)` / `]` value, a literal)
 * means the `?`/`|`/`&` was an expression operator, not a type marker.
 */
function anchorsToTypeSlot(masked: string, operatorOffset: number): boolean {
  let cursor = nonSpaceBefore(masked, operatorOffset);

  for (let guard = 0; guard < 64; guard += 1) {
    if (cursor.text === "(" || cursor.text === ",") {
      return true;
    }

    if (cursor.text === ":") {
      return isReturnTypeColon(masked, cursor.offset);
    }

    if (cursor.text === "?" || cursor.text === "|" || cursor.text === "&") {
      cursor = nonSpaceBefore(masked, cursor.offset);
      continue;
    }

    // A type-name segment continues the chain; step over the whole identifier
    // (including namespace separators) and keep walking left.
    if (isIdentifierChar(cursor.text) || cursor.text === "\\") {
      cursor = nonSpaceBefore(masked, identifierChainStart(masked, cursor.offset));
      continue;
    }

    return false;
  }

  return false;
}

/**
 * Given an offset on the LAST character of a namespace-qualified identifier
 * (`...Foo`), returns the offset of its first character so the caller can read
 * what precedes the whole chain.
 */
function identifierChainStart(masked: string, end: number): number {
  let start = end;

  while (
    start > 0 &&
    (isIdentifierChar(masked[start - 1] ?? "") || masked[start - 1] === "\\")
  ) {
    start -= 1;
  }

  return start;
}

function followedByVariable(masked: string, end: number): boolean {
  let index = end;

  while (index < masked.length && isSpace(masked[index] ?? "")) {
    index += 1;
  }

  // Tolerate variadic `...` and by-ref `&` before the `$`.
  while (
    index < masked.length &&
    (masked[index] === "." || masked[index] === "&")
  ) {
    index += 1;
  }

  while (index < masked.length && isSpace(masked[index] ?? "")) {
    index += 1;
  }

  return masked[index] === "$";
}

function isClassUsageKeyword(keyword: string | null): boolean {
  return (
    keyword === "new" || keyword === "extends" || keyword === "instanceof"
  );
}

/**
 * Returns the lowercase keyword immediately preceding the token (skipping
 * whitespace), or `null` when the preceding word is not a recognised lead-in.
 */
function keywordBefore(masked: string, start: number): string | null {
  let index = start;

  while (index > 0 && isSpace(masked[index - 1] ?? "")) {
    index -= 1;
  }

  let wordEnd = index;
  let wordStart = index;

  while (wordStart > 0 && isIdentifierChar(masked[wordStart - 1] ?? "")) {
    wordStart -= 1;
  }

  if (wordStart === wordEnd) {
    return null;
  }

  return masked.slice(wordStart, wordEnd).toLowerCase();
}

function precededByKeyword(
  masked: string,
  start: number,
  keyword: string,
): boolean {
  return keywordBefore(masked, start) === keyword;
}

interface NonSpaceToken {
  offset: number;
  text: string;
}

/**
 * Reads the one- or two-character operator immediately before `start` (skipping
 * whitespace): `->`, `::`, or a single punctuation / identifier-ending char.
 */
function nonSpaceBefore(masked: string, start: number): NonSpaceToken {
  let index = start - 1;

  while (index >= 0 && isSpace(masked[index] ?? "")) {
    index -= 1;
  }

  if (index < 0) {
    return { offset: -1, text: "" };
  }

  const current = masked[index] ?? "";
  const previous = masked[index - 1] ?? "";

  if (current === ">" && previous === "-") {
    return { offset: index - 1, text: "->" };
  }

  if (current === ":" && previous === ":") {
    return { offset: index - 1, text: "::" };
  }

  return { offset: index, text: current };
}

function nonSpaceAfter(masked: string, end: number): string {
  let index = end;

  while (index < masked.length && isSpace(masked[index] ?? "")) {
    index += 1;
  }

  const current = masked[index] ?? "";
  const next = masked[index + 1] ?? "";

  if (current === ":" && next === ":") {
    return "::";
  }

  if (current === "-" && next === ">") {
    return "->";
  }

  return current;
}

function isUnderExcludedPrefix(
  fqn: string,
  excludedPrefixes: readonly string[],
): boolean {
  const lower = fqn.toLowerCase();

  return excludedPrefixes.some((prefix) => {
    const normalized = prefix.trim().replace(/^\\+/, "").toLowerCase();

    return normalized.length > 0 && lower.startsWith(normalized);
  });
}

interface Psr4Match {
  directory: string;
  namespace: string;
}

/**
 * Finds the PSR-4 root whose namespace prefixes the FQN with the LONGEST match
 * (composer's most-specific-wins rule), preferring a non-dev root on ties. Only
 * the first declared `paths` entry is used as the create destination (composer
 * allows several; the first is the conventional primary).
 */
function bestPsr4Match(
  psr4Roots: readonly Psr4Root[],
  fqn: string,
): Psr4Match | null {
  let best: Psr4Match | null = null;
  let bestLength = -1;

  for (const root of psr4Roots) {
    const namespace = root.namespace;
    const directory = root.paths[0];

    if (!namespace || !directory) {
      continue;
    }

    if (!fqn.startsWith(namespace)) {
      continue;
    }

    if (namespace.length <= bestLength) {
      continue;
    }

    best = { directory, namespace };
    bestLength = namespace.length;
  }

  return best;
}

function namespaceOf(fqn: string): string | null {
  const lastSeparator = fqn.lastIndexOf("\\");

  if (lastSeparator < 0) {
    return null;
  }

  return fqn.slice(0, lastSeparator);
}

function joinPath(rootPath: string, relativePath: string): string {
  const base = rootPath.replace(/\/+$/, "");
  const relative = relativePath.replace(/^\/+/, "");

  return `${base}/${relative}`;
}

function trimSlashes(path: string): string {
  return path.trim().split("\\").join("/").replace(/^\/+|\/+$/g, "");
}

function isSpace(character: string): boolean {
  return /\s/.test(character);
}

function isIdentifierChar(character: string): boolean {
  return /[A-Za-z0-9_]/.test(character);
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

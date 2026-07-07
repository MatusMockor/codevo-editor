/**
 * Pure Nette COMPONENT + presenter-lifecycle primitives (spec §9 / Fáza 2a) - the
 * bridge between a Latte `{control name}` / `<form n:name="name">` / `$this['name']`
 * usage and the presenter/control factory method that backs it
 * (`createComponentName`), plus a structural classification of presenter
 * lifecycle methods for completion / navigation / outline integrations.
 *
 * Everything here is PURE: no filesystem, no async, no shared state. Each entry
 * point is a single bounded pass (or a fixed number of them) over its input
 * string. It stays CONSERVATIVE - any dynamic (`$var`), ambiguous, or otherwise
 * non-static shape resolves to `null` / `[]` rather than a guessed result.
 * Mapping a component name to a concrete factory file, or a return type to an
 * FQN via `use` statements, is the integration layer's job.
 *
 * MASKING is NOT re-implemented here. Latte-side detection reuses
 * `latteSyntax.ts`'s `innermostLatteExpressionSpanAt` (whose tag scanner already
 * skips `{* comment *}` and `{syntax off}` regions) for `{control}`, and
 * `collectLatteMaskedRegions` (the same single-pass, quote-aware scan) for
 * `n:name` / usage scanning - so a construct written inside a comment is never
 * matched, and this module cannot silently diverge from what `latteSyntax.ts`
 * treats as masked.
 *
 * HANG-SAFETY: every scan advances a strictly monotonic index and is bounded.
 * Backward scans stop at a fixed window / tag / line boundary; forward regexes
 * are linear with no nested quantifiers (no catastrophic backtracking); brace /
 * paren balancers are quote-aware single passes capped by the source length.
 * There is no `lastIndexOf` clamping and no match that can straddle the whole
 * document. A malformed or huge (100k+) document degrades to a linear pass,
 * never a hang.
 */

import {
  collectLatteMaskedRegions,
  innermostLatteExpressionSpanAt,
} from "./latteSyntax";
import type { LatteMaskedRegion } from "./latteSyntax";

const CREATE_COMPONENT_PREFIX = "createComponent";

/** Backward-scan bound for locating the HTML element bearing an `n:name`. */
const MAX_ELEMENT_SCAN = 2000;

/** Backward-scan bound for locating a docblock above a method signature. */
const MAX_DOCBLOCK_SCAN = 2000;

/**
 * A detected `{control name}` macro at a cursor. `name` is the BASE component
 * name (the segment before any `:part`); `part` is the render variant after a
 * `:` (`{control productList:pagination}` → `name` `productList`, `part`
 * `pagination`); `args` is the remaining argument text after the name / part.
 * `part` and `args` are omitted when absent. A dynamic `{control $x}` yields
 * `null`.
 */
export interface LatteControlDetection {
  args?: string;
  name: string;
  nameEnd: number;
  nameStart: number;
  part?: string;
}

/**
 * A detected `n:name="..."` attribute value at a cursor. `elementTag` is the
 * lowercased HTML tag that bears the attribute when it can be determined by a
 * cheap backward scan, else `null`.
 *
 * SEMANTICS the integration layer applies: a `form` element's `n:name` names a
 * COMPONENT (resolves to `createComponent<Name>`); an `input` / `select` /
 * `button` / `textarea` element's `n:name` names a form FIELD (resolves inside
 * the form definition, not to a factory). When `elementTag` is `null` the
 * caller must decide from surrounding context.
 */
export interface LatteFormNameDetection {
  elementTag: string | null;
  name: string;
  nameEnd: number;
  nameStart: number;
}

/** A completion cursor inside a static `n:name` value. */
export interface LatteFormNameCompletionDetection {
  elementTag: string | null;
  prefix: string;
  replaceEnd: number;
  replaceStart: number;
}

/** The reverse of a `createComponent<Name>` factory: the backing component. */
export interface NetteCreateComponentDetection {
  componentName: string;
  methodName: string;
  nameEnd: number;
  nameStart: number;
}

/** Rich PhpStorm-like facts for one `createComponent<Name>()` factory. */
export interface NetteCreateComponentFactoryContext
  extends NetteCreateComponentDetection {
  /** The native return type class, when the method has one. */
  returnType: string | null;
  /** The docblock `@return` class, when no native return type is decisive. */
  docblockReturnType: string | null;
  /** The class from the first direct `return new Foo(...)` in the body. */
  factoryCreatedControlClass: string | null;
  /** The best control class known to this pure domain layer. */
  controlClass: string | null;
}

/** The kind of a component usage found in a Latte template. */
export type NetteComponentUsageKind = "control" | "n:name" | "arrayAccess";

/** One usage of a component name in a Latte template, with its name span. */
export interface NetteComponentUsage {
  end: number;
  kind: NetteComponentUsageKind;
  start: number;
}

/** The classification of a presenter method into its Nette lifecycle role. */
export type NettePresenterLifecycleKind =
  | "startup"
  | "beforeRender"
  | "afterRender"
  | "shutdown"
  | "loadState"
  | "saveState"
  | "action"
  | "render"
  | "handle"
  | "createComponent"
  | "inject";

/**
 * One classified presenter method. `name` is the specific action / signal /
 * component / dependency name (lower-camel, derived from the suffix) for the
 * prefixed kinds (`action`/`render`/`handle`/`createComponent`/`inject`), and
 * `null` for the fixed-name lifecycle hooks (`startup`, `beforeRender`, ...).
 * `offset` is the offset of the method-name identifier.
 */
export interface NettePresenterLifecycleEntry {
  kind: NettePresenterLifecycleKind;
  methodName: string;
  name: string | null;
  offset: number;
}

/** The lifecycle classification of a whole presenter source. */
export interface NettePresenterLifecycleInfo {
  lifecycle: NettePresenterLifecycleEntry[];
}

const IDENTIFIER_HEAD = /[A-Za-z_]/;
const IDENTIFIER_TAIL = /[A-Za-z0-9_]/;

/**
 * PHP return types (case-insensitive, backslash-stripped) that are NOT component
 * classes, so a `createComponent<Name>(): <here>` hint of one of them yields no
 * class.
 */
const NON_CLASS_RETURN_TYPES: ReadonlySet<string> = new Set([
  "array",
  "bool",
  "boolean",
  "callable",
  "double",
  "false",
  "float",
  "int",
  "integer",
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

const NON_CLASS_NEW_TARGETS: ReadonlySet<string> = new Set([
  "class",
  "self",
  "static",
  "parent",
]);

/**
 * Returns the `{control name}` macro at `offset`, or `null` when the cursor is
 * not on a static control name (a dynamic `{control $x}`, a masked region, the
 * tag keyword itself, or an argument other than the name / part).
 */
export function detectLatteControlAt(
  source: string,
  offset: number,
): LatteControlDetection | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  const span = innermostLatteExpressionSpanAt(source, offset);

  if (!span || span.tagName !== "control") {
    return null;
  }

  const parsed = parseControlArgument(source, span.expressionStart, span.contentEnd);

  if (!parsed) {
    return null;
  }

  const cursorEnd = parsed.partEnd ?? parsed.nameEnd;

  if (offset < parsed.nameStart || offset > cursorEnd) {
    return null;
  }

  const detection: LatteControlDetection = {
    name: parsed.name,
    nameEnd: parsed.nameEnd,
    nameStart: parsed.nameStart,
  };

  if (parsed.part !== null) {
    detection.part = parsed.part;
  }

  if (parsed.args !== null) {
    detection.args = parsed.args;
  }

  return detection;
}

/**
 * Returns the `n:name="..."` attribute value at `offset`, or `null` when the
 * cursor is not inside a static `n:name` value (a dynamic `$x`, a masked region,
 * a `data-n:name` lookalike, or a position outside the value).
 */
export function detectLatteFormNameAt(
  source: string,
  offset: number,
): LatteFormNameDetection | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  if (isInsideMask(source, offset)) {
    return null;
  }

  for (const attribute of nNameAttributes(source)) {
    if (offset < attribute.valueStart || offset > attribute.valueEnd) {
      continue;
    }

    const name = source.slice(attribute.valueStart, attribute.valueEnd);

    if (!isIdentifier(name)) {
      return null;
    }

    return {
      elementTag: elementTagBefore(source, attribute.keywordStart),
      name,
      nameEnd: attribute.valueEnd,
      nameStart: attribute.valueStart,
    };
  }

  return null;
}

/**
 * Returns the completion span for a static `n:name` value at `offset`. This is
 * deliberately broader than {@link detectLatteFormNameAt}: an empty value or a
 * partially typed identifier is a valid completion site, while dynamic values
 * (`$form`) and mixed expressions are rejected.
 */
export function detectLatteFormNameCompletionAt(
  source: string,
  offset: number,
): LatteFormNameCompletionDetection | null {
  if (offset < 0 || offset > source.length) {
    return null;
  }

  if (isInsideMask(source, offset)) {
    return null;
  }

  for (const attribute of nNameAttributes(source)) {
    if (offset < attribute.valueStart || offset > attribute.valueEnd) {
      continue;
    }

    const value = source.slice(attribute.valueStart, attribute.valueEnd);
    const prefix = source.slice(attribute.valueStart, offset);

    if (
      !isIdentifierPrefix(prefix) ||
      !isIdentifierSuffix(value.slice(prefix.length))
    ) {
      return null;
    }

    return {
      elementTag: elementTagBefore(source, attribute.keywordStart),
      prefix,
      replaceEnd: attribute.valueEnd,
      replaceStart: attribute.valueStart,
    };
  }

  return null;
}

/**
 * Builds the Nette factory method name for a control name: `createComponent`
 * plus the upper-cased control name (`contactForm` → `createComponentContactForm`).
 */
export function netteCreateComponentMethodName(controlName: string): string {
  return `${CREATE_COMPONENT_PREFIX}${ucfirst(controlName)}`;
}

/**
 * Returns the component backing a `createComponent<Name>` method definition at
 * `offset` (cursor on the method name), or `null` when the cursor is not on such
 * a definition. `componentName` is the lower-camel name (`createComponentContactForm`
 * → `contactForm`) - the reverse of {@link netteCreateComponentMethodName}.
 */
export function detectNetteCreateComponentAt(
  phpSource: string,
  offset: number,
): NetteCreateComponentDetection | null {
  const context = netteCreateComponentFactoryContextAt(phpSource, offset);

  if (!context) {
    return null;
  }

  return {
    componentName: context.componentName,
    methodName: context.methodName,
    nameEnd: context.nameEnd,
    nameStart: context.nameStart,
  };
}

/**
 * Returns every usage of `componentName` in a Latte template - `{control name}`,
 * `<... n:name="name">`, and `$this['name']` - with the name span of each.
 * Usages inside `{* comment *}` / `{syntax off}` regions are skipped. Matching
 * is exact and CASE-SENSITIVE by design: Nette resolves `createComponent<Name>`
 * by an exact PascalCase suffix, so `{control ContactForm}` names a DIFFERENT
 * component than `contactForm` - collapsing the two on a case-insensitive
 * match would produce a false-positive usage link. A case mismatch is
 * therefore a deliberate false-negative (no usage reported), not a bug.
 */
export function netteComponentUsagesInLatte(
  source: string,
  componentName: string,
): NetteComponentUsage[] {
  if (!isIdentifier(componentName)) {
    return [];
  }

  const masks = collectLatteMaskedRegions(source);
  const usages: NetteComponentUsage[] = [];

  collectControlUsages(source, componentName, masks, usages);
  collectNNameUsages(source, componentName, masks, usages);
  collectArrayAccessUsages(source, componentName, masks, usages);

  usages.sort((left, right) => left.start - right.start);

  return usages;
}

/**
 * Classifies every method of a presenter source into its Nette lifecycle role.
 * Skips explicitly `private` methods (they are never framework entry points).
 * Unrecognised methods are omitted. Lexical scan - conservative and bounded.
 */
export function nettePresenterLifecycleInfo(
  phpSource: string,
): NettePresenterLifecycleInfo {
  const lifecycle: NettePresenterLifecycleEntry[] = [];

  for (const method of phpMethodDefinitions(phpSource)) {
    if (method.visibility === "private") {
      continue;
    }

    const classified = classifyLifecycleMethod(method.name);

    if (!classified) {
      continue;
    }

    lifecycle.push({
      kind: classified.kind,
      methodName: method.name,
      name: classified.name,
      offset: method.nameStart,
    });
  }

  return { lifecycle };
}

/**
 * Returns the component class of a `createComponent<Name>` method, in priority
 * order: an explicit return type hint, then a docblock `@return`, then the class
 * of the first `return new <Class>(...)` in the body. The type is returned as
 * WRITTEN (short name or FQN with leading `\`); resolving a short name to an FQN
 * via `use` statements is the integration layer's job. Conservative: a union /
 * intersection type, a non-class type, or an unrecognisable body yields
 * `null` - EXCEPT the idiomatic nullable union (`Foo|null` / `null|Foo`, the
 * same meaning as `?Foo`), which resolves to `Foo` in both the type-hint AND
 * the docblock `@return` path (kept symmetric so a docblock author's
 * habitual `|null` suffix isn't penalised relative to a native nullable hint
 * - see {@link singleNullableUnionMember}).
 */
export function netteComponentClassFromCreateMethod(
  phpSource: string,
  methodName: string,
): string | null {
  const method = findPhpMethodByName(phpSource, methodName);

  if (!method) {
    return null;
  }

  return createComponentFactoryContextFromMethod(phpSource, method)?.controlClass ?? null;
}

/**
 * Returns every `createComponent<Name>()` factory declared in a presenter/control
 * source, with the component name and the strongest class facts the domain
 * parser can know without filesystem/import resolution.
 */
export function netteCreateComponentFactoryContexts(
  phpSource: string,
): NetteCreateComponentFactoryContext[] {
  const contexts: NetteCreateComponentFactoryContext[] = [];

  for (const method of phpMethodDefinitions(phpSource)) {
    const context = createComponentFactoryContextFromMethod(phpSource, method);

    if (context) {
      contexts.push(context);
    }
  }

  return contexts;
}

/**
 * Returns the rich factory context when `offset` sits on a
 * `createComponent<Name>` method name, or `null` otherwise.
 */
export function netteCreateComponentFactoryContextAt(
  phpSource: string,
  offset: number,
): NetteCreateComponentFactoryContext | null {
  if (offset < 0 || offset > phpSource.length) {
    return null;
  }

  for (const context of netteCreateComponentFactoryContexts(phpSource)) {
    if (offset >= context.nameStart && offset <= context.nameEnd) {
      return context;
    }
  }

  return null;
}

function createComponentFactoryContextFromMethod(
  phpSource: string,
  method: PhpMethodDefinition,
): NetteCreateComponentFactoryContext | null {
  const suffix = createComponentSuffix(method.name);

  if (suffix === null) {
    return null;
  }

  const afterParams = matchingParenClose(phpSource, method.openParen);

  if (afterParams === null) {
    return null;
  }

  const returnType = returnTypeAfter(phpSource, afterParams);
  const docblockReturnType = returnType
    ? null
    : docblockReturnBefore(phpSource, method.signatureStart);
  const factoryCreatedControlClass = returnNewClassInBody(phpSource, afterParams);

  return {
    componentName: lcfirst(suffix),
    controlClass: returnType ?? docblockReturnType ?? factoryCreatedControlClass,
    docblockReturnType,
    factoryCreatedControlClass,
    methodName: method.name,
    nameEnd: method.nameEnd,
    nameStart: method.nameStart,
    returnType,
  };
}

function createComponentSuffix(methodName: string): string | null {
  if (!methodName.startsWith(CREATE_COMPONENT_PREFIX)) {
    return null;
  }

  const suffix = methodName.slice(CREATE_COMPONENT_PREFIX.length);

  return suffix.length > 0 ? suffix : null;
}

// --- {control} parsing ------------------------------------------------------

interface ControlArgument {
  args: string | null;
  name: string;
  nameEnd: number;
  nameStart: number;
  part: string | null;
  partEnd: number | null;
}

function parseControlArgument(
  source: string,
  from: number,
  limit: number,
): ControlArgument | null {
  let index = skipInlineSpaces(source, from, limit);
  const nameStart = index;

  const quotedName = readQuotedIdentifier(source, index, limit);

  if (quotedName) {
    index = quotedName.end;
  } else {
    if (!IDENTIFIER_HEAD.test(source[index] ?? "")) {
      return null;
    }

    index += 1;

    while (index < limit && IDENTIFIER_TAIL.test(source[index] ?? "")) {
      index += 1;
    }
  }

  const nameEnd = quotedName ? quotedName.nameEnd : index;
  const actualNameStart = quotedName ? quotedName.nameStart : nameStart;
  const name = source.slice(nameStart, nameEnd);
  const actualName = quotedName ? quotedName.name : name;

  const part = readControlPart(source, index, limit);
  const argsFrom = part ? part.end : index;
  const args = source.slice(argsFrom, limit).trim();

  return {
    args: args.length > 0 ? args : null,
    name: actualName,
    nameEnd,
    nameStart: actualNameStart,
    part: part ? part.text : null,
    partEnd: part ? part.end : null,
  };
}

interface QuotedIdentifier {
  end: number;
  name: string;
  nameEnd: number;
  nameStart: number;
}

function readQuotedIdentifier(
  source: string,
  from: number,
  limit: number,
): QuotedIdentifier | null {
  const quote = source[from];

  if (quote !== '"' && quote !== "'") {
    return null;
  }

  const nameStart = from + 1;
  let index = nameStart;

  while (index < limit && source[index] !== quote) {
    if (source[index] === "\\" || source[index] === "\n") {
      return null;
    }

    index += 1;
  }

  if (source[index] !== quote) {
    return null;
  }

  const name = source.slice(nameStart, index);

  if (!isIdentifier(name)) {
    return null;
  }

  return { end: index + 1, name, nameEnd: index, nameStart };
}

interface ControlPart {
  end: number;
  text: string;
}

function readControlPart(
  source: string,
  from: number,
  limit: number,
): ControlPart | null {
  if (source[from] !== ":") {
    return null;
  }

  let index = from + 1;
  const start = index;

  while (index < limit && IDENTIFIER_TAIL.test(source[index] ?? "")) {
    index += 1;
  }

  const text = source.slice(start, index);

  if (text.length === 0) {
    return null;
  }

  return { end: index, text };
}

// --- n:name parsing ---------------------------------------------------------

interface NNameAttribute {
  keywordStart: number;
  valueEnd: number;
  valueStart: number;
}

const N_NAME_KEYWORD = /(?:^|[\s<\/])n:name/gi;

/**
 * Yields every `n:name="..."` / `n:name='...'` / `n:name=bare` attribute, using
 * a preceding-boundary guard so a `data-n:name` lookalike is never matched, and
 * a manual value parse (quoted or bare) so offsets are precise.
 */
function nNameAttributes(source: string): NNameAttribute[] {
  const attributes: NNameAttribute[] = [];

  N_NAME_KEYWORD.lastIndex = 0;

  for (
    let match = N_NAME_KEYWORD.exec(source);
    match !== null;
    match = N_NAME_KEYWORD.exec(source)
  ) {
    if (N_NAME_KEYWORD.lastIndex <= match.index) {
      N_NAME_KEYWORD.lastIndex = match.index + 1;
    }

    const keywordStart = match.index + match[0].length - "n:name".length;
    const value = nNameValueAfter(source, keywordStart + "n:name".length);

    if (!value) {
      continue;
    }

    attributes.push({ keywordStart, valueEnd: value.valueEnd, valueStart: value.valueStart });
  }

  return attributes;
}

function nNameValueAfter(
  source: string,
  afterKeyword: number,
): { valueEnd: number; valueStart: number } | null {
  let index = skipSpaces(source, afterKeyword);

  if (source[index] !== "=") {
    return null;
  }

  index = skipSpaces(source, index + 1);
  const quote = source[index];

  if (quote === '"' || quote === "'") {
    const valueStart = index + 1;
    const valueEnd = quotedValueEnd(source, valueStart, quote);

    return { valueEnd, valueStart };
  }

  const valueStart = index;
  const valueEnd = bareValueEnd(source, valueStart);

  if (valueEnd === valueStart) {
    return null;
  }

  return { valueEnd, valueStart };
}

function quotedValueEnd(source: string, valueStart: number, quote: string): number {
  for (let index = valueStart; index < source.length; index += 1) {
    const character = source[index];

    if (character === quote || character === "\n") {
      return index;
    }
  }

  return source.length;
}

function bareValueEnd(source: string, valueStart: number): number {
  let index = valueStart;

  while (index < source.length) {
    const character = source[index];

    if (
      character === undefined ||
      character === " " ||
      character === "\t" ||
      character === "\n" ||
      character === "\r" ||
      character === ">" ||
      character === "/"
    ) {
      return index;
    }

    index += 1;
  }

  return source.length;
}

/**
 * Returns the lowercased HTML tag name of the element that bears an attribute
 * whose name starts at `attributeStart`, by scanning back to the nearest `<`,
 * or `null` when a `>` intervenes (outside a tag) or no opener is found within
 * `MAX_ELEMENT_SCAN`.
 */
function elementTagBefore(source: string, attributeStart: number): string | null {
  const min = Math.max(0, attributeStart - MAX_ELEMENT_SCAN);

  for (let index = attributeStart - 1; index >= min; index -= 1) {
    const character = source[index];

    if (character === ">") {
      return null;
    }

    if (character !== "<") {
      continue;
    }

    return tagNameAfterOpen(source, index + 1);
  }

  return null;
}

function tagNameAfterOpen(source: string, from: number): string | null {
  if (!/[A-Za-z]/.test(source[from] ?? "")) {
    return null;
  }

  let index = from;

  while (index < source.length && /[A-Za-z0-9]/.test(source[index] ?? "")) {
    index += 1;
  }

  return source.slice(from, index).toLowerCase();
}

// --- component usage scanning -----------------------------------------------

/**
 * A `RegExpExecArray` produced by a `d`-flagged regex, whose `.indices` array
 * maps each capture group to its own `[start, end)` span in the source. This
 * project's `tsconfig` targets ES2020, and `tsc` rejects the `d` flag on a
 * regex LITERAL below ES2022 ("This regular expression flag is only
 * available when targeting 'es2022' or later") - so the flag is set via a
 * runtime flags STRING (`new RegExp(pattern, "gd")`) instead, which `tsc`
 * does not statically check, and this local type fills in the `.indices`
 * typing the ES2020 lib omits. The `d` flag itself is a plain V8/runtime
 * feature (Node 16+), unaffected by the `--target` used for syntax downleveling.
 */
type IndexedMatch = RegExpExecArray & {
  indices?: Array<[number, number] | undefined>;
};

/**
 * Returns the `[start, end)` span of capture group `groupIndex` from a match
 * produced by a `d`-flagged regex, or `null` when the group did not
 * participate. The mandatory groups used below always participate when the
 * overall match succeeds, so `null` should not occur in practice - it is
 * kept as a safe fallback (skip the usage) rather than a throw, matching this
 * file's "ambiguous resolves to null / skipped" conservatism.
 *
 * Replaces a previous `match[0].indexOf(componentName)` approach, which was
 * UNSOUND whenever `componentName` also occurs earlier in the whole match -
 * e.g. `{control control}` (the argument name IS the `control` keyword) or
 * `$this['this']` (the argument name IS the `this` keyword): `indexOf` found
 * that earlier, unrelated occurrence and returned a span pointing at the
 * keyword instead of the actual argument. `match.indices` gives the capture
 * group's real position directly, with no such ambiguity.
 */
function groupSpan(match: RegExpExecArray, groupIndex: number): [number, number] | null {
  const indices = (match as IndexedMatch).indices;

  return indices?.[groupIndex] ?? null;
}

function collectControlUsages(
  source: string,
  componentName: string,
  masks: LatteMaskedRegion[],
  usages: NetteComponentUsage[],
): void {
  // Matching is exact and CASE-SENSITIVE by design (no "i" flag): Nette
  // resolves createComponent<Name> by an exact PascalCase suffix, so
  // {control ContactForm} names a DIFFERENT component than contactForm. A
  // case mismatch is a deliberate false-negative here, not a bug - see the
  // rationale on netteComponentUsagesInLatte above.
  const pattern = new RegExp(
    [
      "\\{control\\s+",
      `(?:(['"])(${escapeRegExp(componentName)})\\1|`,
      `(${escapeRegExp(componentName)}))`,
      "(?::[A-Za-z0-9_]*)?",
      "(?![A-Za-z0-9_])",
    ].join(""),
    "gd",
  );

  forEachMatch(source, pattern, (match) => {
    const span = groupSpan(match, 2) ?? groupSpan(match, 3);

    if (!span) {
      return;
    }

    pushUsage(usages, masks, "control", span[0], span[1]);
  });
}

function collectNNameUsages(
  source: string,
  componentName: string,
  masks: LatteMaskedRegion[],
  usages: NetteComponentUsage[],
): void {
  for (const attribute of nNameAttributes(source)) {
    const value = source.slice(attribute.valueStart, attribute.valueEnd);

    // Exact, case-sensitive equality - see netteComponentUsagesInLatte above.
    if (value !== componentName) {
      continue;
    }

    pushUsage(usages, masks, "n:name", attribute.valueStart, attribute.valueEnd);
  }
}

function collectArrayAccessUsages(
  source: string,
  componentName: string,
  masks: LatteMaskedRegion[],
  usages: NetteComponentUsage[],
): void {
  // Case-sensitive by design - see netteComponentUsagesInLatte above.
  const pattern = new RegExp(
    `\\$this\\s*\\[\\s*(['"])(${escapeRegExp(componentName)})\\1\\s*\\]`,
    "gd",
  );

  forEachMatch(source, pattern, (match) => {
    const span = groupSpan(match, 2);

    if (!span) {
      return;
    }

    pushUsage(usages, masks, "arrayAccess", span[0], span[1]);
  });
}

function pushUsage(
  usages: NetteComponentUsage[],
  masks: LatteMaskedRegion[],
  kind: NetteComponentUsageKind,
  start: number,
  end: number,
): void {
  if (isOffsetMasked(start, masks)) {
    return;
  }

  usages.push({ end, kind, start });
}

// --- PHP method scanning ----------------------------------------------------

interface PhpMethodDefinition {
  name: string;
  nameEnd: number;
  nameStart: number;
  openParen: number;
  signatureStart: number;
  visibility: "public" | "protected" | "private" | null;
}

const PHP_METHOD_DEF =
  /((?:(?:public|protected|private|static|final|abstract)\s+)*)\bfunction\s*&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

function phpMethodDefinitions(source: string): PhpMethodDefinition[] {
  const methods: PhpMethodDefinition[] = [];

  PHP_METHOD_DEF.lastIndex = 0;

  for (
    let match = PHP_METHOD_DEF.exec(source);
    match !== null;
    match = PHP_METHOD_DEF.exec(source)
  ) {
    if (PHP_METHOD_DEF.lastIndex <= match.index) {
      PHP_METHOD_DEF.lastIndex = match.index + 1;
    }

    const name = match[2] ?? "";
    const openParen = match.index + match[0].length - 1;
    const nameEnd = nameEndBeforeParen(source, openParen);
    const nameStart = nameEnd - name.length;

    methods.push({
      name,
      nameEnd,
      nameStart,
      openParen,
      signatureStart: match.index,
      visibility: visibilityFromModifiers(match[1] ?? ""),
    });
  }

  return methods;
}

function visibilityFromModifiers(
  modifiers: string,
): PhpMethodDefinition["visibility"] {
  if (/\bprivate\b/.test(modifiers)) {
    return "private";
  }

  if (/\bprotected\b/.test(modifiers)) {
    return "protected";
  }

  if (/\bpublic\b/.test(modifiers)) {
    return "public";
  }

  return null;
}

function nameEndBeforeParen(source: string, openParen: number): number {
  let index = openParen - 1;

  while (index >= 0 && isWhitespace(source[index])) {
    index -= 1;
  }

  return index + 1;
}

function findPhpMethodByName(
  source: string,
  methodName: string,
): PhpMethodDefinition | null {
  for (const method of phpMethodDefinitions(source)) {
    if (method.name === methodName) {
      return method;
    }
  }

  return null;
}

// --- lifecycle classification -----------------------------------------------

interface LifecycleClassification {
  kind: NettePresenterLifecycleKind;
  name: string | null;
}

const FIXED_LIFECYCLE: ReadonlyMap<string, NettePresenterLifecycleKind> = new Map([
  ["startup", "startup"],
  ["beforeRender", "beforeRender"],
  ["afterRender", "afterRender"],
  ["shutdown", "shutdown"],
  ["loadState", "loadState"],
  ["saveState", "saveState"],
]);

const PREFIX_LIFECYCLE: ReadonlyArray<[string, NettePresenterLifecycleKind]> = [
  ["action", "action"],
  ["render", "render"],
  ["handle", "handle"],
  ["createComponent", "createComponent"],
  ["inject", "inject"],
];

function classifyLifecycleMethod(name: string): LifecycleClassification | null {
  const fixed = FIXED_LIFECYCLE.get(name);

  if (fixed) {
    return { kind: fixed, name: null };
  }

  for (const [prefix, kind] of PREFIX_LIFECYCLE) {
    const suffix = prefixSuffix(name, prefix);

    if (suffix === null) {
      continue;
    }

    return { kind, name: lcfirst(suffix) };
  }

  return null;
}

/**
 * Returns the name suffix after `prefix` when `name` is `<prefix><Uppercase>...`,
 * or `null`. Requires an upper-case boundary so `render` matches `renderDefault`
 * but not the method literally named `render`, and `inject` matches
 * `injectFoo` but not `injection`.
 *
 * INTENTIONALLY UNCLASSIFIED: a bare `render()` / `action()` (no suffix) is
 * therefore omitted from the lifecycle list entirely rather than classified
 * as some default variant. On a PRESENTER (what this module classifies) a
 * bare `render()`/`action()` has no framework meaning of its own - Nette
 * always dispatches a NAMED view/action (`renderDefault` / `actionDefault`
 * at minimum). A bare `render()` DOES have meaning on a Nette `Control` (its
 * own render entry point), but that is a different class hierarchy this
 * module does not (yet) model - a separate concern from presenter lifecycle
 * classification.
 */
function prefixSuffix(name: string, prefix: string): string | null {
  if (!name.startsWith(prefix)) {
    return null;
  }

  const suffix = name.slice(prefix.length);
  const head = suffix[0] ?? "";

  if (!/[A-Z]/.test(head)) {
    return null;
  }

  return suffix;
}

// --- return-type / docblock / return-new resolution -------------------------

/**
 * Returns the class named by a `: <Type>` return type hint, or `null` for a
 * non-class type, an intersection type (`Foo&Bar`), an unrecognisable
 * shape, or a genuine multi-class union (`Foo|Bar`). The one union shape
 * that DOES resolve is the idiomatic nullable union - `Foo|null` / `null|Foo`
 * (PHP 8's alternative spelling of `?Foo`) - which yields `Foo`; see
 * {@link singleNullableUnionMember}.
 */
function returnTypeAfter(source: string, afterParams: number): string | null {
  let index = skipWhitespace(source, afterParams);

  if (source[index] !== ":") {
    return null;
  }

  index = skipWhitespace(source, index + 1);

  if (source[index] === "?") {
    index = skipWhitespace(source, index + 1);
  }

  const tokens: string[] = [];

  while (index <= source.length) {
    const start = index;

    while (index < source.length && isTypeChar(source[index])) {
      index += 1;
    }

    const token = source.slice(start, index);

    if (token.length === 0) {
      return null;
    }

    tokens.push(token);

    const afterToken = skipWhitespace(source, index);

    if (source[afterToken] === "&") {
      return null;
    }

    if (source[afterToken] !== "|") {
      break;
    }

    index = skipWhitespace(source, afterToken + 1);
  }

  return singleNullableUnionMember(tokens);
}

const DOCBLOCK_RETURN_TYPE =
  /@return\s+(\??\\?[A-Za-z_][A-Za-z0-9_\\]*(?:\s*\|\s*\??\\?[A-Za-z_][A-Za-z0-9_\\]*)*)/;

/**
 * Returns the class named by a `@return <Type>` docblock tag, with the same
 * union handling as {@link returnTypeAfter}: a genuine multi-class union
 * (`@return Foo|Bar`) yields `null`, while the idiomatic nullable union
 * (`@return Foo|null` / `@return null|Foo`) yields `Foo` - a very common
 * docblock habit (many authors write `|null` where a native hint would use
 * `?Foo`), so treating it as an unresolvable union would be an unnecessary
 * false-negative on the docblock's declared class. An intersection type is
 * rejected like the hint path rejects it: the type regex stops at `&`, so a
 * trailing `&` right after the matched expression (`Foo&Bar`, `Foo&Bar|null`)
 * marks an intersection and yields `null`. A DNF `(Foo&Bar)|null` never
 * matches the regex at all (the leading `(` is not a type-name head).
 */
function docblockReturnBefore(source: string, signatureStart: number): string | null {
  const windowStart = Math.max(0, signatureStart - MAX_DOCBLOCK_SCAN);
  const close = source.lastIndexOf("*/", signatureStart);

  if (close < windowStart) {
    return null;
  }

  const open = source.lastIndexOf("/**", close);

  if (open < 0 || open < windowStart) {
    return null;
  }

  const between = source.slice(close + 2, signatureStart);

  if (between.trim().length > 0) {
    return null;
  }

  const docblock = source.slice(open, close);
  const match = DOCBLOCK_RETURN_TYPE.exec(docblock);

  if (!match) {
    return null;
  }

  const afterType = skipSpaces(docblock, match.index + match[0].length);

  if (docblock[afterType] === "&") {
    return null;
  }

  const tokens = (match[1] ?? "")
    .split("|")
    .map((token) => token.trim().replace(/^\?/, ""));

  return singleNullableUnionMember(tokens);
}

function returnNewClassInBody(source: string, afterParams: number): string | null {
  const bodyStart = methodBodyStart(source, afterParams);

  if (bodyStart === null) {
    return null;
  }

  const bodyEnd = matchingBraceClose(source, bodyStart);
  let index = bodyStart + 1;

  while (index < bodyEnd) {
    const next = skipPhpIgnored(source, index, bodyEnd);

    if (next !== index) {
      index = next;
      continue;
    }

    if (!keywordAt(source, index, "return")) {
      index += 1;
      continue;
    }

    const afterReturn = skipWhitespace(source, index + "return".length);

    if (!keywordAt(source, afterReturn, "new")) {
      index = afterReturn;
      continue;
    }

    const token = readClassNameToken(
      source,
      skipWhitespace(source, afterReturn + "new".length),
      bodyEnd,
    );

    if (!token) {
      index = afterReturn + "new".length;
      continue;
    }

    if (NON_CLASS_NEW_TARGETS.has(token.replace(/^\\/, "").toLowerCase())) {
      index = tokenEnd(source, token, afterReturn);
      continue;
    }

    return token;
  }

  return null;
}

function skipPhpIgnored(source: string, from: number, limit: number): number {
  const character = source[from];
  const next = source[from + 1];

  if (character === "'" || character === '"') {
    return skipQuotedPhpString(source, from, limit);
  }

  if (character === "/" && next === "/") {
    return skipLineComment(source, from + 2, limit);
  }

  if (character === "#") {
    return skipLineComment(source, from + 1, limit);
  }

  if (character === "/" && next === "*") {
    return skipBlockComment(source, from + 2, limit);
  }

  return from;
}

function skipQuotedPhpString(source: string, from: number, limit: number): number {
  const quote = source[from];

  for (let index = from + 1; index < limit; index += 1) {
    const character = source[index];

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index + 1;
    }
  }

  return limit;
}

function skipLineComment(source: string, from: number, limit: number): number {
  for (let index = from; index < limit; index += 1) {
    if (source[index] === "\n") {
      return index + 1;
    }
  }

  return limit;
}

function skipBlockComment(source: string, from: number, limit: number): number {
  for (let index = from; index + 1 < limit; index += 1) {
    if (source[index] === "*" && source[index + 1] === "/") {
      return index + 2;
    }
  }

  return limit;
}

function keywordAt(source: string, offset: number, keyword: string): boolean {
  if (
    source.slice(offset, offset + keyword.length).toLowerCase() !==
    keyword.toLowerCase()
  ) {
    return false;
  }

  return (
    !IDENTIFIER_TAIL.test(source[offset - 1] ?? "") &&
    !IDENTIFIER_TAIL.test(source[offset + keyword.length] ?? "")
  );
}

function readClassNameToken(
  source: string,
  from: number,
  limit: number,
): string | null {
  let index = from;

  if (source[index] === "\\") {
    index += 1;
  }

  if (!IDENTIFIER_HEAD.test(source[index] ?? "")) {
    return null;
  }

  index += 1;

  while (index < limit && /[A-Za-z0-9_\\]/.test(source[index] ?? "")) {
    index += 1;
  }

  const token = source.slice(from, index);

  return token.endsWith("\\") ? null : token;
}

function tokenEnd(source: string, token: string, from: number): number {
  const index = source.indexOf(token, from);

  return index < 0 ? from : index + token.length;
}

function methodBodyStart(source: string, afterParams: number): number | null {
  for (let index = afterParams; index < source.length; index += 1) {
    const character = source[index];
    const skipped = skipPhpIgnored(source, index, source.length);

    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    if (character === "{") {
      return index;
    }

    if (character === ";") {
      return null;
    }
  }

  return null;
}

function classTypeOrNull(token: string): string | null {
  const normalized = token.replace(/^\\/, "").toLowerCase();

  if (NON_CLASS_RETURN_TYPES.has(normalized)) {
    return null;
  }

  return token;
}

/**
 * Given the `|`-split members of a return-type union (from a type hint or a
 * docblock `@return`), returns the single non-null CLASS member when the
 * union is exactly one class type optionally paired with `null` - the
 * idiomatic nullable shape (`Foo|null`, `null|Foo`, same meaning as `?Foo`) -
 * or `null` for anything else: an empty list, a genuine multi-class union
 * (`Foo|Bar`), or a union whose sole non-null member is itself a non-class
 * type (`void|null`). Conservative: only the one well-known idiom collapses;
 * every other shape resolves to "give up" rather than a guess.
 */
function singleNullableUnionMember(tokens: string[]): string | null {
  const nonNullTokens: string[] = [];

  for (const token of tokens) {
    if (token.replace(/^\\/, "").toLowerCase() === "null") {
      continue;
    }

    nonNullTokens.push(token);
  }

  if (nonNullTokens.length !== 1) {
    return null;
  }

  return classTypeOrNull(nonNullTokens[0] ?? "");
}

// --- bounded quote-aware balancers ------------------------------------------

/**
 * Returns the offset just past the `)` matching the `(` at `openParen`, or
 * `null` when unbalanced. Skips single / double quoted strings so a `)` inside a
 * default-value literal does not close early. Bounded by the source length.
 */
function matchingParenClose(source: string, openParen: number): number | null {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openParen; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    const skipped = skipPhpIgnored(source, index, source.length);

    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character === ")") {
      depth -= 1;

      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return null;
}

/**
 * Returns the offset just past the `}` matching the `{` at `openBrace`, or the
 * source length when unbalanced. Skips single / double quoted strings. Bounded.
 */
function matchingBraceClose(source: string, openBrace: number): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = openBrace; index < source.length; index += 1) {
    const character = source[index];

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    const skipped = skipPhpIgnored(source, index, source.length);

    if (skipped !== index) {
      index = skipped - 1;
      continue;
    }

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth -= 1;

      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return source.length;
}

// --- small shared utilities -------------------------------------------------

function forEachMatch(
  source: string,
  pattern: RegExp,
  handle: (match: RegExpExecArray) => void,
): void {
  pattern.lastIndex = 0;

  for (
    let match = pattern.exec(source);
    match !== null;
    match = pattern.exec(source)
  ) {
    if (pattern.lastIndex <= match.index) {
      pattern.lastIndex = match.index + 1;
    }

    handle(match);
  }
}

function isInsideMask(source: string, offset: number): boolean {
  return isOffsetMasked(offset, collectLatteMaskedRegions(source, offset));
}

function isOffsetMasked(offset: number, masks: LatteMaskedRegion[]): boolean {
  return masks.some(
    (region) => offset > region.start && (offset < region.end || !region.closed),
  );
}

function isIdentifier(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

function isIdentifierPrefix(value: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$|^$/.test(value);
}

function isIdentifierSuffix(value: string): boolean {
  return /^[A-Za-z0-9_]*$/.test(value);
}

function isTypeChar(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_\\]/.test(character);
}

function isWhitespace(character: string | undefined): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

function skipSpaces(source: string, from: number): number {
  let index = from;

  while (source[index] === " " || source[index] === "\t") {
    index += 1;
  }

  return index;
}

function skipInlineSpaces(source: string, from: number, limit: number): number {
  let index = from;

  while (index < limit && (source[index] === " " || source[index] === "\t")) {
    index += 1;
  }

  return index;
}

function skipWhitespace(source: string, from: number): number {
  let index = from;

  while (isWhitespace(source[index])) {
    index += 1;
  }

  return index;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function ucfirst(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return value.charAt(0).toUpperCase() + value.slice(1);
}

function lcfirst(value: string): string {
  if (value.length === 0) {
    return value;
  }

  return value.charAt(0).toLowerCase() + value.slice(1);
}

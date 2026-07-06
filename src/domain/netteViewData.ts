/**
 * Nette PRESENTER -> template variable intelligence: the source-level extractor
 * that mirrors {@link ./phpLaravelViewData} for the Nette/Latte stack. It reads
 * a presenter/control PHP source and reports which variables each render/action
 * passes to its Latte template, so `{$product->}` in `show.latte` can complete
 * like PhpStorm.
 *
 * The module is pure and filesystem-free. The application layer feeds it the
 * presenter sources it discovered (and cached per workspace root); this module
 * extracts the view-data bindings once per source.
 *
 * ## viewName format (documented contract)
 *
 * Every binding's `viewName` is `"<Presenter>:<action>"` where:
 *   - `<Presenter>` is the class short name with a trailing `Presenter`/`Control`
 *     suffix stripped (`ProductPresenter` -> `Product`), matching the Nette link
 *     target convention. The controller pairs it with a template file through
 *     `nettePathResolution`.
 *   - `<action>` is derived from the assigning method:
 *       * `renderShow` / `actionShow`  -> `show` (first letter lowercased).
 *       * `renderDefault` / `actionDefault` -> `default`.
 *       * bare `render()` / `action()`, `startup`, `beforeRender`, or any other
 *         (helper) method -> `*` (a WILDCARD action: the variable applies to
 *         EVERY action of that presenter, because these run for all actions and
 *         the concrete action cannot be known statically).
 *
 * So `Product:show` binds variables of the `show` action; `Product:*` binds
 * variables shared by every action of `ProductPresenter`.
 *
 * ## Type sources
 *
 * Each variable carries a cheap display `typeHint` (from a local `@var` docblock
 * or a `new X()` / `X::` assignment of a bare value variable) plus the
 * `valueExpression` + `valueOffset` so the application layer can run full
 * PhpStorm-grade expression-type inference per sighting - identical to Laravel.
 * Custom `Template` classes (see {@link netteTemplateClassPropertiesFromSource})
 * are a HIGHER-priority type source resolved separately by the caller.
 */

import type {
  PhpFrameworkViewDataBinding,
  PhpFrameworkViewDataEntry,
  PhpFrameworkViewDataVariable,
} from "./phpFrameworkProviders";

/**
 * Byte-precise text-search anchors that surface the presenter/control sources
 * feeding data into Latte templates. `->template->` matches the dominant
 * `$this->template->x = ...` assignment idiom (and the `$template->x` form once
 * `$template = $this->template`); `setParameters(` matches the
 * `$this->template->setParameters([...])` array form. Owned here (not the
 * controller) so view-data knowledge stays framework-owned, mirroring
 * Laravel's `laravelViewDataSearchQueries`.
 */
export const NETTE_VIEW_DATA_SEARCH_QUERIES: readonly string[] = [
  "->template->",
  "setParameters(",
];

/** A typed template property discovered on a custom Nette `Template` class. */
export interface NetteTemplateProperty {
  /** The template variable name WITH its `$` prefix (`$product`). */
  name: string;
  /** The declared type, normalized (`Product`, `Product[]`, `string`). */
  type: string;
}

interface NetteMethodRange {
  action: string;
  bodyEnd: number;
  bodyStart: number;
}

interface NetteViewDataSighting {
  offset: number;
  variable: PhpFrameworkViewDataVariable;
  viewName: string;
}

const TEMPLATE_RECEIVER = String.raw`\$(?:this\s*->\s*template|template)`;
const TEMPLATE_PROPERTY_ASSIGNMENT = new RegExp(
  TEMPLATE_RECEIVER + String.raw`\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*=(?![=>])`,
  "g",
);
const TEMPLATE_SET_PARAMETERS = new RegExp(
  TEMPLATE_RECEIVER + String.raw`\s*->\s*setParameters\s*\(`,
  "g",
);
const CHAINED_TEMPLATE_TARGET = new RegExp(
  "^" +
    TEMPLATE_RECEIVER +
    String.raw`\s*->\s*[A-Za-z_][A-Za-z0-9_]*\s*=(?![=>])\s*`,
);

export function netteViewDataEntryFromSource(
  source: string,
): PhpFrameworkViewDataEntry {
  return { bindings: netteViewDataBindings(source), source };
}

function netteViewDataBindings(source: string): PhpFrameworkViewDataBinding[] {
  const presenterName = nettePresenterShortName(source);

  if (!presenterName) {
    return [];
  }

  const ranges = presenterMethodRanges(source);
  const sightings = [
    ...propertyAssignmentSightings(source, ranges, presenterName),
    ...setParametersSightings(source, ranges, presenterName),
  ].sort((left, right) => left.offset - right.offset);

  const bindings = new Map<string, Map<string, PhpFrameworkViewDataVariable>>();

  for (const sighting of sightings) {
    const existing = bindings.get(sighting.viewName) ?? new Map();

    existing.set(sighting.variable.name, sighting.variable);
    bindings.set(sighting.viewName, existing);
  }

  return Array.from(bindings.entries()).map(([viewName, variables]) => ({
    variables: Array.from(variables.values()),
    viewName,
  }));
}

function propertyAssignmentSightings(
  source: string,
  ranges: readonly NetteMethodRange[],
  presenterName: string,
): NetteViewDataSighting[] {
  const sightings: NetteViewDataSighting[] = [];

  for (const match of source.matchAll(TEMPLATE_PROPERTY_ASSIGNMENT)) {
    const name = match[1] ?? "";
    const offset = match.index ?? 0;

    if (!name) {
      continue;
    }

    const value = resolveAssignmentValue(source, offset + match[0].length);

    if (!value) {
      continue;
    }

    sightings.push({
      offset,
      variable: viewDataVariable(
        source,
        name,
        "template data",
        value.expression,
        value.offset,
      ),
      viewName: `${presenterName}:${actionForOffset(offset, ranges)}`,
    });
  }

  return sightings;
}

function setParametersSightings(
  source: string,
  ranges: readonly NetteMethodRange[],
  presenterName: string,
): NetteViewDataSighting[] {
  const sightings: NetteViewDataSighting[] = [];

  for (const match of source.matchAll(TEMPLATE_SET_PARAMETERS)) {
    const callOffset = match.index ?? 0;
    const openParen = callOffset + match[0].length - 1;
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const [firstPart] = splitTopLevelParts(
      source.slice(openParen + 1, closeParen),
      ",",
    );

    if (!firstPart) {
      continue;
    }

    const viewName = `${presenterName}:${actionForOffset(callOffset, ranges)}`;

    for (const entry of associativeArrayEntries(
      firstPart.text,
      openParen + 1 + firstPart.offset,
    )) {
      sightings.push({
        offset: entry.valueOffset ?? callOffset,
        variable: viewDataVariable(
          source,
          entry.name,
          "template setParameters()",
          entry.valueExpression,
          entry.valueOffset,
        ),
        viewName,
      });
    }
  }

  return sightings;
}

interface AssociativeArrayEntry {
  name: string;
  valueExpression: string | null;
  valueOffset: number | null;
}

function associativeArrayEntries(
  expression: string,
  expressionOffset: number,
): AssociativeArrayEntry[] {
  const trimmed = expression.trim();

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  const openBracket = expression.indexOf("[");
  const bodyOffset = expressionOffset + openBracket + 1;
  const entries: AssociativeArrayEntry[] = [];

  for (const entry of splitTopLevelParts(trimmed.slice(1, -1), ",")) {
    const { keyPart, valuePart } = splitFirstTopLevelArrow(entry.text);
    const name = stringLiteralValue(keyPart.text);

    if (!name || !isSafeVariableName(name)) {
      continue;
    }

    const valueExpression =
      valuePart && valuePart.text.length > 0 ? valuePart.text : null;

    entries.push({
      name,
      valueExpression,
      valueOffset:
        valuePart && valueExpression
          ? bodyOffset + entry.offset + valuePart.offset
          : null,
    });
  }

  return entries;
}

/**
 * Resolves the value expression assigned at `rawStart` (just past the `=`),
 * transparently skipping chained `$this->template->b = ` targets so that
 * `$this->template->a = $this->template->b = $value` reports `$value` for both
 * `a` and `b` (each intermediate target is matched on its own pass). Returns
 * `null` when the statement never terminates with a top-level `;`.
 */
function resolveAssignmentValue(
  source: string,
  rawStart: number,
): { expression: string; offset: number } | null {
  let cursor = rawStart;

  while (cursor < source.length && /\s/.test(source[cursor] ?? "")) {
    cursor += 1;
  }

  while (true) {
    const chained = CHAINED_TEMPLATE_TARGET.exec(source.slice(cursor));

    if (!chained) {
      break;
    }

    cursor += chained[0].length;
  }

  const end = topLevelStatementEnd(source, cursor);

  if (end === null) {
    return null;
  }

  const expression = source.slice(cursor, end).trim();

  if (!expression) {
    return null;
  }

  return { expression, offset: cursor };
}

function viewDataVariable(
  source: string,
  name: string,
  detail: string,
  valueExpression: string | null,
  valueOffset: number | null,
): PhpFrameworkViewDataVariable {
  return {
    detail,
    name: `$${name}`,
    typeHint: typeHintForValue(source, valueExpression, valueOffset),
    valueExpression,
    valueOffset,
  };
}

/**
 * Cheap display type hint: only a bare `$variable` value resolves (a local
 * `@var` docblock, then a `new X()` / `X::` assignment before the offset). Any
 * richer expression is left to the caller's expression-type inference via
 * `valueExpression` / `valueOffset`.
 */
function typeHintForValue(
  source: string,
  valueExpression: string | null,
  valueOffset: number | null,
): string | null {
  if (!valueExpression || valueOffset === null) {
    return null;
  }

  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(valueExpression.trim());

  if (!match?.[1]) {
    return null;
  }

  const before = source.slice(0, valueOffset);

  return (
    phpDocTypeForVariable(before, match[1]) ??
    assignmentTypeForVariable(before, match[1])
  );
}

function phpDocTypeForVariable(
  source: string,
  variableName: string,
): string | null {
  const pattern = new RegExp(
    String.raw`@var\s+([\\?A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]\s]*)\s+\$${escapeRegExp(
      variableName,
    )}\b`,
    "g",
  );
  let found: string | null = null;

  for (const match of source.matchAll(pattern)) {
    found = normalizeType(match[1] ?? "");
  }

  return found;
}

function assignmentTypeForVariable(
  source: string,
  variableName: string,
): string | null {
  const pattern = new RegExp(
    String.raw`\$${escapeRegExp(
      variableName,
    )}\s*=(?![=>])\s*(?:new\s+)?(\\?[A-Z][A-Za-z0-9_\\]*)\s*(?:::|->|\()`,
    "g",
  );
  let found: string | null = null;

  for (const match of source.matchAll(pattern)) {
    found = normalizeType(match[1] ?? "");
  }

  return found;
}

/**
 * Extracts the type-bearing template properties of a custom Nette `Template`
 * class (a class named `*Template` or extending a `*Template` base): its typed
 * public properties (`public Product $product;`) and its `@property` /
 * `@property-read` / `@property-write` docblock annotations. Per the spec these
 * are the HIGHEST-priority source of Latte variable types (§4.4). Names carry
 * the `$` prefix so they compare directly against view-data variable names.
 */
export function netteTemplateClassPropertiesFromSource(
  source: string,
  className?: string,
): NetteTemplateProperty[] {
  const templateClass = netteTemplateClassRange(source, className);

  if (!templateClass) {
    return [];
  }

  const properties: NetteTemplateProperty[] = [];
  const seen = new Set<string>();

  const push = (property: NetteTemplateProperty) => {
    if (seen.has(property.name)) {
      return;
    }

    seen.add(property.name);
    properties.push(property);
  };

  for (const property of docblockPropertyAnnotations(
    source,
    templateClass.classStart,
  )) {
    push(property);
  }

  for (const property of typedPublicProperties(
    source.slice(templateClass.bodyStart, templateClass.bodyEnd),
  )) {
    push(property);
  }

  return properties;
}

interface NetteTemplateClassRange {
  bodyEnd: number;
  bodyStart: number;
  classStart: number;
}

function netteTemplateClassRange(
  source: string,
  targetClassName?: string,
): NetteTemplateClassRange | null {
  const pattern =
    /\bclass\s+([A-Za-z_][A-Za-z0-9_]*)(?:\s+extends\s+([\\A-Za-z0-9_]+))?/g;
  const targetShortName = targetClassName
    ? shortClassName(targetClassName)
    : null;

  for (const match of source.matchAll(pattern)) {
    const className = match[1] ?? "";
    const baseName = match[2] ?? "";

    if (targetShortName !== null && className !== targetShortName) {
      continue;
    }

    if (!isTemplateClassName(className) && !isTemplateClassName(baseName)) {
      continue;
    }

    const bodyStart = source.indexOf("{", (match.index ?? 0) + match[0].length);

    if (bodyStart === -1) {
      continue;
    }

    const bodyEnd = matchingBracketOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    return { bodyEnd, bodyStart, classStart: match.index ?? 0 };
  }

  return null;
}

function shortClassName(className: string): string {
  return className.replace(/^\\+/, "").split("\\").pop() ?? "";
}

function isTemplateClassName(className: string): boolean {
  const lastSegment = shortClassName(className);

  return lastSegment.length > 0 && lastSegment.endsWith("Template");
}

function docblockPropertyAnnotations(
  source: string,
  classStart: number,
): NetteTemplateProperty[] {
  const docblock = precedingDocblock(source, classStart);

  if (!docblock) {
    return [];
  }

  const pattern =
    /@property(?:-read|-write)?\s+([^\n$]*?)\s+\$([A-Za-z_][A-Za-z0-9_]*)/g;
  const properties: NetteTemplateProperty[] = [];

  for (const match of docblock.matchAll(pattern)) {
    const type = normalizeType(match[1] ?? "");
    const name = match[2] ?? "";

    if (!type || !name) {
      continue;
    }

    properties.push({ name: `$${name}`, type });
  }

  return properties;
}

function precedingDocblock(source: string, classStart: number): string | null {
  const before = source.slice(0, classStart);
  const matches = Array.from(before.matchAll(/\/\*\*[\s\S]*?\*\//g));
  const last = matches[matches.length - 1];

  if (!last) {
    return null;
  }

  const gap = before.slice((last.index ?? 0) + last[0].length);

  if (gap.trim().length > 0) {
    return null;
  }

  return last[0];
}

function typedPublicProperties(body: string): NetteTemplateProperty[] {
  const pattern =
    /\bpublic\s+(?:readonly\s+)?((?:\?)?[\\A-Za-z_][\\A-Za-z0-9_|&<>[\]]*)\s+\$([A-Za-z_][A-Za-z0-9_]*)/g;
  const properties: NetteTemplateProperty[] = [];

  for (const match of body.matchAll(pattern)) {
    const type = normalizeType(match[1] ?? "");
    const name = match[2] ?? "";

    if (!type || !name || type === "function" || type === "static") {
      continue;
    }

    properties.push({ name: `$${name}`, type });
  }

  return properties;
}

/**
 * Returns the short name of the FIRST class in `source` whose name ends with
 * `Presenter` / `Control` (the suffix stripped), or `null` when no such class
 * exists. Conservative on two fronts: an unrelated class declared earlier in
 * the file (a `*Template` entity, a helper service) is skipped rather than
 * mistaken for the presenter, and an anonymous `new class extends X { ... }`
 * expression is never matched at all - `(?!extends\b|implements\b)` rejects a
 * "class" token immediately followed by `extends`/`implements` with no name
 * in between, which is exactly the anonymous-class shape.
 */
function nettePresenterShortName(source: string): string | null {
  const pattern = /\bclass\s+(?!extends\b|implements\b)([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const match of source.matchAll(pattern)) {
    const className = match[1] ?? "";

    if (className.endsWith("Presenter")) {
      return className.slice(0, -"Presenter".length);
    }

    if (className.endsWith("Control")) {
      return className.slice(0, -"Control".length);
    }
  }

  return null;
}

function presenterMethodRanges(source: string): NetteMethodRange[] {
  const ranges: NetteMethodRange[] = [];
  const pattern = /\bfunction\s+&?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of source.matchAll(pattern)) {
    const parenOpen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const parenClose = matchingBracketOffset(source, parenOpen, "(", ")");

    if (parenClose === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", parenClose);

    if (bodyStart === -1 || /[;}]/.test(source.slice(parenClose + 1, bodyStart))) {
      continue;
    }

    const bodyEnd = matchingBracketOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    ranges.push({
      action: actionFromMethodName(match[1] ?? ""),
      bodyEnd,
      bodyStart,
    });
  }

  return ranges;
}

function actionFromMethodName(name: string): string {
  const match = /^(?:render|action)([A-Z][A-Za-z0-9_]*)$/.exec(name);
  const suffix = match?.[1] ?? "";

  if (!suffix) {
    return "*";
  }

  return suffix[0].toLowerCase() + suffix.slice(1);
}

function actionForOffset(
  offset: number,
  ranges: readonly NetteMethodRange[],
): string {
  let enclosing: NetteMethodRange | null = null;

  for (const range of ranges) {
    if (offset < range.bodyStart || offset >= range.bodyEnd) {
      continue;
    }

    if (!enclosing || range.bodyEnd - range.bodyStart < enclosing.bodyEnd - enclosing.bodyStart) {
      enclosing = range;
    }
  }

  return enclosing?.action ?? "*";
}

function topLevelStatementEnd(source: string, start: number): number | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = start; index < source.length; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

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

  return null;
}

interface TopLevelPart {
  offset: number;
  text: string;
}

function splitTopLevelParts(source: string, separator: ","): TopLevelPart[] {
  const parts: TopLevelPart[] = [];
  let depth = 0;
  let start = 0;
  let quote: "'" | '"' | null = null;

  const pushPart = (endIndex: number) => {
    const raw = source.slice(start, endIndex);
    const leading = raw.length - raw.trimStart().length;

    parts.push({ offset: start + leading, text: raw.trim() });
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || !source.startsWith(separator, index)) {
      continue;
    }

    pushPart(index);
    index += separator.length - 1;
    start = index + 1;
  }

  pushPart(source.length);

  return parts;
}

interface ArrowSplitResult {
  keyPart: TopLevelPart;
  valuePart: TopLevelPart | null;
}

/**
 * Splits `source` at its FIRST top-level `=>` only - unlike
 * `splitTopLevelParts`, which would split on EVERY top-level `=>` and so
 * truncate a value that itself contains one (an arrow function
 * `fn($x) => $x + 1`, a nested `key => value` sub-array). Everything from
 * just past the first arrow to the end becomes the (untrimmed-offset-exact)
 * value part.
 */
function splitFirstTopLevelArrow(source: string): ArrowSplitResult {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || !source.startsWith("=>", index)) {
      continue;
    }

    return {
      keyPart: trimmedTopLevelPart(source, 0, index),
      valuePart: trimmedTopLevelPart(source, index + 2, source.length),
    };
  }

  return {
    keyPart: trimmedTopLevelPart(source, 0, source.length),
    valuePart: null,
  };
}

function trimmedTopLevelPart(
  source: string,
  start: number,
  end: number,
): TopLevelPart {
  const raw = source.slice(start, end);
  const leading = raw.length - raw.trimStart().length;

  return { offset: start + leading, text: raw.trim() };
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }

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

function stringLiteralValue(source: string): string | null {
  const trimmed = source.trim();
  const quote = trimmed[0];

  if (quote !== "'" && quote !== '"') {
    return null;
  }

  if (trimmed.length < 2 || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }

  const value = trimmed.slice(1, -1);

  if (quote === '"' && /\$[A-Za-z_{]/.test(value)) {
    return null;
  }

  return value;
}

function isSafeVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function normalizeType(type: string): string | null {
  const normalized = type.trim().replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

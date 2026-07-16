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
 * Every binding's `viewName` is `"<Owner>:<action>"` where:
 *   - `<Owner>` is the class short name with a trailing `Presenter`/`Control`
 *     suffix stripped (`ProductPresenter` -> `Product`), matching the Nette link
 *     target convention. The controller pairs it with a template file through
 *     `nettePathResolution`.
 *   - `<action>` is derived from the assigning method:
 *       * `renderShow` / `actionShow`  -> `show` (first letter lowercased).
 *       * `renderDefault` / `actionDefault` -> `default`.
 *       * control `render()` -> `default` (the colocated component template).
 *       * bare `render()` / `action()`, `startup`, `beforeRender`, or any other
 *         presenter/helper method -> `*` (a WILDCARD action: the variable
 *         applies to EVERY action of that presenter, because these run for all
 *         actions and the concrete action cannot be known statically).
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
 * `$template = $this->template`); `template->add(` catches the Nette
 * `DefaultTemplate::add()` helper used in older CRM modules; `setParameters(`
 * matches the array form. `function render` / `function action` discover
 * parameter-only presenters whose action/render parameters are still part of
 * the Latte context. Owned here (not the controller) so view-data knowledge
 * stays framework-owned, mirroring Laravel's `laravelViewDataSearchQueries`.
 */
export const NETTE_VIEW_DATA_SEARCH_QUERIES: readonly string[] = [
  "->template->",
  "template->add(",
  "setParameters(",
  "function render",
  "function action",
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
  methodStart: number;
  methodName: string;
  parameters: string;
  parametersOffset: number;
}

interface NetteViewDataSighting {
  offset: number;
  variable: PhpFrameworkViewDataVariable;
  viewName: string;
}

export type NetteViewOwnerKind = "presenter" | "control";

export interface NetteViewOwner {
  kind: NetteViewOwnerKind;
  name: string;
}

/** View data contributed by one inheritable Nette presenter lifecycle method. */
export interface NetteViewDataMethodFacts {
  action: string;
  callsParent: boolean;
  methodName: string;
  parentCallOffset: number | null;
  variables: PhpFrameworkViewDataVariable[];
}

/** Source-local facts used to compose presenter view data across inheritance. */
export interface NetteViewDataSourceFacts {
  methods: NetteViewDataMethodFacts[];
  owner: NetteViewOwner | null;
}

interface NetteViewOwnerRange {
  bodyEnd: number;
  bodyStart: number;
  owner: NetteViewOwner;
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
const TEMPLATE_ADD = new RegExp(
  TEMPLATE_RECEIVER + String.raw`\s*->\s*add\s*\(`,
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

/**
 * Extracts source-local lifecycle facts without flattening methods by action.
 * Empty methods are deliberately retained: an override with no assignments can
 * shadow inherited data unless it explicitly continues via `parent::method()`.
 */
export function netteViewDataSourceFactsFromSource(
  source: string,
): NetteViewDataSourceFacts {
  const ownerRange = netteViewOwnerRange(source);

  if (!ownerRange) {
    return { methods: [], owner: null };
  }

  const { owner } = ownerRange;
  const allRanges = presenterMethodRanges(source, owner.kind);
  const ranges = directOwnerMethodRanges(source, ownerRange, allRanges);
  const assignmentSightings = [
    ...propertyAssignmentSightings(source, allRanges, owner.name),
    ...addCallSightings(source, allRanges, owner.name),
    ...setParametersSightings(source, allRanges, owner.name),
  ];
  const methods: NetteViewDataMethodFacts[] = [];

  for (const range of ranges) {
    if (!isInheritedViewDataMethod(range.methodName)) {
      continue;
    }

    const sightings = [
      ...methodParameterSightings([range], owner.name),
      ...assignmentSightings.filter(
        (sighting) =>
          innermostMethodRange(sighting.offset, allRanges) === range,
      ),
    ].sort((left, right) => left.offset - right.offset);
    const variables = new Map<string, PhpFrameworkViewDataVariable>();

    for (const sighting of sightings) {
      variables.set(sighting.variable.name, sighting.variable);
    }

    const parentCallOffset = executableParentCallOffset(source, range);

    methods.push({
      action: range.action,
      callsParent: parentCallOffset !== null,
      methodName: range.methodName,
      parentCallOffset,
      variables: Array.from(variables.values()),
    });
  }

  return { methods, owner };
}

function directOwnerMethodRanges(
  source: string,
  ownerRange: NetteViewOwnerRange,
  ranges: readonly NetteMethodRange[],
): NetteMethodRange[] {
  const structuralSource = maskPhpCommentsAndStrings(source);

  return ranges.filter(
    (range) =>
      range.methodStart > ownerRange.bodyStart &&
      range.bodyEnd < ownerRange.bodyEnd &&
      braceDepthBetween(
        structuralSource,
        ownerRange.bodyStart + 1,
        range.methodStart,
      ) === 0,
  );
}

function braceDepthBetween(source: string, start: number, end: number): number {
  let depth = 0;

  for (let index = start; index < end; index += 1) {
    if (source[index] === "{") {
      depth += 1;
      continue;
    }

    if (source[index] === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth;
}

function isInheritedViewDataMethod(methodName: string): boolean {
  if (methodName === "startup" || methodName === "beforeRender") {
    return true;
  }

  return /^(?:action|render)[A-Z][A-Za-z0-9_]*$/.test(methodName);
}

function executableParentCallOffset(
  source: string,
  range: NetteMethodRange,
): number | null {
  const body = maskPhpCommentsAndStrings(
    source.slice(range.bodyStart + 1, range.bodyEnd),
  );
  const methodName = escapeRegExp(range.methodName);
  const pattern = new RegExp(
    String.raw`(?:^|[^$\\A-Za-z0-9_])(parent)\s*::\s*${methodName}\s*\(`,
    "i",
  );
  const match = pattern.exec(body);

  if (!match || match.index === undefined || !match[1]) {
    return null;
  }

  return range.bodyStart + 1 + match.index + match[0].indexOf(match[1]);
}

function netteViewDataBindings(source: string): PhpFrameworkViewDataBinding[] {
  const owner = netteViewOwner(source);

  if (!owner) {
    return [];
  }

  const ranges = presenterMethodRanges(source, owner.kind);
  const sightings = [
    ...propertyAssignmentSightings(source, ranges, owner.name),
    ...addCallSightings(source, ranges, owner.name),
    ...setParametersSightings(source, ranges, owner.name),
    ...methodParameterSightings(ranges, owner.name),
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

function methodParameterSightings(
  ranges: readonly NetteMethodRange[],
  presenterName: string,
): NetteViewDataSighting[] {
  const sightings: NetteViewDataSighting[] = [];

  for (const range of ranges) {
    if (!/^(?:render|action)[A-Z][A-Za-z0-9_]*$/.test(range.methodName)) {
      continue;
    }

    for (const parameter of methodParameters(range.parameters)) {
      if (!isSafeVariableName(parameter.name)) {
        continue;
      }

      const valueOffset = range.parametersOffset + parameter.variableOffset;

      sightings.push({
        offset: valueOffset,
        variable: {
          detail: "render/action parameter",
          name: `$${parameter.name}`,
          typeHint: parameter.type,
          valueExpression: `$${parameter.name}`,
          valueOffset,
        },
        viewName: `${presenterName}:${range.action}`,
      });
    }
  }

  return sightings;
}

function addCallSightings(
  source: string,
  ranges: readonly NetteMethodRange[],
  presenterName: string,
): NetteViewDataSighting[] {
  const sightings: NetteViewDataSighting[] = [];
  const structuralSource = maskPhpCommentsAndStrings(source);

  for (const match of structuralSource.matchAll(TEMPLATE_ADD)) {
    const callOffset = match.index ?? 0;
    const openParen = callOffset + match[0].length - 1;
    const closeParen = matchingBracketOffset(
      structuralSource,
      openParen,
      "(",
      ")",
    );

    if (closeParen === null) {
      continue;
    }

    const parts = splitTopLevelParts(source.slice(openParen + 1, closeParen), ",");
    const name = stringLiteralValue(parts[0]?.text ?? "");

    if (!name || !isSafeVariableName(name)) {
      continue;
    }

    const valuePart = parts[1];
    const valueExpression = valuePart?.text ?? "";

    if (!valuePart || valueExpression.length === 0) {
      continue;
    }

    const valueOffset = openParen + 1 + valuePart.offset;

    sightings.push({
      offset: callOffset,
      variable: viewDataVariable(
        source,
        name,
        "template add()",
        valueExpression,
        valueOffset,
      ),
      viewName: `${presenterName}:${actionForOffset(callOffset, ranges)}`,
    });
  }

  return sightings;
}

function propertyAssignmentSightings(
  source: string,
  ranges: readonly NetteMethodRange[],
  presenterName: string,
): NetteViewDataSighting[] {
  const sightings: NetteViewDataSighting[] = [];
  const structuralSource = maskPhpCommentsAndStrings(source);

  for (const match of structuralSource.matchAll(TEMPLATE_PROPERTY_ASSIGNMENT)) {
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
  const structuralSource = maskPhpCommentsAndStrings(source);

  for (const match of structuralSource.matchAll(TEMPLATE_SET_PARAMETERS)) {
    const callOffset = match.index ?? 0;
    const openParen = callOffset + match[0].length - 1;
    const closeParen = matchingBracketOffset(
      structuralSource,
      openParen,
      "(",
      ")",
    );

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
 * Cheap display type hint: direct `new X()` / `X::` expressions, bare
 * `$variable` values (local `@var`, previous assignment, `@param`, then method
 * parameter type), and `$this->property` values from typed/PHPDoc properties.
 * Any richer expression is left to the caller's expression-type inference via
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

  const expression = valueExpression.trim();
  const directType = directTypeForExpression(expression);

  if (directType) {
    return directType;
  }

  const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression);

  if (variableMatch?.[1]) {
    const before = source.slice(0, valueOffset);

    return (
      phpDocTypeForVariable(before, variableMatch[1]) ??
      assignmentTypeForVariable(before, variableMatch[1]) ??
      phpDocParamTypeForVariable(before, variableMatch[1]) ??
      methodParameterTypeForVariable(before, variableMatch[1])
    );
  }

  const propertyMatch = /^\$this\s*->\s*([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    expression,
  );

  if (propertyMatch?.[1]) {
    return thisPropertyTypeForName(source.slice(0, valueOffset), propertyMatch[1]);
  }

  return null;
}

function directTypeForExpression(expression: string): string | null {
  const match = /^(?:new\s+)?(\\?[A-Z][A-Za-z0-9_\\]*)\s*(?:::|->|\()/.exec(
    expression,
  );

  return match?.[1] ? normalizeType(match[1]) : null;
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

function phpDocParamTypeForVariable(
  source: string,
  variableName: string,
): string | null {
  const functionStart = lastFunctionStart(source);

  if (functionStart === null) {
    return null;
  }

  const docblock = precedingDocblock(source, functionStart);

  if (!docblock) {
    return null;
  }

  const pattern = new RegExp(
    String.raw`@param\s+([\\?A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]\s]*)\s+\$${escapeRegExp(
      variableName,
    )}\b`,
    "g",
  );
  let found: string | null = null;

  for (const match of docblock.matchAll(pattern)) {
    found = normalizeType(match[1] ?? "");
  }

  return found;
}

function methodParameterTypeForVariable(
  source: string,
  variableName: string,
): string | null {
  const signature = lastFunctionSignature(source);

  if (!signature) {
    return null;
  }

  for (const part of splitTopLevelParts(signature.parameters, ",")) {
    const pattern = new RegExp(
      String.raw`^(?:[\\?A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]]*\s+)?((?:\\?|\?)[\\A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]]*|[A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]]*)\s+(?:&\s*)?(?:\.\.\.\s*)?\$${escapeRegExp(
        variableName,
      )}\b`,
    );
    const match = pattern.exec(part.text);

    if (!match?.[1]) {
      continue;
    }

    const normalized = normalizeType(match[1]);

    if (normalized && normalized !== "function") {
      return normalized;
    }
  }

  return null;
}

function thisPropertyTypeForName(
  source: string,
  propertyName: string,
): string | null {
  const pattern = new RegExp(
    String.raw`\b(?:public|protected|private)\s+(?:static\s+)?(?:readonly\s+)?(?:(\??\\?[A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]]*)\s+)?\$${escapeRegExp(
      propertyName,
    )}\b`,
    "g",
  );
  let found: string | null = null;

  for (const match of source.matchAll(pattern)) {
    const docblock = precedingDocblock(source, match.index ?? 0);
    const phpDocType = docblock ? phpDocVarType(docblock) : null;
    const declaredType = normalizeType(match[1] ?? "");

    found = phpDocType ?? declaredType ?? found;
  }

  return found;
}

function phpDocVarType(docblock: string): string | null {
  const match =
    /@var\s+([\\?A-Za-z_][\\A-Za-z0-9_|&<>?,\[\]\s]*)/.exec(docblock);

  return match?.[1] ? normalizeType(match[1]) : null;
}

interface FunctionSignature {
  parameters: string;
  start: number;
}

function lastFunctionSignature(source: string): FunctionSignature | null {
  const pattern =
    /\b(?:(?:public|protected|private|final|abstract|static)\s+)*function\s+&?[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  let found: FunctionSignature | null = null;

  for (const match of source.matchAll(pattern)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    found = {
      parameters: source.slice(openParen + 1, closeParen),
      start: match.index ?? 0,
    };
  }

  return found;
}

function lastFunctionStart(source: string): number | null {
  return lastFunctionSignature(source)?.start ?? null;
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
 * Returns the FIRST view-owning class in `source` whose name ends with
 * `Presenter` / `Control`, or `null` when no such class exists. Conservative on
 * two fronts: an unrelated class declared earlier in the file (a `*Template`
 * entity, a helper service) is skipped rather than mistaken for the owner, and
 * an anonymous `new class extends X { ... }` expression is never matched at all
 * - `(?!extends\b|implements\b)` rejects a "class" token immediately followed
 * by `extends`/`implements` with no name in between, which is exactly the
 * anonymous-class shape.
 */
function netteViewOwner(source: string): NetteViewOwner | null {
  return netteViewOwnerRange(source)?.owner ?? null;
}

function netteViewOwnerRange(source: string): NetteViewOwnerRange | null {
  const structuralSource = maskPhpCommentsAndStrings(source);
  const pattern = /\bclass\s+(?!extends\b|implements\b)([A-Za-z_][A-Za-z0-9_]*)/g;

  for (const match of structuralSource.matchAll(pattern)) {
    const className = match[1] ?? "";
    let owner: NetteViewOwner | null = null;

    if (className.endsWith("Presenter")) {
      owner = {
        kind: "presenter",
        name: className.slice(0, -"Presenter".length),
      };
    }

    if (!owner && className.endsWith("Control")) {
      owner = {
        kind: "control",
        name: className.slice(0, -"Control".length),
      };
    }

    if (!owner) {
      continue;
    }

    const bodyStart = structuralSource.indexOf(
      "{",
      (match.index ?? 0) + match[0].length,
    );

    if (bodyStart === -1) {
      continue;
    }

    const bodyEnd = matchingBracketOffset(
      structuralSource,
      bodyStart,
      "{",
      "}",
    );

    if (bodyEnd === null) {
      continue;
    }

    return { bodyEnd, bodyStart, owner };
  }

  return null;
}

function presenterMethodRanges(
  source: string,
  ownerKind: NetteViewOwnerKind,
): NetteMethodRange[] {
  const ranges: NetteMethodRange[] = [];
  const structuralSource = maskPhpCommentsAndStrings(source);
  const pattern = /\bfunction\s+&?([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of structuralSource.matchAll(pattern)) {
    const parenOpen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const parenClose = matchingBracketOffset(
      structuralSource,
      parenOpen,
      "(",
      ")",
    );

    if (parenClose === null) {
      continue;
    }

    const bodyStart = structuralSource.indexOf("{", parenClose);

    if (
      bodyStart === -1 ||
      /[;}]/.test(structuralSource.slice(parenClose + 1, bodyStart))
    ) {
      continue;
    }

    const bodyEnd = matchingBracketOffset(
      structuralSource,
      bodyStart,
      "{",
      "}",
    );

    if (bodyEnd === null) {
      continue;
    }

    ranges.push({
      action: actionFromMethodName(match[1] ?? "", ownerKind),
      bodyEnd,
      bodyStart,
      methodStart: match.index ?? 0,
      methodName: match[1] ?? "",
      parameters: source.slice(parenOpen + 1, parenClose),
      parametersOffset: parenOpen + 1,
    });
  }

  return ranges;
}

/** Replaces comments and quoted text with spaces while preserving byte offsets. */
function maskPhpCommentsAndStrings(source: string): string {
  const masked = source.split("");
  let index = 0;

  const maskThrough = (end: number) => {
    while (index < end) {
      if (masked[index] !== "\n" && masked[index] !== "\r") {
        masked[index] = " ";
      }

      index += 1;
    }
  };

  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (character === "?" && next === ">") {
      const phpOpen = source.indexOf("<?", index + 2);

      if (phpOpen === -1) {
        maskThrough(source.length);
        continue;
      }

      const openingTag = /^<\?php\b/i.exec(source.slice(phpOpen));
      const openEnd = openingTag
        ? phpOpen + openingTag[0].length
        : phpOpen + (source[phpOpen + 2] === "=" ? 3 : 2);

      maskThrough(openEnd);
      continue;
    }

    if (source.startsWith("<<<", index)) {
      const heredoc = /^<<<[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))[^\r\n]*(?:\r?\n|$)/.exec(
        source.slice(index),
      );
      const label = heredoc?.[1] ?? heredoc?.[2] ?? heredoc?.[3];

      if (heredoc && label) {
        const contentStart = index + heredoc[0].length;
        const closingPattern = new RegExp(
          String.raw`^[ \t]*${escapeRegExp(label)}[;,]?[ \t]*(?:\r?\n|$)`,
          "gm",
        );
        closingPattern.lastIndex = contentStart;
        const closing = closingPattern.exec(source);

        maskThrough(closing ? closing.index + closing[0].length : source.length);
        continue;
      }
    }

    if (character === "/" && next === "/") {
      const lineEnd = source.indexOf("\n", index + 2);
      maskThrough(lineEnd === -1 ? source.length : lineEnd);
      continue;
    }

    if (character === "#" && next !== "[") {
      const lineEnd = source.indexOf("\n", index + 1);
      maskThrough(lineEnd === -1 ? source.length : lineEnd);
      continue;
    }

    if (character === "/" && next === "*") {
      const commentEnd = source.indexOf("*/", index + 2);
      maskThrough(commentEnd === -1 ? source.length : commentEnd + 2);
      continue;
    }

    if (character !== "'" && character !== '"' && character !== "`") {
      index += 1;
      continue;
    }

    const quote = character;
    masked[index] = " ";
    index += 1;

    while (index < source.length) {
      const quotedCharacter = source[index] ?? "";

      if (quotedCharacter === "\\") {
        masked[index] = " ";
        index += 1;

        if (index < source.length) {
          masked[index] = " ";
          index += 1;
        }

        continue;
      }

      masked[index] =
        quotedCharacter === "\n" || quotedCharacter === "\r"
          ? quotedCharacter
          : " ";
      index += 1;

      if (quotedCharacter === quote) {
        break;
      }
    }
  }

  return masked.join("");
}

interface MethodParameter {
  name: string;
  type: string | null;
  variableOffset: number;
}

function methodParameters(parameters: string): MethodParameter[] {
  const parsed: MethodParameter[] = [];
  const structuralParameters = maskPhpCommentsAndStrings(parameters);

  for (const part of splitTopLevelParts(structuralParameters, ",")) {
    const withoutDefault = stripParameterDefault(part.text).trim();
    const variableMatch = /\$(\w+)\b/.exec(withoutDefault);

    if (!variableMatch?.[1] || variableMatch.index === undefined) {
      continue;
    }

    const beforeVariable = withoutDefault.slice(0, variableMatch.index).trim();
    const type = methodParameterType(beforeVariable);

    parsed.push({
      name: variableMatch[1],
      type,
      variableOffset:
        part.offset + part.text.indexOf(variableMatch[0], variableMatch.index),
    });
  }

  return parsed;
}

function stripParameterDefault(parameter: string): string {
  let depth = 0;
  let quote: "'" | '"' | null = null;

  for (let index = 0; index < parameter.length; index += 1) {
    const character = parameter[index] ?? "";

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

    if (character === "=" && depth === 0) {
      return parameter.slice(0, index);
    }
  }

  return parameter;
}

function methodParameterType(beforeVariable: string): string | null {
  const withoutPromotedVisibility = beforeVariable
    .replace(/\b(?:public|protected|private|readonly)\s+/g, "")
    .replace(/&\s*$/, "")
    .replace(/\.\.\.\s*$/, "")
    .trim();

  if (!withoutPromotedVisibility) {
    return null;
  }

  const type = normalizeType(withoutPromotedVisibility);

  return type && type !== "function" ? type : null;
}

function actionFromMethodName(
  name: string,
  ownerKind: NetteViewOwnerKind,
): string {
  const match = /^(?:render|action)([A-Z][A-Za-z0-9_]*)$/.exec(name);
  const suffix = match?.[1] ?? "";

  if (!suffix) {
    if (ownerKind === "control" && name === "render") {
      return "default";
    }

    return "*";
  }

  return suffix[0].toLowerCase() + suffix.slice(1);
}

function actionForOffset(
  offset: number,
  ranges: readonly NetteMethodRange[],
): string {
  return innermostMethodRange(offset, ranges)?.action ?? "*";
}

function innermostMethodRange(
  offset: number,
  ranges: readonly NetteMethodRange[],
): NetteMethodRange | null {
  let enclosing: NetteMethodRange | null = null;

  for (const range of ranges) {
    if (offset < range.bodyStart || offset >= range.bodyEnd) {
      continue;
    }

    if (!enclosing || range.bodyEnd - range.bodyStart < enclosing.bodyEnd - enclosing.bodyStart) {
      enclosing = range;
    }
  }

  return enclosing;
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

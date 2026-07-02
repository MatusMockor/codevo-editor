import { isUsableLaravelViewName } from "./phpLaravelViews";

export interface PhpLaravelViewVariable {
  detail: string;
  name: string;
  typeHint: string | null;
  /**
   * The PHP expression whose value the controller passes for this variable
   * (e.g. `$invoice`, `$this->connectedUseraccount`, `new Invoice()`), or
   * `null` when no single value expression is statically known (compact()
   * without a matching local, dynamic spreads, …). Consumers can feed it to a
   * full expression-type resolver for PhpStorm-grade inference.
   */
  valueExpression: string | null;
  /**
   * Absolute offset of `valueExpression` in the source (scope anchor for
   * position-aware type resolution), or `null` when there is no expression.
   */
  valueOffset: number | null;
}

export interface PhpLaravelViewDataBinding {
  variables: PhpLaravelViewVariable[];
  viewName: string;
}

interface ViewCallSpan {
  closeParen: number;
  dataExpression: string | null;
  dataExpressionOffset: number | null;
  end: number;
  start: number;
  viewName: string;
}

interface TopLevelPart {
  /** Absolute offset of the trimmed part text within the split input. */
  offset: number;
  text: string;
}

export function phpLaravelViewDataBindings(
  source: string,
): PhpLaravelViewDataBinding[] {
  const bindings: PhpLaravelViewDataBinding[] = [];

  for (const call of viewCallSpans(source)) {
    const variables = new Map<string, PhpLaravelViewVariable>();

    for (const variable of variablesFromDataExpression(
      source,
      call.dataExpression,
      call.dataExpressionOffset,
    )) {
      variables.set(variable.name, variable);
    }

    for (const variable of variablesFromWithChain(source, call.closeParen)) {
      variables.set(variable.name, variable);
    }

    if (variables.size === 0) {
      continue;
    }

    bindings.push({
      variables: Array.from(variables.values()),
      viewName: call.viewName,
    });
  }

  return bindings;
}

export function phpLaravelViewVariablesForView(
  source: string,
  viewName: string,
): PhpLaravelViewVariable[] {
  const variables = new Map<string, PhpLaravelViewVariable>();

  for (const binding of phpLaravelViewDataBindings(source)) {
    if (binding.viewName !== viewName) {
      continue;
    }

    for (const variable of binding.variables) {
      variables.set(variable.name, variable);
    }
  }

  return Array.from(variables.values()).sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

function viewCallSpans(source: string): ViewCallSpan[] {
  const spans: ViewCallSpan[] = [];
  const callPattern =
    /\b(?:view|View\s*::\s*make|response\s*\(\s*\)\s*->\s*view|view\s*\(\s*\)\s*->\s*make)\s*\(/g;

  for (const match of source.matchAll(callPattern)) {
    const openParen = (match.index ?? 0) + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const args = source.slice(openParen + 1, closeParen);
    const parts = splitTopLevelParts(args, ",");
    const viewName = stringLiteralValue(parts[0]?.text ?? "");

    if (!viewName || !isUsableLaravelViewName(viewName)) {
      continue;
    }

    const dataPart = parts[1] ?? null;

    spans.push({
      closeParen,
      dataExpression: dataPart?.text ?? null,
      dataExpressionOffset: dataPart ? openParen + 1 + dataPart.offset : null,
      end: closeParen + 1,
      start: match.index ?? 0,
      viewName,
    });
  }

  return spans;
}

function variablesFromDataExpression(
  source: string,
  expression: string | null,
  expressionOffset: number | null,
): PhpLaravelViewVariable[] {
  if (!expression || expressionOffset === null) {
    return [];
  }

  const compactVariables = compactVariableNames(expression).map((name) =>
    viewDataVariable(
      source,
      name,
      "view data compact()",
      `$${name}`,
      expressionOffset,
    ),
  );

  if (compactVariables.length > 0) {
    return compactVariables;
  }

  const arrayVariables = variablesFromAssociativeArray(
    source,
    expression,
    expressionOffset,
    "view data",
  );

  if (arrayVariables.length > 0) {
    return arrayVariables;
  }

  return variablesFromArrayVariableExpression(source, expression, expressionOffset);
}

function variablesFromWithChain(
  source: string,
  closeParen: number,
): PhpLaravelViewVariable[] {
  const variables: PhpLaravelViewVariable[] = [];
  let cursor = closeParen + 1;

  while (source.slice(cursor).match(/^\s*->\s*with\s*\(/)) {
    const match = /^\s*->\s*with\s*\(/.exec(source.slice(cursor));

    if (!match) {
      break;
    }

    const openParen = cursor + match[0].lastIndexOf("(");
    const chainCloseParen = matchingBracketOffset(source, openParen, "(", ")");

    if (chainCloseParen === null) {
      break;
    }

    const args = source.slice(openParen + 1, chainCloseParen);
    const parts = splitTopLevelParts(args, ",");
    const name = stringLiteralValue(parts[0]?.text ?? "");

    if (name && isSafeBladeVariableName(name)) {
      const valuePart = parts[1] ?? null;

      variables.push(
        viewDataVariable(
          source,
          name,
          "view data with()",
          valuePart && valuePart.text.length > 0 ? valuePart.text : null,
          valuePart && valuePart.text.length > 0
            ? openParen + 1 + valuePart.offset
            : null,
        ),
      );
      cursor = chainCloseParen + 1;
      continue;
    }

    const arrayPart = parts[0] ?? null;

    if (arrayPart) {
      variables.push(
        ...variablesFromAssociativeArray(
          source,
          arrayPart.text,
          openParen + 1 + arrayPart.offset,
          "view data with()",
        ),
      );
    }

    cursor = chainCloseParen + 1;
  }

  return variables;
}

function variablesFromAssociativeArray(
  source: string,
  expression: string,
  expressionOffset: number,
  detail: string,
): PhpLaravelViewVariable[] {
  const trimmed = expression.trim();

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  const openBracket = expression.indexOf("[");
  const body = trimmed.slice(1, -1);
  const bodyOffset = expressionOffset + openBracket + 1;
  const variables: PhpLaravelViewVariable[] = [];

  for (const entry of splitTopLevelParts(body, ",")) {
    const entryParts = splitTopLevelParts(entry.text, "=>");
    const keyPart = entryParts[0] ?? null;
    const valuePart = entryParts[1] ?? null;
    const name = stringLiteralValue(keyPart?.text ?? "");

    if (!name || !isSafeBladeVariableName(name)) {
      continue;
    }

    const valueExpression =
      valuePart && valuePart.text.length > 0 ? valuePart.text : null;
    const valueOffset =
      valuePart && valueExpression
        ? bodyOffset + entry.offset + valuePart.offset
        : null;

    variables.push(
      viewDataVariable(source, name, detail, valueExpression, valueOffset),
    );
  }

  return variables;
}

/**
 * Supports the "array variable" controller idiom that dominates real Laravel
 * codebases (kontentino toolbox et al.):
 *
 *   $viewVariables = ['a' => $b];
 *   $viewVariables['useraccount'] = $userAccount;
 *   return view('tools.search_account', $viewVariables);
 *
 * Only a bare `$variable` data expression is considered, and only assignments
 * BETWEEN the enclosing named function start and the view call contribute, so
 * unrelated methods reusing the same array name never leak variables into the
 * wrong view (conservative by construction).
 */
function variablesFromArrayVariableExpression(
  source: string,
  expression: string,
  expressionOffset: number,
): PhpLaravelViewVariable[] {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression.trim());

  if (!match?.[1]) {
    return [];
  }

  const arrayVariableName = match[1];
  const scopeStart = enclosingNamedFunctionStart(source, expressionOffset);
  const variables = new Map<string, PhpLaravelViewVariable>();

  for (const inline of arrayVariableInlineAssignments(
    source,
    arrayVariableName,
    scopeStart,
    expressionOffset,
  )) {
    for (const variable of variablesFromAssociativeArray(
      source,
      inline.expression,
      inline.offset,
      "view data",
    )) {
      variables.set(variable.name, variable);
    }
  }

  for (const element of arrayVariableElementAssignments(
    source,
    arrayVariableName,
    scopeStart,
    expressionOffset,
  )) {
    if (!isSafeBladeVariableName(element.name)) {
      continue;
    }

    variables.set(
      `$${element.name}`,
      viewDataVariable(
        source,
        element.name,
        "view data",
        element.valueExpression,
        element.valueOffset,
      ),
    );
  }

  return Array.from(variables.values());
}

interface ArrayVariableInlineAssignment {
  /** The `[ ... ]` literal expression assigned to the array variable. */
  expression: string;
  /** Absolute offset of the `[` in the source. */
  offset: number;
}

function arrayVariableInlineAssignments(
  source: string,
  arrayVariableName: string,
  scopeStart: number,
  beforeOffset: number,
): ArrayVariableInlineAssignment[] {
  const assignments: ArrayVariableInlineAssignment[] = [];
  const pattern = new RegExp(
    String.raw`\$${escapeRegExp(arrayVariableName)}\s*=(?!=)\s*\[`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index < scopeStart || index >= beforeOffset) {
      continue;
    }

    const bracketStart = index + match[0].length - 1;
    const bracketEnd = matchingBracketOffset(source, bracketStart, "[", "]");

    if (bracketEnd === null || bracketEnd >= beforeOffset) {
      continue;
    }

    assignments.push({
      expression: source.slice(bracketStart, bracketEnd + 1),
      offset: bracketStart,
    });
  }

  return assignments;
}

interface ArrayVariableElementAssignment {
  name: string;
  valueExpression: string;
  valueOffset: number;
}

function arrayVariableElementAssignments(
  source: string,
  arrayVariableName: string,
  scopeStart: number,
  beforeOffset: number,
): ArrayVariableElementAssignment[] {
  const assignments: ArrayVariableElementAssignment[] = [];
  const pattern = new RegExp(
    String.raw`\$${escapeRegExp(arrayVariableName)}\s*\[\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\]\s*=(?!=)\s*`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index < scopeStart || index >= beforeOffset) {
      continue;
    }

    const name = stringLiteralValue(match[1] ?? "");

    if (!name) {
      continue;
    }

    const valueStart = index + match[0].length;
    const valueEnd = topLevelStatementEnd(source, valueStart);

    if (valueEnd === null || valueEnd > beforeOffset) {
      continue;
    }

    const valueExpression = source.slice(valueStart, valueEnd).trim();

    if (!valueExpression) {
      continue;
    }

    assignments.push({ name, valueExpression, valueOffset: valueStart });
  }

  return assignments;
}

/**
 * Returns the offset of the last named `function` declaration before
 * `beforeOffset`, or 0 when there is none. Anonymous closures are ignored so a
 * callback between the assignments and the view call does not truncate the
 * scope.
 */
function enclosingNamedFunctionStart(
  source: string,
  beforeOffset: number,
): number {
  let scopeStart = 0;
  const pattern = /\bfunction\s+&?[A-Za-z_][A-Za-z0-9_]*\s*\(/g;

  for (const match of source.matchAll(pattern)) {
    const index = match.index ?? 0;

    if (index >= beforeOffset) {
      break;
    }

    scopeStart = index;
  }

  return scopeStart;
}

/**
 * Returns the offset of the `;` that terminates the statement starting at
 * `start` (tracking quotes and bracket nesting), or `null` when the statement
 * never closes.
 */
function topLevelStatementEnd(source: string, start: number): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

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

    if (character === "'" || character === "\"") {
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

function compactVariableNames(expression: string): string[] {
  const match = /^\s*compact\s*\(([\s\S]*)\)\s*$/.exec(expression);

  if (!match?.[1]) {
    return [];
  }

  return splitTopLevel(match[1], ",")
    .map((part) => stringLiteralValue(part))
    .filter((name): name is string => Boolean(name && isSafeBladeVariableName(name)));
}

function viewDataVariable(
  source: string,
  name: string,
  detail: string,
  valueExpression: string | null,
  valueOffset: number | null,
): PhpLaravelViewVariable {
  return {
    detail,
    name: `$${name}`,
    typeHint: typeHintForViewVariable(source, name, valueExpression, valueOffset),
    valueExpression,
    valueOffset,
  };
}

/**
 * Cheap display-oriented type hint: first the classic lookup keyed by the
 * Blade variable name, then - when the passed value is a plain `$variable`
 * with a DIFFERENT name (`['useraccount' => $userAccount]`) - the lookup keyed
 * by the value variable. Deep expression inference is delegated to the
 * consumer via `valueExpression`/`valueOffset`.
 */
function typeHintForViewVariable(
  source: string,
  name: string,
  valueExpression: string | null,
  valueOffset: number | null,
): string | null {
  const direct = typeHintForVariable(source, name);

  if (direct) {
    return direct;
  }

  const valueVariableName = valueExpression
    ? /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(valueExpression)?.[1] ?? null
    : null;

  if (!valueVariableName || valueVariableName === name) {
    return null;
  }

  return typeHintForVariable(source, valueVariableName, valueOffset ?? source.length);
}

function typeHintForVariable(
  source: string,
  variableName: string,
  beforeOffset = source.length,
): string | null {
  const before = source.slice(0, beforeOffset);
  const phpDocType = phpDocTypeForVariable(before, variableName);

  if (phpDocType) {
    return phpDocType;
  }

  return assignmentTypeForVariable(before, variableName);
}

function phpDocTypeForVariable(source: string, variableName: string): string | null {
  const pattern = new RegExp(
    String.raw`@var\s+([\\?A-Za-z_][\\A-Za-z0-9_|&<>?,\s]*)\s+\$${escapeRegExp(variableName)}\b`,
    "g",
  );
  let found: string | null = null;

  for (const match of source.matchAll(pattern)) {
    found = normalizeTypeHint(match[1] ?? "");
  }

  return found;
}

function assignmentTypeForVariable(
  source: string,
  variableName: string,
): string | null {
  const pattern = new RegExp(
    String.raw`\$${escapeRegExp(variableName)}\s*=(?!=)\s*(?:new\s+)?(\\?[A-Z][A-Za-z0-9_\\]*)\s*(?:::|->|\()`,
    "g",
  );
  let found: string | null = null;

  for (const match of source.matchAll(pattern)) {
    found = normalizeTypeHint(match[1] ?? "");
  }

  return found;
}

function normalizeTypeHint(typeHint: string): string | null {
  const normalized = typeHint.trim().replace(/\s+/g, " ");

  return normalized.length > 0 ? normalized : null;
}

function isSafeBladeVariableName(name: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name);
}

function stringLiteralValue(source: string): string | null {
  const trimmed = source.trim();
  const quote = trimmed[0];

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  if (trimmed.length < 2 || trimmed[trimmed.length - 1] !== quote) {
    return null;
  }

  const value = trimmed.slice(1, -1);

  if (quote === "\"" && /\$[A-Za-z_{]/.test(value)) {
    return null;
  }

  return value;
}

function splitTopLevel(source: string, separator: "," | "=>"): string[] {
  return splitTopLevelParts(source, separator).map((part) => part.text);
}

function splitTopLevelParts(
  source: string,
  separator: "," | "=>",
): TopLevelPart[] {
  const parts: TopLevelPart[] = [];
  let depth = 0;
  let start = 0;
  let quote: "'" | "\"" | null = null;

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

    if (character === "'" || character === "\"") {
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

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

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

    if (character === "'" || character === "\"") {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

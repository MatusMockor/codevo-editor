import { isUsableLaravelViewName } from "./phpLaravelViews";

export interface PhpLaravelViewVariable {
  detail: string;
  name: string;
  typeHint: string | null;
}

export interface PhpLaravelViewDataBinding {
  variables: PhpLaravelViewVariable[];
  viewName: string;
}

interface ViewCallSpan {
  closeParen: number;
  dataExpression: string | null;
  end: number;
  start: number;
  viewName: string;
}

export function phpLaravelViewDataBindings(
  source: string,
): PhpLaravelViewDataBinding[] {
  const bindings: PhpLaravelViewDataBinding[] = [];

  for (const call of viewCallSpans(source)) {
    const variables = new Map<string, PhpLaravelViewVariable>();

    for (const variable of variablesFromDataExpression(source, call.dataExpression)) {
      variables.set(variable.name, variable);
    }

    for (const variable of variablesFromWithChain(source, call.closeParen)) {
      variables.set(variable.name, variable);
    }

    if (variables.size === 0) {
      continue;
    }

    bindings.push({
      variables: Array.from(variables.values()).map((variable) => ({
        ...variable,
        typeHint: variable.typeHint ?? typeHintForVariable(source, variable.name, call.start),
      })),
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
    const parts = splitTopLevel(args, ",");
    const viewName = stringLiteralValue(parts[0] ?? "");

    if (!viewName || !isUsableLaravelViewName(viewName)) {
      continue;
    }

    spans.push({
      closeParen,
      dataExpression: parts[1]?.trim() ?? null,
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
): PhpLaravelViewVariable[] {
  if (!expression) {
    return [];
  }

  const compactVariables = compactVariableNames(expression).map((name) =>
    viewVariable(source, name, "view data compact()"),
  );

  if (compactVariables.length > 0) {
    return compactVariables;
  }

  return variablesFromAssociativeArray(source, expression, "view data");
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
    const parts = splitTopLevel(args, ",");
    const name = stringLiteralValue(parts[0] ?? "");

    if (name && isSafeBladeVariableName(name)) {
      variables.push(viewVariable(source, name, "view data with()"));
      cursor = chainCloseParen + 1;
      continue;
    }

    variables.push(
      ...variablesFromAssociativeArray(source, parts[0] ?? "", "view data with()"),
    );
    cursor = chainCloseParen + 1;
  }

  return variables;
}

function variablesFromAssociativeArray(
  source: string,
  expression: string,
  detail: string,
): PhpLaravelViewVariable[] {
  const trimmed = expression.trim();

  if (!trimmed.startsWith("[") || !trimmed.endsWith("]")) {
    return [];
  }

  const body = trimmed.slice(1, -1);
  const variables: PhpLaravelViewVariable[] = [];

  for (const entry of splitTopLevel(body, ",")) {
    const [key] = splitTopLevel(entry, "=>");
    const name = stringLiteralValue(key ?? "");

    if (!name || !isSafeBladeVariableName(name)) {
      continue;
    }

    variables.push(viewVariable(source, name, detail));
  }

  return variables;
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

function viewVariable(
  source: string,
  name: string,
  detail: string,
): PhpLaravelViewVariable {
  return {
    detail,
    name: `$${name}`,
    typeHint: typeHintForVariable(source, name),
  };
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
    String.raw`\$${escapeRegExp(variableName)}\s*=\s*(?:new\s+)?(\\?[A-Z][A-Za-z0-9_\\]*)\s*(?:::|->|\()`,
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

  if (trimmed[trimmed.length - 1] !== quote) {
    return null;
  }

  const value = trimmed.slice(1, -1);

  if (quote === "\"" && /\$[A-Za-z_{]/.test(value)) {
    return null;
  }

  return value;
}

function splitTopLevel(source: string, separator: "," | "=>"): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  let quote: "'" | "\"" | null = null;

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

    parts.push(source.slice(start, index).trim());
    index += separator.length - 1;
    start = index + 1;
  }

  parts.push(source.slice(start).trim());

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

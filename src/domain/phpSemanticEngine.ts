import type { EditorPosition } from "./languageServerFeatures";
import { phpParameterTypeForVariable } from "./phpNavigation";

export interface PhpMethodCallExpression {
  methodName: string;
  receiverExpression: string;
}

export interface PhpStaticCallExpression {
  className: string;
  methodName: string;
}

export function phpCurrentClassName(source: string): string | null {
  const classMatch = /\b(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
    source,
  );

  if (!classMatch?.[1]) {
    return null;
  }

  const namespaceMatch = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  const namespace = namespaceMatch?.[1]?.trim().replace(/^\\+/, "");

  return namespace ? `${namespace}\\${classMatch[1]}` : classMatch[1];
}

export function phpReceiverExpressionTypeInSource(
  source: string,
  position: EditorPosition,
  receiverExpression: string,
): string | null {
  const normalizedExpression = normalizeReceiverExpression(receiverExpression);

  if (normalizedExpression === "$this") {
    return phpCurrentClassName(source);
  }

  const thisPropertyMatch = /^\$this->([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    normalizedExpression,
  );

  if (thisPropertyMatch?.[1]) {
    return phpThisPropertyType(source, thisPropertyMatch[1]);
  }

  const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    normalizedExpression,
  );

  if (!variableMatch?.[1]) {
    return null;
  }

  return phpVariableTypeInSource(source, position, variableMatch[1]);
}

export function phpVariableTypeInSource(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  return (
    phpParameterTypeForVariable(source, position, variableName) ??
    phpDocTypeForVariableBefore(source, position, variableName) ??
    phpNewExpressionClassName(
      phpAssignmentExpressionForVariableBefore(source, position, variableName) ?? "",
    ) ??
    phpLaravelContainerExpressionClassName(
      phpAssignmentExpressionForVariableBefore(source, position, variableName) ?? "",
    )
  );
}

export function phpThisPropertyType(
  source: string,
  propertyName: string,
): string | null {
  return (
    phpPromotedPropertyType(source, propertyName) ??
    phpDeclaredPropertyType(source, propertyName) ??
    phpDocTypeForProperty(source, propertyName)
  );
}

export function phpAssignmentExpressionForVariableBefore(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const before = source.slice(0, offset);
  const pattern = new RegExp(
    `\\$${escapeRegExp(variableName)}\\s*=\\s*([^;\\n]+)`,
    "g",
  );
  let expression: string | null = null;

  for (const match of before.matchAll(pattern)) {
    expression = match[1]?.trim() || null;
  }

  return expression;
}

export function phpNewExpressionClassName(expression: string): string | null {
  const match =
    /^new\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\b(?:\s*\([^)]*\))?\s*$/.exec(
      expression.trim(),
    );

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

export function phpLaravelContainerExpressionClassName(
  expression: string,
): string | null {
  const normalized = expression.trim();
  const match =
    /^(?:app|resolve|make)\s*\(\s*((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)::class\b/.exec(
      normalized,
    ) ??
    /->make\s*\(\s*((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)::class\b/.exec(
      normalized,
    );

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

export function phpMethodCallExpression(
  expression: string,
): PhpMethodCallExpression | null {
  const match =
    /^((?:new\s+(?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*\s*\([^)]*\)|\$[A-Za-z_][A-Za-z0-9_]*|\$this)(?:\s*->\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?)*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
      expression.trim(),
    );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    methodName: match[2],
    receiverExpression: normalizeReceiverExpression(match[1]),
  };
}

export function phpMethodReturnExpressions(
  source: string,
  methodName: string,
): string[] {
  const pattern = new RegExp(
    `\\bfunction\\s+&?\\s*${escapeRegExp(methodName)}\\s*\\(`,
    "g",
  );
  const expressions: string[] = [];

  for (const match of source.matchAll(pattern)) {
    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingPairOffset(source, parametersStart, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", parametersEnd);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    expressions.push(
      ...topLevelReturnExpressions(source.slice(bodyStart + 1, bodyEnd)),
    );
  }

  return expressions;
}

export function phpStaticCallExpression(
  expression: string,
): PhpStaticCallExpression | null {
  const match =
    /^((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
      expression.trim(),
    );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    className: match[1].replace(/^\\+/, ""),
    methodName: match[2],
  };
}

export function phpDocTypeForVariableBefore(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const before = source.slice(0, offset);
  const pattern = new RegExp(
    `\\/\\*\\*[\\s\\S]*?@var\\s+([^\\s*]+)\\s+\\$${escapeRegExp(
      variableName,
    )}\\b[\\s\\S]*?\\*\\/`,
    "g",
  );
  let typeName: string | null = null;

  for (const match of before.matchAll(pattern)) {
    typeName = phpDeclaredTypeCandidate(match[1] ?? "");
  }

  return typeName;
}

export function phpDeclaredTypeCandidate(typeName: string): string | null {
  const normalized = typeName
    .trim()
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .trim()
    .replace(/^\?/, "")
    .replace(/\[\]$/, "")
    .replace(/^\\+/, "");
  const candidate = normalized
    .split(/[|&]/)
    .map((part) => part.trim().replace(/^\\+/, ""))
    .find((part) => part && !isPhpBuiltinType(part));

  return candidate ?? null;
}

function phpPromotedPropertyType(
  source: string,
  propertyName: string,
): string | null {
  const constructorMatch = /\bfunction\s+__construct\s*\(([\s\S]*?)\)\s*[{;]/.exec(
    source,
  );

  if (!constructorMatch?.[1]) {
    return null;
  }

  for (const parameter of splitPhpList(constructorMatch[1])) {
    if (!/\b(?:public|protected|private)\b/.test(parameter)) {
      continue;
    }

    const variableIndex = parameter.search(
      new RegExp(`\\$${escapeRegExp(propertyName)}\\b`),
    );

    if (variableIndex < 0) {
      continue;
    }

    return phpDeclaredTypeCandidate(parameter.slice(0, variableIndex));
  }

  return null;
}

function phpDeclaredPropertyType(
  source: string,
  propertyName: string,
): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:public|protected|private)\\s+(?:readonly\\s+)?(?:static\\s+)?([^\\n;=]+?)\\s+\\$${escapeRegExp(
      propertyName,
    )}\\b`,
    "g",
  );
  let typeName: string | null = null;

  for (const match of source.matchAll(pattern)) {
    typeName = phpDeclaredTypeCandidate(match[1] ?? "");
  }

  return typeName;
}

function phpDocTypeForProperty(
  source: string,
  propertyName: string,
): string | null {
  const pattern = new RegExp(
    `\\/\\*\\*[\\s\\S]*?@var\\s+([^\\s*]+)[\\s\\S]*?\\*\\/\\s*(?:public|protected|private)?\\s+(?:readonly\\s+)?(?:static\\s+)?(?:[^\\n;=]+?\\s+)?\\$${escapeRegExp(
      propertyName,
    )}\\b`,
    "g",
  );
  let typeName: string | null = null;

  for (const match of source.matchAll(pattern)) {
    typeName = phpDeclaredTypeCandidate(match[1] ?? "");
  }

  return typeName;
}

function normalizeReceiverExpression(receiverExpression: string): string {
  return receiverExpression.replace(/\s*->\s*/g, "->").trim();
}

function splitPhpList(parameters: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < parameters.length; index += 1) {
    const character = parameters[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
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

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(parameters.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(parameters.slice(start).trim());
  return parts.filter(Boolean);
}

function topLevelReturnExpressions(body: string): string[] {
  const expressions: string[] = [];
  let quote: string | null = null;
  let depth = 0;

  for (const match of body.matchAll(/\breturn\b/g)) {
    const returnOffset = match.index ?? 0;

    if (!isTopLevelKeywordOffset(body, returnOffset)) {
      continue;
    }

    let start = returnOffset + match[0].length;

    while (/\s/.test(body[start] || "")) {
      start += 1;
    }

    quote = null;
    depth = 0;

    for (let index = start; index < body.length; index += 1) {
      const character = body[index] || "";

      if (quote) {
        if (character === "\\" && quote !== "`") {
          index += 1;
          continue;
        }

        if (character === quote) {
          quote = null;
        }

        continue;
      }

      if (character === "'" || character === "\"" || character === "`") {
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

      if (character !== ";" || depth > 0) {
        continue;
      }

      const expression = body.slice(start, index).trim();

      if (expression) {
        expressions.push(expression);
      }

      break;
    }
  }

  return expressions;
}

function isTopLevelKeywordOffset(source: string, offset: number): boolean {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth === 0;
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
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

function isPhpBuiltinType(typeName: string | undefined): boolean {
  return (
    !typeName ||
    [
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
    ].includes(typeName.toLowerCase())
  );
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let line = 1;
  let column = 1;

  for (let index = 0; index < source.length; index += 1) {
    if (line === position.lineNumber && column === position.column) {
      return index;
    }

    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return source.length;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

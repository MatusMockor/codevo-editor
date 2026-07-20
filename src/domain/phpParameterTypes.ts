import type { EditorPosition } from "./languageServerFeatures";

export function phpParameterTypeForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const parameterList = enclosingFunctionParameters(source, offset);

  if (!parameterList) {
    return null;
  }

  for (const parameter of splitPhpParameterList(parameterList)) {
    const variableIndex = parameter.search(
      new RegExp(`\\$${escapeRegExp(variableName)}\\b`),
    );

    if (variableIndex < 0) {
      continue;
    }

    const typeName = phpParameterType(parameter.slice(0, variableIndex));

    if (typeName) {
      return typeName;
    }
  }

  return null;
}

function enclosingFunctionParameters(
  source: string,
  offset: number,
): string | null {
  let parameters: string | null = null;

  for (const match of source.matchAll(
    /\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g,
  )) {
    const parametersStart = (match.index ?? 0) + match[0].length;

    if (parametersStart > offset) {
      continue;
    }

    const parametersEnd = matchingParenthesisOffset(
      source,
      parametersStart - 1,
    );

    if (!parametersEnd || parametersEnd > offset) {
      parameters = source.slice(parametersStart, parametersEnd || offset);
      continue;
    }

    parameters = source.slice(parametersStart, parametersEnd);
  }

  return parameters;
}

function matchingParenthesisOffset(
  source: string,
  openOffset: number,
): number | null {
  let depth = 0;
  let quote: string | null = null;

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

    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
}

function splitPhpParameterList(parameters: string): string[] {
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

    if (character === "'" || character === '"' || character === "`") {
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

function phpParameterType(beforeVariable: string): string | null {
  const typeSource = beforeVariable
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .trim();
  const typeParts = typeSource.split(/\s+/).filter(Boolean);
  const typeName = typeParts[typeParts.length - 1];

  if (!typeName) {
    return null;
  }

  const normalized = typeName
    .replace(/^\\+/, "")
    .replace(/^\?/, "")
    .split(/[|&]/)
    .find((candidate) => !isPhpBuiltinType(candidate));

  return normalized || null;
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
      "self",
      "static",
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

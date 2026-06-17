import type { EditorPosition } from "./languageServerFeatures";

export interface PhpVariableCompletion {
  detail: "parameter" | "local variable" | "instance";
  name: string;
}

interface VariableSeen {
  detail: PhpVariableCompletion["detail"];
  lastSeenOffset: number;
  name: string;
  priority: number;
}

export function phpVariableCompletionsAt(
  source: string,
  position: EditorPosition,
): PhpVariableCompletion[] {
  const offset = offsetAtPosition(source, position);
  const scope = enclosingFunctionScope(source, offset) ?? {
    parameters: "",
    startOffset: 0,
  };
  const visibleSource = source.slice(scope.startOffset, offset);
  const variables = new Map<string, VariableSeen>();

  for (const parameter of variableNamesIn(scope.parameters)) {
    rememberVariable(variables, parameter, {
      detail: "parameter",
      lastSeenOffset: scope.startOffset,
      priority: 0,
    });
  }

  for (const variable of variableMatches(visibleSource)) {
    rememberVariable(variables, variable.name, {
      detail: variables.get(variable.name)?.detail ?? "local variable",
      lastSeenOffset: scope.startOffset + variable.offset,
      priority: variables.get(variable.name)?.priority ?? 1,
    });
  }

  if (scope.startOffset > 0 && classDeclarationBefore(source, scope.startOffset)) {
    rememberVariable(variables, "$this", {
      detail: "instance",
      lastSeenOffset: scope.startOffset,
      priority: -1,
    });
  }

  return Array.from(variables.values())
    .filter((variable) => variable.name !== "$GLOBALS")
    .sort((left, right) => {
      if (left.priority !== right.priority) {
        return left.priority - right.priority;
      }

      return right.lastSeenOffset - left.lastSeenOffset;
    })
    .map(({ detail, name }) => ({ detail, name }));
}

function rememberVariable(
  variables: Map<string, VariableSeen>,
  name: string,
  metadata: Omit<VariableSeen, "name">,
) {
  const existing = variables.get(name);

  if (
    existing &&
    existing.priority <= metadata.priority &&
    existing.lastSeenOffset > metadata.lastSeenOffset
  ) {
    return;
  }

  variables.set(name, {
    ...metadata,
    name,
  });
}

function variableNamesIn(source: string): string[] {
  return variableMatches(source).map((variable) => variable.name);
}

function variableMatches(source: string): Array<{ name: string; offset: number }> {
  const masked = maskPhpStringsAndComments(source);
  const variables: Array<{ name: string; offset: number }> = [];

  for (const match of masked.matchAll(/\$[A-Za-z_][A-Za-z0-9_]*/g)) {
    variables.push({
      name: match[0],
      offset: match.index ?? 0,
    });
  }

  return variables;
}

function enclosingFunctionScope(
  source: string,
  offset: number,
): { parameters: string; startOffset: number } | null {
  let scope: { parameters: string; startOffset: number } | null = null;

  for (const match of source.matchAll(/\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g)) {
    const startOffset = match.index ?? 0;

    if (startOffset > offset) {
      continue;
    }

    const parametersStart = startOffset + match[0].length;
    const parametersEnd = matchingPairOffset(source, parametersStart - 1, "(", ")");

    if (!parametersEnd || parametersEnd > offset) {
      continue;
    }

    scope = {
      parameters: source.slice(parametersStart, parametersEnd),
      startOffset,
    };
  }

  return scope;
}

function classDeclarationBefore(source: string, offset: number): boolean {
  const before = source.slice(0, offset);
  const classMatch = /\b(?:class|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*\b/g;
  let found = false;

  for (const _match of before.matchAll(classMatch)) {
    found = true;
  }

  return found;
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
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

function maskPhpStringsAndComments(source: string): string {
  let masked = "";
  let quote: string | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        masked += "\n";
      } else {
        masked += " ";
      }
      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        masked += "  ";
        index += 1;
      } else {
        masked += character === "\n" ? "\n" : " ";
      }
      continue;
    }

    if (quote) {
      if (character === "\\" && quote !== "`") {
        masked += "  ";
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
      }

      masked += character === "\n" ? "\n" : " ";
      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      masked += "  ";
      index += 1;
      continue;
    }

    if (character === "#") {
      lineComment = true;
      masked += " ";
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      masked += "  ";
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      masked += " ";
      continue;
    }

    masked += character;
  }

  return masked;
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

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

interface VariableDeclaration {
  name: string;
  offset: number;
  priority: number;
}

interface PhpFunctionScope {
  bodyEnd: number;
  bodyStart: number;
  captures: string;
  capturesOuterVariables: boolean;
  isStatic: boolean;
  keywordStart: number;
  parameters: string;
}

export function phpVariableCompletionsAt(
  source: string,
  position: EditorPosition,
): PhpVariableCompletion[] {
  const offset = offsetAtPosition(source, position);
  const scopes = phpFunctionScopes(source);
  const scope = innermostFunctionScopeAt(scopes, offset);
  const variables = new Map<string, VariableSeen>();

  collectVisibleVariables(source, offset, scopes, scope, variables);

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

function collectVisibleVariables(
  source: string,
  offset: number,
  scopes: PhpFunctionScope[],
  scope: PhpFunctionScope | null,
  variables: Map<string, VariableSeen>,
): void {
  if (!scope) {
    rememberVariablesFromSource(source, 0, offset, scopes, null, variables);
    return;
  }

  if (scope.capturesOuterVariables) {
    collectVisibleVariables(
      source,
      scope.keywordStart,
      scopes,
      innermostFunctionScopeAt(scopes, Math.max(0, scope.keywordStart - 1)),
      variables,
    );
  }

  for (const parameter of variableNamesIn(scope.parameters)) {
    rememberVariable(variables, parameter, {
      detail: "parameter",
      lastSeenOffset: scope.bodyStart,
      priority: 0,
    });
  }

  for (const capture of variableNamesIn(scope.captures)) {
    rememberVariable(variables, capture, {
      detail: "local variable",
      lastSeenOffset: scope.bodyStart,
      priority: 0,
    });
  }

  rememberVariablesFromSource(
    source,
    scope.bodyStart,
    offset,
    scopes,
    scope,
    variables,
  );

  if (
    !scope.isStatic &&
    scope.bodyStart > 0 &&
    classDeclarationBefore(source, scope.bodyStart)
  ) {
    rememberVariable(variables, "$this", {
      detail: "instance",
      lastSeenOffset: scope.bodyStart,
      priority: -1,
    });
  }
}

function rememberVariablesFromSource(
  source: string,
  startOffset: number,
  endOffset: number,
  scopes: PhpFunctionScope[],
  currentScope: PhpFunctionScope | null,
  variables: Map<string, VariableSeen>,
): void {
  const visibleSource = maskNestedFunctionScopes(
    source,
    startOffset,
    endOffset,
    scopes,
    currentScope,
  );

  for (const variable of variableDeclarations(visibleSource)) {
    const existing = variables.get(variable.name);

    rememberVariable(variables, variable.name, {
      detail: existing?.detail ?? "local variable",
      lastSeenOffset: startOffset + variable.offset,
      priority: existing?.priority ?? variable.priority,
    });
  }
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

function variableDeclarations(
  source: string,
): VariableDeclaration[] {
  const masked = maskPhpStringsAndComments(source);
  const variables: VariableDeclaration[] = [];

  for (const match of masked.matchAll(
    /\$[A-Za-z_][A-Za-z0-9_]*\s*(?:=(?!=)|\+=|-=|\*=|\/=|\.=|%=|\?\?=)/g,
  )) {
    const name = match[0].match(/\$[A-Za-z_][A-Za-z0-9_]*/)?.[0] ?? "";

    if (name) {
      variables.push({
        name,
        offset: match.index ?? 0,
        priority: 3,
      });
    }
  }

  for (const match of masked.matchAll(
    /\bforeach\s*\([^)]*\bas\s+(\$[A-Za-z_][A-Za-z0-9_]*)(?:\s*=>\s*(\$[A-Za-z_][A-Za-z0-9_]*))?/g,
  )) {
    const firstVariable = match[1] ?? "";
    const secondVariable = match[2] ?? "";

    if (firstVariable) {
      variables.push({
        name: firstVariable,
        offset: (match.index ?? 0) + match[0].indexOf(firstVariable),
        priority: secondVariable ? 4 : 2,
      });
    }

    if (secondVariable) {
      variables.push({
        name: secondVariable,
        offset: (match.index ?? 0) + match[0].indexOf(secondVariable),
        priority: 2,
      });
    }
  }

  for (const match of masked.matchAll(
    /\bcatch\s*\([^)]*\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s*\)/g,
  )) {
    const name = match[1] ?? "";

    if (name) {
      variables.push({
        name,
        offset: (match.index ?? 0) + match[0].indexOf(name),
        priority: 1,
      });
    }
  }

  return variables;
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

function phpFunctionScopes(source: string): PhpFunctionScope[] {
  const masked = maskPhpStringsAndComments(source);

  return [
    ...phpTraditionalFunctionScopes(source, masked),
    ...phpArrowFunctionScopes(source, masked),
  ].sort((left, right) => left.keywordStart - right.keywordStart);
}

function phpTraditionalFunctionScopes(
  source: string,
  masked: string,
): PhpFunctionScope[] {
  const scopes: PhpFunctionScope[] = [];
  const functionPattern =
    /\b(static\s+)?function(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\(/g;

  for (const match of masked.matchAll(functionPattern)) {
    const keywordStart = match.index ?? 0;
    const openOffset = keywordStart + match[0].length - 1;
    const parametersEnd = matchingPairOffset(masked, openOffset, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    let cursor = parametersEnd + 1;
    let captures = "";
    const useMatch = /^\s*use\s*\(/.exec(masked.slice(cursor));

    if (useMatch) {
      const useOpenOffset = cursor + useMatch[0].length - 1;
      const useEnd = matchingPairOffset(masked, useOpenOffset, "(", ")");

      if (useEnd === null) {
        continue;
      }

      captures = source.slice(useOpenOffset + 1, useEnd);
      cursor = useEnd + 1;
    }

    const bodyOpenOffset = functionBodyOpenOffset(masked, cursor);

    if (bodyOpenOffset === null) {
      continue;
    }

    const bodyCloseOffset = matchingPairOffset(masked, bodyOpenOffset, "{", "}");

    if (bodyCloseOffset === null) {
      continue;
    }

    scopes.push({
      bodyEnd: bodyCloseOffset,
      bodyStart: bodyOpenOffset + 1,
      captures,
      capturesOuterVariables: false,
      isStatic: Boolean(match[1]),
      keywordStart,
      parameters: source.slice(openOffset + 1, parametersEnd),
    });
  }

  return scopes;
}

function phpArrowFunctionScopes(
  source: string,
  masked: string,
): PhpFunctionScope[] {
  const scopes: PhpFunctionScope[] = [];
  const arrowPattern = /\b(static\s+)?fn\s*\(/g;

  for (const match of masked.matchAll(arrowPattern)) {
    const keywordStart = match.index ?? 0;
    const openOffset = keywordStart + match[0].length - 1;
    const parametersEnd = matchingPairOffset(masked, openOffset, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    const arrowOffset = masked.indexOf("=>", parametersEnd + 1);

    if (arrowOffset < 0) {
      continue;
    }

    scopes.push({
      bodyEnd: phpArrowExpressionEndOffset(masked, arrowOffset + 2),
      bodyStart: arrowOffset + 2,
      captures: "",
      capturesOuterVariables: true,
      isStatic: Boolean(match[1]),
      keywordStart,
      parameters: source.slice(openOffset + 1, parametersEnd),
    });
  }

  return scopes;
}

function innermostFunctionScopeAt(
  scopes: PhpFunctionScope[],
  offset: number,
): PhpFunctionScope | null {
  let innermost: PhpFunctionScope | null = null;

  for (const scope of scopes) {
    if (scope.bodyStart > offset || scope.bodyEnd < offset) {
      continue;
    }

    if (!innermost || scope.bodyStart >= innermost.bodyStart) {
      innermost = scope;
    }
  }

  return innermost;
}

function maskNestedFunctionScopes(
  source: string,
  startOffset: number,
  endOffset: number,
  scopes: PhpFunctionScope[],
  currentScope: PhpFunctionScope | null,
): string {
  const characters = source.slice(startOffset, endOffset).split("");

  for (const scope of scopes) {
    if (scope === currentScope) {
      continue;
    }

    if (scope.keywordStart < startOffset || scope.keywordStart >= endOffset) {
      continue;
    }

    const maskStart = Math.max(scope.keywordStart, startOffset) - startOffset;
    const maskEnd = Math.min(scope.bodyEnd + 1, endOffset) - startOffset;

    for (let index = maskStart; index < maskEnd; index += 1) {
      if (characters[index] !== "\n") {
        characters[index] = " ";
      }
    }
  }

  return characters.join("");
}

function functionBodyOpenOffset(source: string, offset: number): number | null {
  for (let index = offset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (character === "{") {
      return index;
    }

    if (character === ";") {
      return null;
    }
  }

  return null;
}

function phpArrowExpressionEndOffset(source: string, offset: number): number {
  let squareDepth = 0;
  let parenDepth = 0;
  let braceDepth = 0;

  for (let index = offset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (character === "[") {
      squareDepth += 1;
      continue;
    }

    if (character === "]") {
      squareDepth = Math.max(0, squareDepth - 1);
      continue;
    }

    if (character === "(") {
      parenDepth += 1;
      continue;
    }

    if (character === ")") {
      if (parenDepth === 0) {
        return index;
      }

      parenDepth -= 1;
      continue;
    }

    if (character === "{") {
      braceDepth += 1;
      continue;
    }

    if (character === "}") {
      if (braceDepth === 0) {
        return index;
      }

      braceDepth -= 1;
      continue;
    }

    if (
      character === ";" &&
      squareDepth === 0 &&
      parenDepth === 0 &&
      braceDepth === 0
    ) {
      return index;
    }
  }

  return source.length;
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

import type { EditorPosition } from "./languageServerFeatures";

export interface PhpMemberAccessCompletionContext {
  prefix: string;
  receiverExpression: string;
  variableName: string | null;
}

export interface PhpMethodCompletion {
  declaringClassName: string;
  isStatic?: boolean;
  name: string;
  parameters: string;
  returnType: string | null;
}

export interface PhpMethodParameter {
  defaultValue: string | null;
  name: string;
  optional: boolean;
  raw: string;
  type: string | null;
}

export interface PhpMethodSignatureContext {
  argumentIndex: number;
  className: string | null;
  methodName: string;
  receiverExpression: string | null;
  variableName: string | null;
}

export interface PhpStaticAccessCompletionContext {
  className: string;
  prefix: string;
}

export interface PhpMethodSignature {
  argumentIndex: number;
  method: PhpMethodCompletion;
  parameters: PhpMethodParameter[];
}

export function phpMemberAccessCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpMemberAccessCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineUntilCursor = source.slice(lineStart, offset);
  const match =
    /((?:\$[A-Za-z_][A-Za-z0-9_]*|\$this)(?:\s*->\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(
      lineUntilCursor,
    );

  if (!match?.[1]) {
    return null;
  }

  const receiverExpression = normalizeReceiverExpression(match[1]);

  return {
    prefix: match[2] ?? "",
    receiverExpression,
    variableName: simpleVariableName(receiverExpression),
  };
}

export function phpStaticAccessCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpStaticAccessCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineUntilCursor = source.slice(lineStart, offset);
  const match =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)?$/.exec(
      lineUntilCursor,
    );

  if (!match?.[1]) {
    return null;
  }

  return {
    className: match[1].replace(/^\\+/, ""),
    prefix: match[2] ?? "",
  };
}

export function phpMethodSignatureContextAt(
  source: string,
  position: EditorPosition,
): PhpMethodSignatureContext | null {
  const offset = offsetAtPosition(source, position);
  const lineStart = source.lastIndexOf("\n", offset - 1) + 1;
  const lineUntilCursor = source.slice(lineStart, offset);
  const memberMatch =
    /((?:\$[A-Za-z_][A-Za-z0-9_]*|\$this)(?:\s*->\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*->\s*([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)$/.exec(
      lineUntilCursor,
    );

  if (memberMatch?.[1] && memberMatch[2]) {
    const receiverExpression = normalizeReceiverExpression(memberMatch[1]);

    return {
      argumentIndex: phpArgumentIndex(memberMatch[3] ?? ""),
      className: null,
      methodName: memberMatch[2],
      receiverExpression,
      variableName: simpleVariableName(receiverExpression),
    };
  }

  const staticMatch =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\((.*)$/.exec(
      lineUntilCursor,
    );

  if (!staticMatch?.[1] || !staticMatch[2]) {
    return null;
  }

  return {
    argumentIndex: phpArgumentIndex(staticMatch[3] ?? ""),
    className: staticMatch[1].replace(/^\\+/, ""),
    methodName: staticMatch[2],
    receiverExpression: null,
    variableName: null,
  };
}

export function phpMethodCompletionsFromSource(
  source: string,
  declaringClassName: string,
): PhpMethodCompletion[] {
  const methods: PhpMethodCompletion[] = [];
  const masked = maskPhpStringsAndComments(source);
  const pattern =
    /(?:^|\n)\s*((?:(?:abstract|final|private|protected|public|static)\s+)*)function\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*(?::\s*([^{;\n]+))?/g;

  for (const match of masked.matchAll(pattern)) {
    const modifiers = (match[1] ?? "").toLowerCase();

    if (/\bprivate\b/.test(modifiers) || /\bprotected\b/.test(modifiers)) {
      continue;
    }

    const name = match[2];

    if (!name) {
      continue;
    }

    methods.push({
      declaringClassName,
      name,
      parameters: normalizeWhitespace(match[3] ?? ""),
      returnType:
        normalizeReturnType(match[4] ?? null) ??
        phpDocReturnTypeBefore(
          source,
          (match.index ?? 0) + match[0].lastIndexOf("function"),
        ),
      ...(modifiers.includes("static") ? { isStatic: true } : {}),
    });
  }

  return methods;
}

export function phpMethodParameters(parameters: string): PhpMethodParameter[] {
  return splitPhpParameterList(parameters).map((parameter) => {
    const defaultIndex = topLevelEqualsIndex(parameter);
    const withoutDefault =
      defaultIndex >= 0 ? parameter.slice(0, defaultIndex).trim() : parameter;
    const defaultValue =
      defaultIndex >= 0 ? parameter.slice(defaultIndex + 1).trim() : null;
    const nameMatch = /(?:\.\.\.)?(?:&\s*)?(\$[A-Za-z_][A-Za-z0-9_]*)\b/.exec(
      withoutDefault,
    );
    const name = nameMatch?.[1] ?? withoutDefault;
    const beforeName = nameMatch
      ? withoutDefault.slice(0, nameMatch.index).trim()
      : "";

    return {
      defaultValue,
      name,
      optional: defaultValue !== null,
      raw: parameter,
      type: normalizeParameterType(beforeName),
    };
  });
}

export function phpTraitClassNames(source: string): string[] {
  const typeMatch = /\b(?:class|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*/.exec(
    source,
  );

  if (!typeMatch) {
    return [];
  }

  const bodyStart = source.indexOf("{", typeMatch.index + typeMatch[0].length);

  if (bodyStart < 0) {
    return [];
  }

  const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}") ?? source.length;
  const body = source.slice(bodyStart + 1, bodyEnd);
  const traits: string[] = [];

  for (const match of body.matchAll(/^\s*use\s+([^;{]+);/gm)) {
    for (const trait of (match[1] ?? "").split(",")) {
      const normalized = trait.trim().replace(/^\\+/, "");

      if (!normalized || /\s/.test(normalized)) {
        continue;
      }

      traits.push(normalized);
    }
  }

  return Array.from(new Set(traits));
}

function simpleVariableName(receiverExpression: string): string | null {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(receiverExpression);
  return match?.[1] ?? null;
}

function normalizeReceiverExpression(receiverExpression: string): string {
  return receiverExpression.replace(/\s*->\s*/g, "->").trim();
}

function phpDocReturnTypeBefore(source: string, functionOffset: number): string | null {
  const beforeFunction = source.slice(0, functionOffset);
  const docStart = beforeFunction.lastIndexOf("/**");
  const docEnd = beforeFunction.lastIndexOf("*/");

  if (docStart < 0 || docEnd < docStart) {
    return null;
  }

  const betweenDocAndFunction = beforeFunction
    .slice(docEnd + 2)
    .replace(/\b(?:abstract|final|private|protected|public|static)\b/g, " ")
    .trim();

  if (betweenDocAndFunction) {
    return null;
  }

  const returnMatch = /@return\s+([^\s*]+)/.exec(
    beforeFunction.slice(docStart, docEnd + 2),
  );

  return normalizeReturnType(returnMatch?.[1] ?? null);
}

function phpArgumentIndex(argumentsSource: string): number {
  let argumentIndex = 0;
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index] || "";

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

    if (character === "," && depth === 0) {
      argumentIndex += 1;
    }
  }

  return argumentIndex;
}

function normalizeParameterType(beforeName: string): string | null {
  const normalized = normalizeWhitespace(
    beforeName.replace(/\b(?:public|protected|private|readonly|static)\b/g, " "),
  );

  return normalized || null;
}

function topLevelEqualsIndex(source: string): number {
  let depth = 0;
  let quote: string | null = null;

  for (let index = 0; index < source.length; index += 1) {
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
      continue;
    }

    if (character === "=" && depth === 0) {
      return index;
    }
  }

  return -1;
}

function normalizeReturnType(returnType: string | null): string | null {
  const normalized = normalizeWhitespace(returnType ?? "")
    .replace(/\s*\|\s*/g, "|")
    .replace(/\s*&\s*/g, "&");

  return normalized || null;
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
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

function maskPhpStringsAndComments(source: string): string {
  let output = "";
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";
    const next = source[index + 1] || "";

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

    if (character === "#" && source[index - 1] !== "$") {
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

    if (character === "'" || character === "\"" || character === "`") {
      output += " ";
      quote = character;
      continue;
    }

    output += character;
  }

  return output;
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

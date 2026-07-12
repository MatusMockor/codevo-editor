import type { EditorPosition } from "./languageServerFeatures";

export type PhpLaravelInertiaReferenceCall =
  | "Inertia::render"
  | "inertia"
  | "Route::inertia";

export interface PhpLaravelInertiaReferenceContext {
  call: PhpLaravelInertiaReferenceCall;
  name: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelInertiaComponentTarget {
  relativeFilePaths: string[];
}

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

interface PhpArgumentContext {
  argumentIndex: number;
  argumentName: string | null;
  openParen: number;
}

const componentExtensions = ["vue", "tsx", "jsx", "ts", "js"] as const;

export function phpLaravelInertiaReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelInertiaReferenceContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal || !isUsableLaravelInertiaComponentName(literal.value)) {
    return null;
  }

  const argument = argumentContextAt(source, literal);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  if (!literalIsCompleteArgument(source, literal)) {
    return null;
  }

  const call = inertiaReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  const prefix = source.slice(
    literal.quoteStart + 1,
    Math.min(offset, literal.quoteEnd),
  );

  if (!isUsableLaravelInertiaComponentName(prefix)) {
    return null;
  }

  return {
    call,
    name: literal.closed ? literal.value : prefix,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix,
  };
}

export function resolveLaravelInertiaComponentTarget(
  componentName: string,
): PhpLaravelInertiaComponentTarget | null {
  if (!isUsableLaravelInertiaComponentName(componentName)) {
    return null;
  }

  const relativeFilePaths: string[] = [];

  for (const pagesDirectory of ["Pages", "pages"]) {
    for (const extension of componentExtensions) {
      relativeFilePaths.push(
        `resources/js/${pagesDirectory}/${componentName}.${extension}`,
      );
    }
  }

  return { relativeFilePaths };
}

export function isUsableLaravelInertiaComponentName(name: string): boolean {
  if (name.length === 0 || !/^[A-Za-z0-9/_.-]+$/.test(name)) {
    return false;
  }

  if (name.startsWith("/") || name.endsWith("/")) {
    return false;
  }

  if (name.includes("..")) {
    return false;
  }

  return !name.split("/").some((segment) => segment.length === 0);
}

function inertiaReferenceCallAt(
  source: string,
  argument: PhpArgumentContext,
): PhpLaravelInertiaReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);

  if (isRouteComponentArgument(argument)) {
    if (/\bRoute\s*::\s*inertia\s*$/.test(beforeCall)) {
      return "Route::inertia";
    }
  }

  if (!isRenderComponentArgument(argument)) {
    return null;
  }

  if (/\bInertia\s*::\s*render\s*$/.test(beforeCall)) {
    return "Inertia::render";
  }

  const functionMatch = /(?:^|[^A-Za-z0-9_>$:])([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
    beforeCall,
  );

  if (!functionMatch?.[1]) {
    return null;
  }

  const beforeFunction = beforeCall.slice(0, functionMatch.index);

  if (/(?:->|::)\s*$/.test(beforeFunction)) {
    return null;
  }

  if (functionMatch[1].toLowerCase() !== "inertia") {
    return null;
  }

  return "inertia";
}

function isRenderComponentArgument(argument: PhpArgumentContext): boolean {
  if (argument.argumentName) {
    return argument.argumentName.toLowerCase() === "component";
  }

  return argument.argumentIndex === 0;
}

function isRouteComponentArgument(argument: PhpArgumentContext): boolean {
  if (argument.argumentName) {
    return argument.argumentName.toLowerCase() === "component";
  }

  return argument.argumentIndex === 1;
}

function literalIsCompleteArgument(
  source: string,
  literal: PhpStringLiteral,
): boolean {
  if (!literal.closed) {
    return true;
  }

  for (let index = literal.quoteEnd + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (/\s/.test(character)) {
      continue;
    }

    return character === "," || character === ")";
  }

  return true;
}

function argumentContextAt(
  source: string,
  literal: PhpStringLiteral,
): PhpArgumentContext | null {
  for (
    let openParen = source.lastIndexOf("(", literal.quoteStart);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && literal.quoteStart > closeParen) {
      continue;
    }

    const argumentIndex = topLevelArgumentIndexAtOffset(
      source,
      openParen,
      literal.quoteStart,
    );

    if (argumentIndex === null) {
      continue;
    }

    const argumentName = namedArgumentNameBeforeLiteral(
      source,
      openParen + 1,
      literal.quoteStart,
    );

    if (argumentName === undefined) {
      continue;
    }

    return { argumentIndex, argumentName, openParen };
  }

  return null;
}

function topLevelArgumentIndexAtOffset(
  source: string,
  openParenOffset: number,
  targetOffset: number,
): number | null {
  let argumentIndex = 0;
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (let index = openParenOffset + 1; index < targetOffset; index += 1) {
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
      if (depth === 0) {
        return null;
      }

      depth -= 1;
      continue;
    }

    if (character === "," && depth === 0) {
      argumentIndex += 1;
    }
  }

  if (quote || depth !== 0) {
    return null;
  }

  return argumentIndex;
}

function namedArgumentNameBeforeLiteral(
  source: string,
  startOffset: number,
  literalStartOffset: number,
): string | null | undefined {
  const prefix = source.slice(startOffset, literalStartOffset);
  const lastComma = topLevelLastCommaOffset(prefix);
  const argumentPrefix = prefix.slice(lastComma + 1);

  if (/^\s*$/.test(argumentPrefix)) {
    return null;
  }

  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/.exec(argumentPrefix);

  return match?.[1] ?? undefined;
}

function topLevelLastCommaOffset(source: string): number {
  let depth = 0;
  let lastComma = -1;
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

    if (character === "," && depth === 0) {
      lastComma = index;
    }
  }

  return lastComma;
}

function stringLiteralAtOffset(
  source: string,
  offset: number,
): PhpStringLiteral | null {
  let quote: "'" | "\"" | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (quote) {
      if (character === "\\") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset <= index) {
        const value = source.slice(quoteStart + 1, index);

        if (quote === "\"" && hasPhpVariableInterpolation(value)) {
          return null;
        }

        return {
          closed: true,
          quote,
          quoteEnd: index,
          quoteStart,
          value,
        };
      }

      quote = null;
      quoteStart = -1;
      continue;
    }

    if (character !== "'" && character !== "\"") {
      continue;
    }

    quote = character;
    quoteStart = index;
  }

  if (!quote || offset <= quoteStart) {
    return null;
  }

  const value = source.slice(quoteStart + 1);

  if (quote === "\"" && hasPhpVariableInterpolation(value)) {
    return null;
  }

  return {
    closed: false,
    quote,
    quoteEnd: source.length,
    quoteStart,
    value,
  };
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let blockComment = false;
  let depth = 0;
  let lineComment = false;
  let quote: "'" | "\"" | null = null;

  for (let index = openOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

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

    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#") {
      lineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
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

function isPhpCodeOffset(source: string, targetOffset: number): boolean {
  let blockComment = false;
  let lineComment = false;
  let quote: "'" | "\"" | null = null;

  for (let index = 0; index < source.length && index < targetOffset; index += 1) {
    const character = source[index] ?? "";
    const nextCharacter = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (character === "*" && nextCharacter === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }

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

    if (character === "/" && nextCharacter === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#") {
      lineComment = true;
      continue;
    }

    if (character === "/" && nextCharacter === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !blockComment && !lineComment && !quote;
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$\{?[A-Za-z_]/.test(value);
}

function offsetAtPosition(source: string, position: EditorPosition): number {
  let column = 1;
  let line = 1;

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

function editorPositionAtOffset(
  source: string,
  targetOffset: number,
): EditorPosition {
  const offset = Math.max(0, Math.min(source.length, targetOffset));
  let lineNumber = 1;
  let lineStart = 0;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] !== "\n") {
      continue;
    }

    lineNumber += 1;
    lineStart = index + 1;
  }

  return {
    column: offset - lineStart + 1,
    lineNumber,
  };
}

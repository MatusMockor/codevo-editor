import type { EditorPosition } from "./languageServerFeatures";
import { phpStringArrayArgumentElementContextAt } from "./phpStringArgumentContext";

export type PhpLaravelViewReferenceCall =
  | "view"
  | "View::make"
  | "View::first"
  | "view()->make"
  | "view()->first"
  | "response()->view"
  | "View::exists"
  | "Route::view";

export interface PhpLaravelViewReferenceContext {
  call: PhpLaravelViewReferenceCall;
  name: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelViewTarget {
  name: string;
  path: string;
  relativePath: string;
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

export function phpLaravelViewReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelViewReferenceContext | null {
  const arrayArgument = phpStringArrayArgumentElementContextAt(source, position);

  if (arrayArgument && isUsableLaravelViewName(arrayArgument.value)) {
    const call = laravelFallbackViewReferenceCallAt(source, arrayArgument);

    if (call && isUsableLaravelViewName(arrayArgument.prefix)) {
      return {
        call,
        name: arrayArgument.closed ? arrayArgument.value : arrayArgument.prefix,
        position: arrayArgument.position,
        prefix: arrayArgument.prefix,
      };
    }
  }

  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal || !isUsableLaravelViewName(literal.value)) {
    return null;
  }

  const argument = argumentContextAt(source, literal);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  const call = laravelViewReferenceCallAt(source, argument);

  if (!call) {
    return null;
  }

  const prefix = source.slice(
    literal.quoteStart + 1,
    Math.min(offset, literal.quoteEnd),
  );

  if (!isUsableLaravelViewName(prefix)) {
    return null;
  }

  return {
    call,
    name: literal.closed ? literal.value : prefix,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix,
  };
}

export function phpLaravelViewNameCandidateRelativePaths(
  viewName: string,
): string[] {
  if (!isUsableLaravelViewName(viewName)) {
    return [];
  }

  const relativePath = viewName.split(".").join("/");

  return [
    `resources/views/${relativePath}.blade.php`,
    `resources/views/${relativePath}.php`,
  ];
}

export function phpLaravelViewNameFromRelativePath(
  relativePath: string,
): string | null {
  const normalized = relativePath.split("\\").join("/").replace(/^\/+/, "");
  const bladePrefix = "resources/views/";

  if (!normalized.startsWith(bladePrefix)) {
    return null;
  }

  const viewPath = normalized.slice(bladePrefix.length);
  const withoutExtension = viewPath.endsWith(".blade.php")
    ? viewPath.slice(0, -".blade.php".length)
    : viewPath.endsWith(".php")
      ? viewPath.slice(0, -".php".length)
      : null;

  if (!withoutExtension || withoutExtension.includes("/.")) {
    return null;
  }

  const viewName = withoutExtension.split("/").join(".");

  return isUsableLaravelViewName(viewName) ? viewName : null;
}

export function phpLaravelViewCompletionInsertText(
  viewName: string,
  prefix: string,
): string {
  const lastDotIndex = prefix.lastIndexOf(".");

  if (lastDotIndex < 0) {
    return viewName;
  }

  return viewName.slice(lastDotIndex + 1);
}

export function isUsableLaravelViewName(viewName: string): boolean {
  return (
    viewName.length > 0 &&
    !viewName.includes("::") &&
    /^[A-Za-z0-9_.-]+$/.test(viewName) &&
    !viewName.startsWith(".") &&
    !viewName.endsWith(".") &&
    !viewName.includes("..")
  );
}

function laravelViewReferenceCallAt(
  source: string,
  argument: PhpArgumentContext,
): PhpLaravelViewReferenceCall | null {
  const beforeCall = source.slice(0, argument.openParen);

  if (
    argument.argumentIndex === 1 ||
    argument.argumentName?.toLowerCase() === "view"
  ) {
    if (/\bRoute\s*::\s*view\s*$/.test(beforeCall)) {
      return "Route::view";
    }
  }

  if (!isFirstArgument(argument)) {
    return null;
  }

  if (/\bView\s*::\s*make\s*$/.test(beforeCall)) {
    return "View::make";
  }

  if (/\bview\s*\(\s*\)\s*->\s*make\s*$/.test(beforeCall)) {
    return "view()->make";
  }

  if (/\bresponse\s*\(\s*\)\s*->\s*view\s*$/.test(beforeCall)) {
    return "response()->view";
  }

  if (/\bView\s*::\s*exists\s*$/.test(beforeCall)) {
    return "View::exists";
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

  return functionMatch[1].toLowerCase() === "view" ? "view" : null;
}

function laravelFallbackViewReferenceCallAt(
  source: string,
  argument: PhpArgumentContext,
): PhpLaravelViewReferenceCall | null {
  if (!isFirstViewListArgument(argument)) {
    return null;
  }

  const beforeCall = source.slice(0, argument.openParen);

  if (/\bView\s*::\s*first\s*$/.test(beforeCall)) {
    return "View::first";
  }

  if (/\bview\s*\(\s*\)\s*->\s*first\s*$/.test(beforeCall)) {
    return "view()->first";
  }

  return null;
}

function isFirstArgument(argument: PhpArgumentContext): boolean {
  return (
    argument.argumentIndex === 0 ||
    argument.argumentName?.toLowerCase() === "view"
  );
}

function isFirstViewListArgument(argument: PhpArgumentContext): boolean {
  if (argument.argumentName) {
    return argument.argumentName.toLowerCase() === "views";
  }

  return argument.argumentIndex === 0;
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

  return quote || depth !== 0 ? null : argumentIndex;
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

  for (
    let index = 0;
    index < source.length && index < targetOffset;
    index += 1
  ) {
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

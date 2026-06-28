import type { EditorPosition } from "./languageServerFeatures";
import {
  phpStringArgumentContextAt,
  phpStringArrayArgumentElementContextAt,
  type PhpStringArgumentContext,
  type PhpStringArrayArgumentElementContext,
} from "./phpStringArgumentContext";

const middlewareAliasArrayProperties = ["middlewareAliases", "routeMiddleware"];

export interface PhpLaravelMiddlewareAliasReferenceContext {
  alias: string;
  // True when the cursor sits in the parameter portion after the alias colon
  // (e.g. `auth:web|`). Alias-name completion must not fire there.
  aliasParameterStarted: boolean;
  position: EditorPosition;
}

export interface PhpLaravelMiddlewareAliasDefinition {
  name: string;
  position: EditorPosition;
}

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

export function phpLaravelMiddlewareAliasReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelMiddlewareAliasReferenceContext | null {
  const arrayArgument = phpStringArrayArgumentElementContextAt(source, position);

  if (arrayArgument) {
    return middlewareAliasReferenceContext(source, arrayArgument);
  }

  const argument = phpStringArgumentContextAt(source, position);

  if (!argument) {
    return null;
  }

  return middlewareAliasReferenceContext(source, argument);
}

export function phpLaravelMiddlewareAliasDefinitions(
  source: string,
): PhpLaravelMiddlewareAliasDefinition[] {
  const definitions: PhpLaravelMiddlewareAliasDefinition[] = [];

  for (const property of middlewareAliasArrayProperties) {
    const arrayOpen = middlewareAliasArrayOpenAt(source, property);

    if (arrayOpen === null) {
      continue;
    }

    const arrayClose = matchingBracketOffset(source, arrayOpen, "[", "]");

    if (arrayClose === null) {
      continue;
    }

    for (const key of topLevelArrayStringKeys(source, arrayOpen, arrayClose)) {
      if (!isUsableLaravelMiddlewareAlias(key.value)) {
        continue;
      }

      definitions.push({
        name: key.value,
        position: editorPositionAtOffset(source, key.quoteStart + 1),
      });
    }
  }

  return definitions;
}

export function phpLaravelMiddlewareAliasCompletionInsertText(
  alias: string,
): string {
  return alias;
}

export function isUsableLaravelMiddlewareAlias(alias: string): boolean {
  return (
    alias.length > 0 &&
    /^[A-Za-z0-9_.-]+$/.test(alias) &&
    !alias.startsWith(".") &&
    !alias.endsWith(".") &&
    !alias.includes("..")
  );
}

function middlewareAliasReferenceContext(
  source: string,
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): PhpLaravelMiddlewareAliasReferenceContext | null {
  if (
    !isMiddlewareArgument(argument) ||
    !isMiddlewareCallAt(source, argument)
  ) {
    return null;
  }

  const alias = middlewareAliasFromArgument(argument);

  if (!alias || !isUsableLaravelMiddlewareAlias(alias)) {
    return null;
  }

  return {
    alias,
    aliasParameterStarted: argument.prefix.includes(":"),
    position: argument.position,
  };
}

function isMiddlewareArgument(
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): boolean {
  if (argument.argumentName) {
    return argument.argumentName.toLowerCase() === "middleware";
  }

  return argument.argumentIndex === 0;
}

function isMiddlewareCallAt(
  source: string,
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): boolean {
  const beforeCall = source.slice(0, argument.openParen);

  if (/(?:->|\?->)\s*middleware\s*$/.test(beforeCall)) {
    return true;
  }

  return /(?:^|[^A-Za-z0-9_\\])Route\s*::\s*middleware\s*$/.test(beforeCall);
}

function middlewareAliasFromArgument(
  argument: PhpStringArgumentContext | PhpStringArrayArgumentElementContext,
): string | null {
  const value = argument.closed ? argument.value : argument.prefix;
  const alias = value.split(":")[0] ?? "";

  return alias === "" ? null : alias;
}

function middlewareAliasArrayOpenAt(
  source: string,
  property: string,
): number | null {
  const pattern = new RegExp(
    String.raw`\$${property}\s*=\s*(\[|array\s*\()`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const matchStart = match.index ?? 0;

    if (!isPhpCodeOffset(source, matchStart)) {
      continue;
    }

    const opener = match[1] ?? "";
    const arrayOpen =
      opener === "["
        ? matchStart + match[0].lastIndexOf("[")
        : source.indexOf("(", matchStart + match[0].indexOf("array"));

    if (arrayOpen < 0) {
      continue;
    }

    return arrayOpen;
  }

  return null;
}

function topLevelArrayStringKeys(
  source: string,
  arrayOpen: number,
  arrayClose: number,
): PhpStringLiteral[] {
  const keys: PhpStringLiteral[] = [];
  let depth = 0;

  for (let index = arrayOpen + 1; index < arrayClose; index += 1) {
    const character = source[index] ?? "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth !== 0 || (character !== "'" && character !== "\"")) {
      continue;
    }

    const literal = stringLiteralStartingAt(source, index);

    if (!literal?.closed) {
      index = literal ? literal.quoteEnd : index;
      continue;
    }

    index = literal.quoteEnd;

    const afterLiteral = skipWhitespace(source, literal.quoteEnd + 1);

    if (source.slice(afterLiteral, afterLiteral + 2) !== "=>") {
      continue;
    }

    if (literal.quote === "\"" && hasPhpVariableInterpolation(literal.value)) {
      continue;
    }

    keys.push(literal);
  }

  return keys;
}

function stringLiteralStartingAt(
  source: string,
  quoteStart: number,
): PhpStringLiteral | null {
  const quote = source[quoteStart];

  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  for (let index = quoteStart + 1; index < source.length; index += 1) {
    const character = source[index] ?? "";

    if (character === "\\") {
      index += 1;
      continue;
    }

    if (character !== quote) {
      continue;
    }

    return {
      closed: true,
      quote,
      quoteEnd: index,
      quoteStart,
      value: source.slice(quoteStart + 1, index),
    };
  }

  return {
    closed: false,
    quote,
    quoteEnd: source.length,
    quoteStart,
    value: source.slice(quoteStart + 1),
  };
}

function matchingBracketOffset(
  source: string,
  openOffset: number,
  open: "(" | "[" | "{",
  close: ")" | "]" | "}",
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

    if (character === close) {
      depth -= 1;

      if (depth === 0) {
        return index;
      }
    }
  }

  return null;
}

function isPhpCodeOffset(source: string, offset: number): boolean {
  let quote: "'" | "\"" | null = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }

      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
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

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 1;
      continue;
    }

    if (character === "#" && next !== "[") {
      lineComment = true;
      continue;
    }

    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }

    if (character === "'" || character === "\"") {
      quote = character;
    }
  }

  return !quote && !lineComment && !blockComment;
}

function hasPhpVariableInterpolation(value: string): boolean {
  return /(^|[^\\])\$(?:[A-Za-z_]|[{])/.test(value);
}

function skipWhitespace(source: string, startOffset: number): number {
  let index = startOffset;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
}

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
  let lineNumber = 1;
  let column = 1;

  for (let index = 0; index < offset; index += 1) {
    if (source[index] === "\n") {
      lineNumber += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { column, lineNumber };
}

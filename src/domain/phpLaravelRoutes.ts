import type { EditorPosition } from "./languageServerFeatures";

export type PhpLaravelNamedRouteReferenceCall =
  | "route"
  | "to_route"
  | "redirect()->route"
  | "URL::route"
  | "Route::has";

export interface PhpLaravelNamedRouteReferenceContext {
  call: PhpLaravelNamedRouteReferenceCall;
  name: string;
  position: EditorPosition;
  prefix: string;
}

export interface PhpLaravelNamedRouteDefinition {
  name: string;
  position: EditorPosition;
}

interface PhpLaravelNamedRouteGroup {
  bodyEnd: number;
  bodyStart: number;
  prefix: string;
}

interface PhpStringLiteral {
  closed: boolean;
  quote: "'" | "\"";
  quoteEnd: number;
  quoteStart: number;
  value: string;
}

const laravelRouteDefinitionMethods = new Set([
  "any",
  "delete",
  "get",
  "match",
  "options",
  "patch",
  "permanentredirect",
  "post",
  "put",
  "redirect",
  "view",
]);

export function phpLaravelNamedRouteReferenceContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelNamedRouteReferenceContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const openParen = firstArgumentCallOpenParenAt(source, literal);

  if (openParen === null || !isPhpCodeOffset(source, openParen)) {
    return null;
  }

  const call = laravelNamedRouteReferenceCallAt(source, openParen);

  if (!call) {
    return null;
  }

  const prefix = source.slice(
    literal.quoteStart + 1,
    Math.min(offset, literal.quoteEnd),
  );

  return {
    call,
    name: literal.closed ? literal.value : prefix,
    position: editorPositionAtOffset(source, literal.quoteStart + 1),
    prefix,
  };
}

export function phpLaravelNamedRouteDefinitions(
  source: string,
): PhpLaravelNamedRouteDefinition[] {
  const definitions: PhpLaravelNamedRouteDefinition[] = [];
  const routeGroups = phpLaravelNamedRouteGroups(source);
  const routePattern = /\bRoute\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of source.matchAll(routePattern)) {
    const routeStart = match.index ?? 0;
    const routeMethod = match[1]?.toLowerCase() ?? "";

    if (
      !laravelRouteDefinitionMethods.has(routeMethod) ||
      !isPhpCodeOffset(source, routeStart)
    ) {
      continue;
    }

    const openParen = routeStart + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen === null) {
      continue;
    }

    const chainStart = closeParen + 1;
    const chainEnd = phpStatementEndOffset(source, chainStart);
    const chainSource = source.slice(chainStart, chainEnd);
    const namePattern = /->\s*name\s*\(/g;

    for (const nameMatch of chainSource.matchAll(namePattern)) {
      const nameOpenParen =
        chainStart + (nameMatch.index ?? 0) + nameMatch[0].lastIndexOf("(");

      if (!isPhpCodeOffset(source, nameOpenParen)) {
        continue;
      }

      const literal = firstClosedLiteralArgumentAtOpenParen(source, nameOpenParen);

      if (!literal) {
        continue;
      }

      definitions.push({
        name: `${routeNamePrefixAtOffset(routeGroups, routeStart)}${literal.value}`,
        position: editorPositionAtOffset(source, literal.quoteStart + 1),
      });
    }
  }

  return definitions;
}

function phpLaravelNamedRouteGroups(
  source: string,
): PhpLaravelNamedRouteGroup[] {
  const groups: PhpLaravelNamedRouteGroup[] = [];
  const namePattern = /\bRoute\s*::\s*name\s*\(/g;

  for (const match of source.matchAll(namePattern)) {
    const routeStart = match.index ?? 0;

    if (!isPhpCodeOffset(source, routeStart)) {
      continue;
    }

    const nameOpenParen = routeStart + match[0].lastIndexOf("(");
    const prefixLiteral = firstClosedLiteralArgumentAtOpenParen(
      source,
      nameOpenParen,
    );

    if (!prefixLiteral) {
      continue;
    }

    const statementEnd = phpStatementEndOffset(source, prefixLiteral.quoteEnd + 1);
    const chainSource = source.slice(prefixLiteral.quoteEnd + 1, statementEnd);
    const groupMatch = /->\s*group\s*\(/g.exec(chainSource);

    if (!groupMatch) {
      continue;
    }

    const groupOpenParen =
      prefixLiteral.quoteEnd +
      1 +
      (groupMatch.index ?? 0) +
      groupMatch[0].lastIndexOf("(");
    const groupCloseParen = matchingBracketOffset(
      source,
      groupOpenParen,
      "(",
      ")",
    );

    if (groupCloseParen === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", groupOpenParen);

    if (bodyStart < 0 || bodyStart > groupCloseParen) {
      continue;
    }

    const bodyEnd = matchingBracketOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null || bodyEnd > groupCloseParen) {
      continue;
    }

    groups.push({
      bodyEnd,
      bodyStart,
      prefix: prefixLiteral.value,
    });
  }

  return groups.sort((left, right) => left.bodyStart - right.bodyStart);
}

function routeNamePrefixAtOffset(
  groups: PhpLaravelNamedRouteGroup[],
  offset: number,
): string {
  return groups
    .filter((group) => offset > group.bodyStart && offset < group.bodyEnd)
    .map((group) => group.prefix)
    .join("");
}

function laravelNamedRouteReferenceCallAt(
  source: string,
  openParen: number,
): PhpLaravelNamedRouteReferenceCall | null {
  const beforeCall = source.slice(Math.max(0, openParen - 240), openParen);

  if (/\bredirect\s*\(\s*\)\s*->\s*route\s*$/i.test(beforeCall)) {
    return "redirect()->route";
  }

  if (/\bURL\s*::\s*route\s*$/i.test(beforeCall)) {
    return "URL::route";
  }

  if (/\bRoute\s*::\s*has\s*$/i.test(beforeCall)) {
    return "Route::has";
  }

  const functionMatch = /\b(route|to_route)\s*$/i.exec(beforeCall);

  if (!functionMatch?.[1]) {
    return null;
  }

  const beforeFunction = beforeCall.slice(0, functionMatch.index);

  if (/(?:->|::)\s*$/.test(beforeFunction)) {
    return null;
  }

  return functionMatch[1].toLowerCase() === "to_route" ? "to_route" : "route";
}

function firstArgumentCallOpenParenAt(
  source: string,
  literal: PhpStringLiteral,
): number | null {
  for (
    let openParen = source.lastIndexOf("(", literal.quoteStart);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && literal.quoteStart > closeParen) {
      continue;
    }

    if (
      topLevelArgumentIndexAtOffset(source, openParen, literal.quoteStart) !== 0 ||
      !isTopLevelWhitespaceBetween(source, openParen + 1, literal.quoteStart)
    ) {
      continue;
    }

    return openParen;
  }

  return null;
}

function firstClosedLiteralArgumentAtOpenParen(
  source: string,
  openParen: number,
): PhpStringLiteral | null {
  const argumentStart = skipWhitespace(source, openParen + 1);
  const literal = stringLiteralStartingAt(source, argumentStart);

  if (!literal?.closed) {
    return null;
  }

  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const afterLiteral = source.slice(literal.quoteEnd + 1, closeParen);

  if (!/^\s*$/.test(afterLiteral)) {
    return null;
  }

  if (literal.quote === "\"" && hasPhpVariableInterpolation(literal.value)) {
    return null;
  }

  return literal;
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
        return {
          closed: true,
          quote,
          quoteEnd: index,
          quoteStart,
          value: source.slice(quoteStart + 1, index),
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

  return {
    closed: false,
    quote,
    quoteEnd: source.length,
    quoteStart,
    value: source.slice(quoteStart + 1),
  };
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

function phpStatementEndOffset(source: string, startOffset: number): number {
  let blockComment = false;
  let depth = 0;
  let lineComment = false;
  let quote: "'" | "\"" | null = null;

  for (let index = startOffset; index < source.length; index += 1) {
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

  return source.length;
}

function topLevelArgumentIndexAtOffset(
  source: string,
  openParenOffset: number,
  targetOffset: number,
): number {
  let argumentIndex = 0;
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (
    let index = openParenOffset + 1;
    index < source.length && index < targetOffset;
    index += 1
  ) {
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
      argumentIndex += 1;
    }
  }

  return argumentIndex;
}

function isTopLevelWhitespaceBetween(
  source: string,
  startOffset: number,
  targetOffset: number,
): boolean {
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  for (
    let index = startOffset;
    index < source.length && index < targetOffset;
    index += 1
  ) {
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

    if (depth > 0 || !/\s/.test(character)) {
      return false;
    }
  }

  return depth === 0;
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

function skipWhitespace(source: string, startOffset: number): number {
  let index = startOffset;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index;
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

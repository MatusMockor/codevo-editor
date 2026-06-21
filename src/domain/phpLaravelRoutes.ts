import type { EditorPosition } from "./languageServerFeatures";

export type PhpLaravelNamedRouteReferenceCall =
  | "route"
  | "to_route"
  | "redirect()->route"
  | "Redirect::route"
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
const laravelResourceRouteActions = new Map<string, readonly string[]>([
  ["apiresource", ["index", "store", "show", "update", "destroy"]],
  ["apisingleton", ["show", "update"]],
  ["resource", ["index", "create", "store", "show", "edit", "update", "destroy"]],
  ["singleton", ["show", "edit", "update"]],
]);
const laravelResourceArrayRouteActions = new Map<string, readonly string[]>([
  ["apiresources", ["index", "store", "show", "update", "destroy"]],
  ["resources", ["index", "create", "store", "show", "edit", "update", "destroy"]],
  [
    "softdeletableresources",
    ["index", "create", "store", "show", "edit", "update", "destroy"],
  ],
]);
const laravelSingletonResourceRouteMethods = new Set([
  "apisingleton",
  "singleton",
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
      !laravelRouteDefinitionMethods.has(routeMethod) &&
      !laravelResourceRouteActions.has(routeMethod) &&
      !laravelResourceArrayRouteActions.has(routeMethod)
    ) {
      continue;
    }

    if (!isPhpCodeOffset(source, routeStart)) {
      continue;
    }

    const openParen = routeStart + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");
    const resourceActions =
      closeParen === null
        ? null
        : laravelResourceRouteActionsForMethod(source, routeMethod, closeParen);
    const resourceArrayActions = laravelResourceArrayRouteActions.get(routeMethod);

    if (resourceActions) {
      const literal = firstLiteralArgumentAtOpenParen(source, openParen);

      if (!literal) {
        continue;
      }

      const routeNamePrefix = routeNamePrefixAtOffset(routeGroups, routeStart);
      const chainStart = closeParen === null ? null : closeParen + 1;
      const chainEnd =
        chainStart === null ? null : phpStatementEndOffset(source, chainStart);
      const routeNameOverrides =
        chainStart === null || chainEnd === null
          ? new Map<string, PhpStringLiteral>()
          : laravelResourceRouteNameOverrides(source, chainStart, chainEnd);
      const defaultPosition = editorPositionAtOffset(source, literal.quoteStart + 1);

      for (const action of resourceActions) {
        const override = routeNameOverrides.get(action);

        definitions.push({
          name: `${routeNamePrefix}${
            override ? override.value : `${literal.value}.${action}`
          }`,
          position: override
            ? editorPositionAtOffset(source, override.quoteStart + 1)
            : defaultPosition,
        });
      }

      continue;
    }

    if (resourceArrayActions) {
      const literals = firstArrayLiteralKeysAtOpenParen(
        source,
        openParen,
        closeParen,
      );
      const routeNamePrefix = routeNamePrefixAtOffset(routeGroups, routeStart);

      for (const literal of literals) {
        for (const action of resourceArrayActions) {
          definitions.push({
            name: `${routeNamePrefix}${literal.value}.${action}`,
            position: editorPositionAtOffset(source, literal.quoteStart + 1),
          });
        }
      }

      continue;
    }

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

function laravelResourceRouteActionsForMethod(
  source: string,
  routeMethod: string,
  closeParen: number,
): readonly string[] | null {
  const baseActions = laravelResourceRouteActions.get(routeMethod);

  if (!baseActions) {
    return null;
  }

  const chainStart = closeParen + 1;
  const chainEnd = phpStatementEndOffset(source, chainStart);

  if (!laravelSingletonResourceRouteMethods.has(routeMethod)) {
    return laravelRouteActionsWithOnlyExcept(
      source,
      chainStart,
      chainEnd,
      baseActions,
    );
  }

  const creatable = hasLaravelRouteChainMethod(
    source,
    chainStart,
    chainEnd,
    "creatable",
  );
  const destroyable =
    creatable ||
    hasLaravelRouteChainMethod(source, chainStart, chainEnd, "destroyable");

  if (routeMethod === "apisingleton") {
    return laravelRouteActionsWithOnlyExcept(source, chainStart, chainEnd, [
      ...(creatable ? ["store"] : []),
      "show",
      "update",
      ...(destroyable ? ["destroy"] : []),
    ]);
  }

  return laravelRouteActionsWithOnlyExcept(source, chainStart, chainEnd, [
    ...(creatable ? ["create", "store"] : []),
    ...baseActions,
    ...(destroyable ? ["destroy"] : []),
  ]);
}

function hasLaravelRouteChainMethod(
  source: string,
  chainStart: number,
  chainEnd: number,
  method: string,
): boolean {
  const pattern = new RegExp(`->\\s*${method}\\s*\\(`, "gi");
  const chainSource = source.slice(chainStart, chainEnd);

  for (const match of chainSource.matchAll(pattern)) {
    const methodOpenParen =
      chainStart + (match.index ?? 0) + match[0].lastIndexOf("(");

    if (isPhpCodeOffset(source, methodOpenParen)) {
      return true;
    }
  }

  return false;
}

function laravelRouteActionsWithOnlyExcept(
  source: string,
  chainStart: number,
  chainEnd: number,
  actions: readonly string[],
): readonly string[] {
  const actionSet = new Set(actions);
  const chainSource = source.slice(chainStart, chainEnd);
  const filterPattern = /->\s*(only|except)\s*\(/gi;
  let filteredActions = [...actions];

  for (const match of chainSource.matchAll(filterPattern)) {
    const methodName = match[1]?.toLowerCase();
    const filterOpenParen =
      chainStart + (match.index ?? 0) + match[0].lastIndexOf("(");

    if (!methodName || !isPhpCodeOffset(source, filterOpenParen)) {
      continue;
    }

    const filterActions = laravelRouteActionNamesAtOpenParen(
      source,
      filterOpenParen,
    ).filter((action) => actionSet.has(action));

    if (filterActions.length === 0) {
      continue;
    }

    if (methodName === "only") {
      filteredActions = actions.filter((action) => filterActions.includes(action));
      continue;
    }

    filteredActions = filteredActions.filter(
      (action) => !filterActions.includes(action),
    );
  }

  return filteredActions;
}

function laravelResourceRouteNameOverrides(
  source: string,
  chainStart: number,
  chainEnd: number,
): Map<string, PhpStringLiteral> {
  const overrides = new Map<string, PhpStringLiteral>();
  const chainSource = source.slice(chainStart, chainEnd);
  const namesPattern = /->\s*names\s*\(/gi;

  for (const match of chainSource.matchAll(namesPattern)) {
    const namesOpenParen =
      chainStart + (match.index ?? 0) + match[0].lastIndexOf("(");

    if (!isPhpCodeOffset(source, namesOpenParen)) {
      continue;
    }

    for (const entry of laravelRouteStringMapAtOpenParen(source, namesOpenParen)) {
      overrides.set(entry.key.value, entry.value);
    }
  }

  return overrides;
}

function laravelRouteStringMapAtOpenParen(
  source: string,
  openParen: number,
): Array<{ key: PhpStringLiteral; value: PhpStringLiteral }> {
  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return [];
  }

  const argumentStart = skipWhitespace(source, openParen + 1);

  if (source[argumentStart] !== "[") {
    return [];
  }

  const arrayClose = matchingBracketOffset(source, argumentStart, "[", "]");

  if (arrayClose === null || arrayClose > closeParen) {
    return [];
  }

  return topLevelArrayStringEntries(source, argumentStart, arrayClose);
}

function laravelRouteActionNamesAtOpenParen(
  source: string,
  openParen: number,
): string[] {
  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return [];
  }

  const argumentStart = skipWhitespace(source, openParen + 1);

  if (source[argumentStart] === "[") {
    const arrayClose = matchingBracketOffset(source, argumentStart, "[", "]");

    if (arrayClose === null || arrayClose > closeParen) {
      return [];
    }

    return topLevelArrayStringValues(source, argumentStart, arrayClose);
  }

  return topLevelCallStringArguments(source, openParen, closeParen);
}

function firstArrayLiteralKeysAtOpenParen(
  source: string,
  openParen: number,
  closeParen: number | null,
): PhpStringLiteral[] {
  if (closeParen === null) {
    return [];
  }

  const argumentStart = skipWhitespace(source, openParen + 1);

  if (source[argumentStart] !== "[") {
    return [];
  }

  const arrayClose = matchingBracketOffset(source, argumentStart, "[", "]");

  if (arrayClose === null || arrayClose > closeParen) {
    return [];
  }

  const afterArray = source.slice(arrayClose + 1, closeParen);

  if (!/^\s*(?:,|$)/.test(afterArray)) {
    return [];
  }

  return topLevelArrayStringKeys(source, argumentStart, arrayClose);
}

function topLevelCallStringArguments(
  source: string,
  openParen: number,
  closeParen: number,
): string[] {
  return topLevelStringLiterals(source, openParen, closeParen, {
    include: "values",
  }).map((literal) => literal.value);
}

function topLevelArrayStringKeys(
  source: string,
  arrayOpen: number,
  arrayClose: number,
): PhpStringLiteral[] {
  return topLevelStringLiterals(source, arrayOpen, arrayClose, {
    include: "keys",
  });
}

function topLevelArrayStringValues(
  source: string,
  arrayOpen: number,
  arrayClose: number,
): string[] {
  return topLevelStringLiterals(source, arrayOpen, arrayClose, {
    include: "values",
  }).map((literal) => literal.value);
}

function topLevelArrayStringEntries(
  source: string,
  arrayOpen: number,
  arrayClose: number,
): Array<{ key: PhpStringLiteral; value: PhpStringLiteral }> {
  const entries: Array<{ key: PhpStringLiteral; value: PhpStringLiteral }> = [];
  const keys = topLevelArrayStringKeys(source, arrayOpen, arrayClose);

  for (const key of keys) {
    const arrowStart = skipWhitespace(source, key.quoteEnd + 1);
    const valueStart = skipWhitespace(source, arrowStart + 2);
    const value = stringLiteralStartingAt(source, valueStart);

    if (
      value?.closed &&
      !(value.quote === "\"" && hasPhpVariableInterpolation(value.value))
    ) {
      entries.push({ key, value });
    }
  }

  return entries;
}

function topLevelStringLiterals(
  source: string,
  openOffset: number,
  closeOffset: number,
  options: { include: "keys" | "values" },
): PhpStringLiteral[] {
  const keys: PhpStringLiteral[] = [];
  let blockComment = false;
  let depth = 0;
  let lineComment = false;

  for (let index = openOffset + 1; index < closeOffset; index += 1) {
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
      continue;
    }

    const afterLiteral = skipWhitespace(source, literal.quoteEnd + 1);
    const isKey = source.slice(afterLiteral, afterLiteral + 2) === "=>";
    const includeLiteral = options.include === "keys" ? isKey : !isKey;

    if (
      includeLiteral &&
      !(literal.quote === "\"" && hasPhpVariableInterpolation(literal.value))
    ) {
      keys.push(literal);
    }

    index = literal.quoteEnd;
  }

  return keys;
}

function phpLaravelNamedRouteGroups(
  source: string,
): PhpLaravelNamedRouteGroup[] {
  const groups: PhpLaravelNamedRouteGroup[] = [];
  const routePattern = /\bRoute\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of source.matchAll(routePattern)) {
    const routeStart = match.index ?? 0;
    const routeMethod = match[1]?.toLowerCase() ?? "";

    if (!isPhpCodeOffset(source, routeStart)) {
      continue;
    }

    const routeOpenParen = routeStart + match[0].lastIndexOf("(");
    const routeCloseParen = matchingBracketOffset(
      source,
      routeOpenParen,
      "(",
      ")",
    );

    if (routeCloseParen === null) {
      continue;
    }

    let groupCloseParen = routeCloseParen;
    let groupOpenParen = routeOpenParen;
    let prefixLiterals: PhpStringLiteral[] = [];

    if (routeMethod === "group") {
      prefixLiterals = laravelRouteGroupArrayPrefixLiterals(source, routeOpenParen);
    } else {
      const statementEnd = phpStatementEndOffset(source, routeCloseParen + 1);
      const chainSource = source.slice(routeCloseParen + 1, statementEnd);
      const groupMatch = /->\s*group\s*\(/g.exec(chainSource);

      if (!groupMatch) {
        continue;
      }

      groupOpenParen =
        routeCloseParen +
        1 +
        (groupMatch.index ?? 0) +
        groupMatch[0].lastIndexOf("(");

      if (!isPhpCodeOffset(source, groupOpenParen)) {
        continue;
      }

      prefixLiterals = laravelRouteGroupPrefixLiterals(
        source,
        routeMethod,
        routeOpenParen,
        routeCloseParen,
        groupOpenParen,
      );
      const resolvedGroupCloseParen = matchingBracketOffset(
        source,
        groupOpenParen,
        "(",
        ")",
      );

      if (resolvedGroupCloseParen === null) {
        continue;
      }

      groupCloseParen = resolvedGroupCloseParen;
    }

    if (prefixLiterals.length === 0) {
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
      prefix: prefixLiterals.map((literal) => literal.value).join(""),
    });
  }

  return groups.sort((left, right) => left.bodyStart - right.bodyStart);
}

function laravelRouteGroupArrayPrefixLiterals(
  source: string,
  groupOpenParen: number,
): PhpStringLiteral[] {
  return laravelRouteStringMapAtOpenParen(source, groupOpenParen)
    .filter((entry) => entry.key.value.toLowerCase() === "as")
    .map((entry) => entry.value);
}

function laravelRouteGroupPrefixLiterals(
  source: string,
  routeMethod: string,
  routeOpenParen: number,
  routeCloseParen: number,
  groupOpenParen: number,
): PhpStringLiteral[] {
  const prefixLiterals: PhpStringLiteral[] = [];

  if (routeMethod === "name" || routeMethod === "as") {
    const literal = firstClosedLiteralArgumentAtOpenParen(source, routeOpenParen);

    if (literal) {
      prefixLiterals.push(literal);
    }
  }

  const chainSource = source.slice(routeCloseParen + 1, groupOpenParen);
  const prefixPattern = /->\s*(?:name|as)\s*\(/gi;

  for (const match of chainSource.matchAll(prefixPattern)) {
    const prefixOpenParen =
      routeCloseParen + 1 + (match.index ?? 0) + match[0].lastIndexOf("(");

    if (!isPhpCodeOffset(source, prefixOpenParen)) {
      continue;
    }

    const literal = firstClosedLiteralArgumentAtOpenParen(source, prefixOpenParen);

    if (literal) {
      prefixLiterals.push(literal);
    }
  }

  return prefixLiterals;
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

  if (/\bRedirect\s*::\s*route\s*$/i.test(beforeCall)) {
    return "Redirect::route";
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
  const literal = firstLiteralArgumentAtOpenParen(source, openParen);

  if (!literal) {
    return null;
  }

  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return null;
  }

  const afterLiteral = source.slice(literal.quoteEnd + 1, closeParen);

  return /^\s*$/.test(afterLiteral) ? literal : null;
}

function firstLiteralArgumentAtOpenParen(
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

  if (!/^\s*(?:,|$)/.test(afterLiteral)) {
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

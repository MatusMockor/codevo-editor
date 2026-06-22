import type { EditorPosition } from "./languageServerFeatures";

export type PhpLaravelNamedRouteReferenceCall =
  | "route"
  | "to_route"
  | "redirect()->route"
  | "redirect()->signedRoute"
  | "redirect()->temporarySignedRoute"
  | "Redirect::route"
  | "Redirect::signedRoute"
  | "Redirect::temporarySignedRoute"
  | "URL::route"
  | "URL::signedRoute"
  | "URL::temporarySignedRoute"
  | "Uri::route"
  | "Uri::signedRoute"
  | "Uri::temporarySignedRoute"
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

interface PhpLaravelNamedRouteReferenceArgument {
  argumentName: string | null;
  openParen: number;
}

interface PhpVariableReference {
  end: number;
  name: string;
  start: number;
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
    return phpLaravelNamedRouteVariableReferenceContextAt(source, offset);
  }

  const argument = firstArgumentCallContextAt(source, literal);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  const call = laravelNamedRouteReferenceCallAt(source, argument.openParen);

  if (
    !call ||
    !isSupportedNamedRouteArgumentName(call, argument.argumentName)
  ) {
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

function phpLaravelNamedRouteVariableReferenceContextAt(
  source: string,
  offset: number,
): PhpLaravelNamedRouteReferenceContext | null {
  const variable = phpVariableReferenceAtOffset(source, offset);

  if (!variable) {
    return null;
  }

  const argument = firstArgumentCallContextForVariable(source, variable);

  if (!argument || !isPhpCodeOffset(source, argument.openParen)) {
    return null;
  }

  const call = laravelNamedRouteReferenceCallAt(source, argument.openParen);

  if (
    !call ||
    !isSupportedNamedRouteArgumentName(call, argument.argumentName)
  ) {
    return null;
  }

  const literalValue = phpVariableAssignedStringLiteralBefore(
    source,
    variable.name,
    argument.openParen,
  );

  if (literalValue === null) {
    return null;
  }

  return {
    call,
    name: literalValue,
    position: editorPositionAtOffset(source, variable.start),
    prefix: literalValue,
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
      const literal = firstLiteralArgumentAtOpenParen(source, openParen, {
        namedArgumentNames: ["name"],
      });

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

    const actionNameLiteral = laravelRouteActionArrayNameLiteralAtOpenParen(
      source,
      openParen,
      closeParen,
    );

    if (actionNameLiteral) {
      definitions.push({
        name: `${routeNamePrefixAtOffset(routeGroups, routeStart)}${
          actionNameLiteral.value
        }`,
        position: editorPositionAtOffset(source, actionNameLiteral.quoteStart + 1),
      });
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

      const literal = firstClosedLiteralArgumentAtOpenParen(source, nameOpenParen, {
        namedArgumentNames: ["name"],
      });

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

function laravelRouteActionArrayNameLiteralAtOpenParen(
  source: string,
  openParen: number,
  closeParen: number,
): PhpStringLiteral | null {
  const actionArgumentStart =
    topLevelArgumentValueStartAt(source, openParen, closeParen, {
      namedArgumentNames: ["action"],
    }) ??
    topLevelArgumentValueStartAt(source, openParen, closeParen, {
      argumentIndex: 1,
    });

  if (actionArgumentStart === null || source[actionArgumentStart] !== "[") {
    return null;
  }

  const actionArrayEnd = matchingBracketOffset(
    source,
    actionArgumentStart,
    "[",
    "]",
  );

  if (actionArrayEnd === null || actionArrayEnd > closeParen) {
    return null;
  }

  const afterActionArray = source.slice(actionArrayEnd + 1, closeParen);

  if (!/^\s*(?:,|$)/.test(afterActionArray)) {
    return null;
  }

  return (
    topLevelArrayStringEntries(source, actionArgumentStart, actionArrayEnd).find(
      (entry) => entry.key.value.toLowerCase() === "as",
    )?.value ?? null
  );
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
      [methodName],
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

    for (const entry of laravelRouteStringMapAtOpenParen(source, namesOpenParen, [
      "names",
    ])) {
      overrides.set(entry.key.value, entry.value);
    }
  }

  return overrides;
}

function laravelRouteStringMapAtOpenParen(
  source: string,
  openParen: number,
  namedArgumentNames: readonly string[] = [],
): Array<{ key: PhpStringLiteral; value: PhpStringLiteral }> {
  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return [];
  }

  const argumentStart = skipWhitespace(source, openParen + 1);
  const namedValueStart = namedArgumentValueStartAt(
    source,
    argumentStart,
    namedArgumentNames,
  );
  const hasUnsupportedNamedArgument =
    namedValueStart === null &&
    /^[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)/.test(
      source.slice(argumentStart, closeParen),
    );
  const valueStart = namedValueStart ?? argumentStart;

  if (hasUnsupportedNamedArgument || source[valueStart] !== "[") {
    return [];
  }

  const arrayClose = matchingBracketOffset(source, valueStart, "[", "]");

  if (arrayClose === null || arrayClose > closeParen) {
    return [];
  }

  return topLevelArrayStringEntries(source, valueStart, arrayClose);
}

function laravelRouteActionNamesAtOpenParen(
  source: string,
  openParen: number,
  namedArgumentNames: readonly string[] = [],
): string[] {
  const closeParen = matchingBracketOffset(source, openParen, "(", ")");

  if (closeParen === null) {
    return [];
  }

  const argumentStart = skipWhitespace(source, openParen + 1);
  const namedValueStart = namedArgumentValueStartAt(
    source,
    argumentStart,
    namedArgumentNames,
  );
  const hasUnsupportedNamedArgument =
    namedValueStart === null &&
    /^[A-Za-z_][A-Za-z0-9_]*\s*:(?!:)/.test(
      source.slice(argumentStart, closeParen),
    );
  const valueStart = namedValueStart ?? argumentStart;

  if (hasUnsupportedNamedArgument) {
    return [];
  }

  if (source[valueStart] === "[") {
    const arrayClose = matchingBracketOffset(source, valueStart, "[", "]");

    if (arrayClose === null || arrayClose > closeParen) {
      return [];
    }

    return topLevelArrayStringValues(source, valueStart, arrayClose);
  }

  if (namedValueStart !== null) {
    const literal = stringLiteralStartingAt(source, namedValueStart);

    if (!literal?.closed) {
      return [];
    }

    const afterLiteral = source.slice(literal.quoteEnd + 1, closeParen);

    if (!/^\s*(?:,|$)/.test(afterLiteral)) {
      return [];
    }

    return literal.quote === "\"" && hasPhpVariableInterpolation(literal.value)
      ? []
      : [literal.value];
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
      !(value.quote === "\"" && hasPhpVariableInterpolation(value.value)) &&
      isTopLevelArrayStringEntryValueEnd(source, value, arrayClose)
    ) {
      entries.push({ key, value });
    }
  }

  return entries;
}

function isTopLevelArrayStringEntryValueEnd(
  source: string,
  value: PhpStringLiteral,
  arrayClose: number,
): boolean {
  const valueEnd = skipWhitespace(source, value.quoteEnd + 1);

  return valueEnd === arrayClose || source[valueEnd] === ",";
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

    const groupBody = laravelRouteGroupBodyRange(
      source,
      groupOpenParen,
      groupCloseParen,
      routeMethod === "group" ? 1 : 0,
    );

    if (!groupBody) {
      continue;
    }

    groups.push({
      bodyEnd: groupBody.bodyEnd,
      bodyStart: groupBody.bodyStart,
      prefix: prefixLiterals.map((literal) => literal.value).join(""),
    });
  }

  return groups.sort((left, right) => left.bodyStart - right.bodyStart);
}

function laravelRouteGroupBodyRange(
  source: string,
  groupOpenParen: number,
  groupCloseParen: number,
  positionalRoutesIndex: number,
): { bodyEnd: number; bodyStart: number } | null {
  const routesStart =
    topLevelArgumentValueStartAt(source, groupOpenParen, groupCloseParen, {
      namedArgumentNames: ["routes"],
    }) ??
    topLevelArgumentValueStartAt(source, groupOpenParen, groupCloseParen, {
      argumentIndex: positionalRoutesIndex,
    });

  if (routesStart === null) {
    return null;
  }

  return (
    laravelRouteGroupArrowBodyRange(source, routesStart, groupCloseParen) ??
    laravelRouteGroupClosureBodyRange(source, routesStart, groupCloseParen)
  );
}

function laravelRouteGroupArrowBodyRange(
  source: string,
  routesStart: number,
  groupCloseParen: number,
): { bodyEnd: number; bodyStart: number } | null {
  const match = /^(?:static\s+)?fn\s*\(/.exec(
    source.slice(routesStart, Math.min(groupCloseParen, routesStart + 96)),
  );

  if (!match) {
    return null;
  }

  const parametersOpen = routesStart + match[0].lastIndexOf("(");
  const parametersClose = matchingBracketOffset(source, parametersOpen, "(", ")");

  if (parametersClose === null || parametersClose > groupCloseParen) {
    return null;
  }

  const arrowStart = skipWhitespace(source, parametersClose + 1);

  if (source.slice(arrowStart, arrowStart + 2) !== "=>") {
    return null;
  }

  return {
    bodyEnd: groupCloseParen,
    bodyStart: arrowStart + 2,
  };
}

function laravelRouteGroupClosureBodyRange(
  source: string,
  routesStart: number,
  groupCloseParen: number,
): { bodyEnd: number; bodyStart: number } | null {
  if (!/^(?:static\s+)?function\b/.test(source.slice(routesStart, routesStart + 96))) {
    return null;
  }

  const bodyStart = source.indexOf("{", routesStart);

  if (bodyStart < 0 || bodyStart > groupCloseParen) {
    return null;
  }

  const bodyEnd = matchingBracketOffset(source, bodyStart, "{", "}");

  if (bodyEnd === null || bodyEnd > groupCloseParen) {
    return null;
  }

  return { bodyEnd, bodyStart };
}

function laravelRouteGroupArrayPrefixLiterals(
  source: string,
  groupOpenParen: number,
): PhpStringLiteral[] {
  return laravelRouteStringMapAtOpenParen(source, groupOpenParen, ["attributes"])
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
    const literal = firstClosedLiteralArgumentAtOpenParen(
      source,
      routeOpenParen,
      routeMethod === "name" ? { namedArgumentNames: ["name"] } : undefined,
    );

    if (literal) {
      prefixLiterals.push(literal);
    }
  }

  const chainSource = source.slice(routeCloseParen + 1, groupOpenParen);
  const prefixPattern = /->\s*(name|as)\s*\(/gi;

  for (const match of chainSource.matchAll(prefixPattern)) {
    const prefixOpenParen =
      routeCloseParen + 1 + (match.index ?? 0) + match[0].lastIndexOf("(");
    const prefixMethod = match[1]?.toLowerCase() ?? "";

    if (!isPhpCodeOffset(source, prefixOpenParen)) {
      continue;
    }

    const literal = firstClosedLiteralArgumentAtOpenParen(
      source,
      prefixOpenParen,
      prefixMethod === "name" ? { namedArgumentNames: ["name"] } : undefined,
    );

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

  if (/\bredirect\s*\(\s*\)\s*->\s*signedRoute\s*$/i.test(beforeCall)) {
    return "redirect()->signedRoute";
  }

  if (
    /\bredirect\s*\(\s*\)\s*->\s*temporarySignedRoute\s*$/i.test(beforeCall)
  ) {
    return "redirect()->temporarySignedRoute";
  }

  if (/\bRedirect\s*::\s*route\s*$/i.test(beforeCall)) {
    return "Redirect::route";
  }

  if (/\bRedirect\s*::\s*signedRoute\s*$/i.test(beforeCall)) {
    return "Redirect::signedRoute";
  }

  if (/\bRedirect\s*::\s*temporarySignedRoute\s*$/i.test(beforeCall)) {
    return "Redirect::temporarySignedRoute";
  }

  if (/\bURL\s*::\s*route\s*$/i.test(beforeCall)) {
    return "URL::route";
  }

  if (/\bURL\s*::\s*signedRoute\s*$/i.test(beforeCall)) {
    return "URL::signedRoute";
  }

  if (/\bURL\s*::\s*temporarySignedRoute\s*$/i.test(beforeCall)) {
    return "URL::temporarySignedRoute";
  }

  if (/\bUri\s*::\s*route\s*$/i.test(beforeCall)) {
    return "Uri::route";
  }

  if (/\bUri\s*::\s*signedRoute\s*$/i.test(beforeCall)) {
    return "Uri::signedRoute";
  }

  if (/\bUri\s*::\s*temporarySignedRoute\s*$/i.test(beforeCall)) {
    return "Uri::temporarySignedRoute";
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

function firstArgumentCallContextAt(
  source: string,
  literal: PhpStringLiteral,
): PhpLaravelNamedRouteReferenceArgument | null {
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
      topLevelArgumentIndexAtOffset(source, openParen, literal.quoteStart) !== 0
    ) {
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

    return { argumentName, openParen };
  }

  return null;
}

function namedArgumentNameBeforeLiteral(
  source: string,
  startOffset: number,
  literalStartOffset: number,
): string | null | undefined {
  if (isTopLevelWhitespaceBetween(source, startOffset, literalStartOffset)) {
    return null;
  }

  const prefix = source.slice(startOffset, literalStartOffset);
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:\s*$/.exec(prefix);

  return match?.[1] ?? undefined;
}

function phpVariableReferenceAtOffset(
  source: string,
  offset: number,
): PhpVariableReference | null {
  for (
    let start = source.lastIndexOf("$", Math.min(offset, source.length - 1));
    start >= 0;
    start = source.lastIndexOf("$", start - 1)
  ) {
    const match = /^\$[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(start));

    if (!match) {
      continue;
    }

    const end = start + match[0].length;

    if (offset < start || offset > end) {
      return null;
    }

    return { end, name: match[0].slice(1), start };
  }

  return null;
}

function firstArgumentCallContextForVariable(
  source: string,
  variable: PhpVariableReference,
): PhpLaravelNamedRouteReferenceArgument | null {
  for (
    let openParen = source.lastIndexOf("(", variable.start);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen === null || variable.start > closeParen) {
      continue;
    }

    if (
      topLevelArgumentIndexAtOffset(source, openParen, variable.start) !== 0
    ) {
      continue;
    }

    if (!isSoleFirstArgumentVariable(source, closeParen, variable)) {
      continue;
    }

    const argumentName = namedArgumentNameBeforeLiteral(
      source,
      openParen + 1,
      variable.start,
    );

    if (argumentName === undefined) {
      continue;
    }

    return { argumentName, openParen };
  }

  return null;
}

function isSoleFirstArgumentVariable(
  source: string,
  closeParen: number,
  variable: PhpVariableReference,
): boolean {
  const afterVariable = source.slice(
    variable.end,
    Math.min(closeParen + 1, source.length),
  );

  return /^\s*(?:,|\))/.test(afterVariable);
}

function phpVariableAssignedStringLiteralBefore(
  source: string,
  variableName: string,
  beforeOffset: number,
): string | null {
  const scope = source.slice(0, beforeOffset);
  const assignmentPattern = new RegExp(
    `\\$${escapeRegExp(variableName)}\\s*([.+\\-*/%&|^]|\\?\\?|<<|>>)?=(?!=|>)\\s*`,
    "g",
  );
  let resolvedValue: string | null = null;
  let assignmentCount = 0;

  for (const match of scope.matchAll(assignmentPattern)) {
    const assignmentStart = match.index ?? 0;

    if (!isPhpCodeOffset(source, assignmentStart)) {
      continue;
    }

    if (match[1]) {
      return null;
    }

    assignmentCount += 1;
    resolvedValue = phpAssignedStringLiteralValueAt(
      source,
      assignmentStart + match[0].length,
    );
  }

  if (assignmentCount !== 1) {
    return null;
  }

  return resolvedValue;
}

function phpAssignedStringLiteralValueAt(
  source: string,
  valueStart: number,
): string | null {
  const literal = stringLiteralStartingAt(source, valueStart);

  if (!literal?.closed) {
    return null;
  }

  if (literal.quote === "\"" && hasPhpVariableInterpolation(literal.value)) {
    return null;
  }

  const afterLiteral = skipWhitespace(source, literal.quoteEnd + 1);

  if (source[afterLiteral] !== ";") {
    return null;
  }

  return literal.value;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topLevelArgumentValueStartAt(
  source: string,
  openParenOffset: number,
  closeParenOffset: number,
  options: {
    argumentIndex?: number;
    namedArgumentNames?: readonly string[];
  },
): number | null {
  let argumentIndex = 0;
  let argumentStart = openParenOffset + 1;
  let depth = 0;
  let quote: "'" | "\"" | null = null;

  const argumentValueStart = (
    startOffset: number,
    endOffset: number,
  ): number | null => {
    const start = skipWhitespace(source, startOffset);

    if (start >= endOffset) {
      return null;
    }

    const namedMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*/.exec(
      source.slice(start, Math.min(endOffset, start + 96)),
    );
    const namedValueStart = namedMatch?.[0] ? start + namedMatch[0].length : null;
    const namedArgumentName = namedMatch?.[1]?.toLowerCase() ?? null;

    if (
      namedValueStart !== null &&
      options.namedArgumentNames?.some(
        (name) => name.toLowerCase() === namedArgumentName,
      )
    ) {
      return namedValueStart;
    }

    if (
      options.argumentIndex !== undefined &&
      argumentIndex === options.argumentIndex
    ) {
      return namedValueStart ?? start;
    }

    return null;
  };

  for (let index = openParenOffset + 1; index <= closeParenOffset; index += 1) {
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

    if (index === closeParenOffset || (character === "," && depth === 0)) {
      const valueStart = argumentValueStart(argumentStart, index);

      if (valueStart !== null) {
        return valueStart;
      }

      argumentIndex += 1;
      argumentStart = index + 1;
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
  }

  return null;
}

function isSupportedNamedRouteArgumentName(
  call: PhpLaravelNamedRouteReferenceCall,
  argumentName: string | null,
): boolean {
  if (!argumentName) {
    return true;
  }

  const normalizedName = argumentName.toLowerCase();

  if (
    call === "to_route" ||
    call.startsWith("redirect()->") ||
    call.startsWith("Redirect::")
  ) {
    return normalizedName === "route";
  }

  return normalizedName === "name";
}

function firstClosedLiteralArgumentAtOpenParen(
  source: string,
  openParen: number,
  options: { namedArgumentNames?: readonly string[] } = {},
): PhpStringLiteral | null {
  const literal = firstLiteralArgumentAtOpenParen(source, openParen, options);

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
  options: { namedArgumentNames?: readonly string[] } = {},
): PhpStringLiteral | null {
  const argumentStart = skipWhitespace(source, openParen + 1);
  const namedLiteralStart = namedLiteralArgumentQuoteStartAt(
    source,
    argumentStart,
    options.namedArgumentNames ?? [],
  );
  const literalStart = namedLiteralStart ?? argumentStart;
  const literal = stringLiteralStartingAt(source, literalStart);

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

function namedLiteralArgumentQuoteStartAt(
  source: string,
  argumentStart: number,
  allowedNames: readonly string[],
): number | null {
  return namedArgumentValueStartAt(source, argumentStart, allowedNames);
}

function namedArgumentValueStartAt(
  source: string,
  argumentStart: number,
  allowedNames: readonly string[],
): number | null {
  if (allowedNames.length === 0) {
    return null;
  }

  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:\s*/.exec(
    source.slice(argumentStart, argumentStart + 96),
  );

  if (!match?.[0] || !match[1]) {
    return null;
  }

  const normalizedName = match[1].toLowerCase();

  if (!allowedNames.some((name) => name.toLowerCase() === normalizedName)) {
    return null;
  }

  return argumentStart + match[0].length;
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

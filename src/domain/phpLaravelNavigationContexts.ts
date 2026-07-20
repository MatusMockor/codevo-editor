import type { EditorPosition } from "./languageServerFeatures";
import { isPhpCodeOffset } from "./phpLexicalContext";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";
import {
  enclosingBracketStart,
  identifierAtOffset,
  isTopLevelBetween,
  isTopLevelWhitespaceBetween,
  matchingBracketOffset,
  offsetAtPosition,
  scanTopLevel,
  stringLiteralAtOffset,
  stringLiteralCompletionAtOffset,
  topLevelArgumentIndexAtOffset,
  topLevelCallArgumentIndexAt,
  topLevelCallArgumentNameAtOffset,
  type IdentifierAtOffset,
  type StringLiteralRange,
} from "./phpSourceScanning";

export interface PhpLaravelRouteActionMethodContext {
  className: string;
  kind: "laravelRouteActionMethod";
  methodName: string;
}

export interface PhpLaravelRelationStringContext {
  className: string | null;
  kind: "laravelRelationString";
  methodName: string;
  previousRelationNames?: string[];
  receiverExpression: string | null;
  relationName: string;
}

export type PhpLaravelIdentifierContext =
  | PhpLaravelRouteActionMethodContext
  | PhpLaravelRelationStringContext
  | {
      kind: "laravelNamedRouteString";
      routeName: string;
    }
  | {
      configKey: string;
      kind: "laravelConfigString";
    }
  | {
      guardName: string;
      kind: "laravelAuthGuardString";
    }
  | {
      ability: string;
      kind: "laravelGateAbilityString";
    }
  | {
      alias: string;
      kind: "laravelMiddlewareAliasString";
    }
  | {
      kind: "laravelCacheStoreString";
      storeName: string;
    }
  | {
      connectionName: string;
      kind: "laravelDatabaseConnectionString";
    }
  | {
      connectionName: string;
      kind: "laravelBroadcastConnectionString";
    }
  | {
      connectionName: string;
      kind: "laravelQueueConnectionString";
    }
  | {
      envName: string;
      kind: "laravelEnvString";
    }
  | {
      kind: "laravelMailMailerString";
      mailerName: string;
    }
  | {
      brokerName: string;
      kind: "laravelPasswordBrokerString";
    }
  | {
      connectionName: string;
      kind: "laravelRedisConnectionString";
    }
  | {
      channelName: string;
      kind: "laravelLogChannelString";
    }
  | {
      diskName: string;
      kind: "laravelStorageDiskString";
    }
  | {
      kind: "laravelTranslationString";
      translationKey: string;
    }
  | {
      kind: "laravelViewString";
      viewName: string;
    }
  | {
      kind: "laravelValidationTableString";
      tableName: string;
    };

const PHP_LARAVEL_IDENTIFIER_CONTEXT_KINDS: ReadonlySet<string> = new Set<
  PhpLaravelIdentifierContext["kind"]
>([
  "laravelAuthGuardString",
  "laravelBroadcastConnectionString",
  "laravelCacheStoreString",
  "laravelConfigString",
  "laravelDatabaseConnectionString",
  "laravelEnvString",
  "laravelGateAbilityString",
  "laravelLogChannelString",
  "laravelMailMailerString",
  "laravelMiddlewareAliasString",
  "laravelNamedRouteString",
  "laravelPasswordBrokerString",
  "laravelQueueConnectionString",
  "laravelRedisConnectionString",
  "laravelRelationString",
  "laravelRouteActionMethod",
  "laravelStorageDiskString",
  "laravelTranslationString",
  "laravelValidationTableString",
  "laravelViewString",
]);

export function isPhpLaravelIdentifierContext(context: {
  kind: string;
}): context is PhpLaravelIdentifierContext {
  return PHP_LARAVEL_IDENTIFIER_CONTEXT_KINDS.has(context.kind);
}

export interface PhpLaravelRelationStringCompletionContext {
  className: string | null;
  methodName: string;
  previousRelationNames?: string[];
  prefix: string;
  receiverExpression: string | null;
}

export interface PhpLaravelRouteActionMethodCompletionContext {
  className: string;
  prefix: string;
}

export interface PhpLaravelMethodDefinitionHint {
  className: string;
  methodName: string;
}

const laravelControllerGroupRouteMethods = new Set([
  "any",
  "delete",
  "get",
  "match",
  "options",
  "patch",
  "post",
  "put",
]);

const laravelRelationStringMethods = new Set([
  "doesnthave",
  "doesnthavemorph",
  "has",
  "hasmorph",
  "load",
  "loadaggregate",
  "loadavg",
  "loadcount",
  "loadmax",
  "loadmin",
  "loadmissing",
  "loadmorph",
  "loadmorphaggregate",
  "loadmorphavg",
  "loadmorphmax",
  "loadmorphmin",
  "loadmorphsum",
  "loadsum",
  "ordoesnthave",
  "ordoesnthavemorph",
  "orhas",
  "orhasmorph",
  "orwherehas",
  "orwherehasmorph",
  "orwheredoesnthaverelation",
  "orwheredoesnthave",
  "orwheredoesnthavemorph",
  "orwheremorphdoesnthaverelation",
  "orwhererelation",
  "with",
  "withavg",
  "withcount",
  "withexists",
  "withonly",
  "withmax",
  "withmin",
  "withsum",
  "withwherehas",
  "withwhererelation",
  "wherehas",
  "wherehasmorph",
  "wheredoesnthaverelation",
  "wheredoesnthavemorph",
  "wheremorphedto",
  "wheremorphdoesnthaverelation",
  "wheredoesnthave",
  "whererelation",
  "without",
]);

export function phpLaravelRelationStringCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelRelationStringCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralCompletionAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const relationPrefix = laravelRelationPrefixContext(literal.prefix);

  if (!relationPrefix) {
    return null;
  }

  const openParen = laravelRelationArgumentCallOpenParenAt(source, literal);

  const callContext =
    openParen === null ? null : laravelRelationCallContextAt(source, openParen);

  if (!callContext) {
    return null;
  }

  return {
    ...callContext,
    ...(relationPrefix.previousRelationNames.length
      ? { previousRelationNames: relationPrefix.previousRelationNames }
      : {}),
    prefix: relationPrefix.prefix,
  };
}

export function phpLaravelRouteActionMethodCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelRouteActionMethodCompletionContext | null {
  const offset = offsetAtPosition(source, position);
  const literal = stringLiteralCompletionAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  if (literal.prefix && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(literal.prefix)) {
    return null;
  }

  const controllerGroupClassName = laravelControllerGroupClassNameForRouteAction(
    source,
    literal,
  );

  if (controllerGroupClassName) {
    return {
      className: controllerGroupClassName,
      prefix: literal.prefix,
    };
  }

  const arrayStart = source.lastIndexOf("[", literal.quoteStart);

  if (arrayStart < 0) {
    return null;
  }

  const arrayEnd = matchingBracketOffset(source, arrayStart, "[", "]");

  if (!arrayEnd || literal.quoteEnd > arrayEnd) {
    return null;
  }

  if (!laravelRouteCallForActionArgument(source, arrayStart)) {
    return null;
  }

  const beforeLiteral = source.slice(arrayStart + 1, literal.quoteStart);
  const classMatch =
    /(?:^|[,\s])((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*class\s*,\s*$/m.exec(
      beforeLiteral,
    );

  if (!classMatch?.[1]) {
    return null;
  }

  return {
    className: classMatch[1],
    prefix: literal.prefix,
  };
}

export function phpLaravelRequestMethodDefinition(
  variableType: string | null,
  methodName: string,
): PhpLaravelMethodDefinitionHint | null {
  if (!variableType) {
    return null;
  }

  if (!variableType.endsWith("Request")) {
    return null;
  }

  if (methodName === "input") {
    return {
      className: "Illuminate\\Http\\Concerns\\InteractsWithInput",
      methodName,
    };
  }

  if (methodName === "boolean") {
    return {
      className: "Illuminate\\Support\\Traits\\InteractsWithData",
      methodName,
    };
  }

  return null;
}

export function phpLaravelRelationStringIdentifierContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelRelationStringContext | null {
  const identifier = identifierAtOffset(source, offsetAtPosition(source, position));

  if (!identifier) {
    return null;
  }

  return laravelRelationStringContextAt(source, identifier);
}

export function phpLaravelRouteActionIdentifierContextAt(
  source: string,
  position: EditorPosition,
): PhpLaravelRouteActionMethodContext | null {
  const identifier = identifierAtOffset(source, offsetAtPosition(source, position));

  if (!identifier) {
    return null;
  }

  return laravelRouteActionContextAt(source, identifier);
}

function laravelRelationStringContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpLaravelRelationStringContext | null {
  const literal = stringLiteralAtOffset(source, identifier.start);

  if (!literal) {
    return null;
  }

  const relationSegment = laravelRelationSegmentContext(
    literal.value,
    identifier.start - literal.quoteStart - 1,
    identifier.end - literal.quoteStart - 1,
  );

  if (!relationSegment) {
    return null;
  }

  const openParen = laravelRelationArgumentCallOpenParenAt(source, literal);

  const callContext =
    openParen === null ? null : laravelRelationCallContextAt(source, openParen);

  if (!callContext) {
    return null;
  }

  return {
    ...callContext,
    kind: "laravelRelationString",
    ...(relationSegment.previousRelationNames.length
      ? { previousRelationNames: relationSegment.previousRelationNames }
      : {}),
    relationName: relationSegment.relationName,
  };
}

function laravelRelationArgumentCallOpenParenAt(
  source: string,
  literal: StringLiteralRange,
): number | null {
  for (
    let openParen = source.lastIndexOf("(", literal.quoteStart);
    openParen >= 0;
    openParen = source.lastIndexOf("(", openParen - 1)
  ) {
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (closeParen !== null && literal.quoteEnd > closeParen) {
      continue;
    }

    if (
      isDirectFirstArgumentString(source, openParen, closeParen, literal.quoteStart)
    ) {
      return openParen;
    }

    if (isFirstArgumentArrayRelationString(source, openParen, closeParen, literal)) {
      return openParen;
    }
  }

  return null;
}

function isDirectFirstArgumentString(
  source: string,
  openParen: number,
  closeParen: number | null,
  quoteStart: number,
): boolean {
  const argumentName = topLevelCallArgumentNameAtOffset(
    source,
    openParen,
    closeParen,
    quoteStart,
  );
  const argumentIndex = topLevelArgumentIndexAtOffset(
    source,
    openParen,
    quoteStart,
  );

  if (isLaravelRelationNamedArgument(argumentName)) {
    return true;
  }

  return (
    argumentIndex === 0 &&
    isTopLevelWhitespaceBetween(source, openParen + 1, quoteStart)
  );
}

function isFirstArgumentArrayRelationString(
  source: string,
  openParen: number,
  closeParen: number | null,
  literal: StringLiteralRange,
): boolean {
  if (closeParen === null) {
    return false;
  }

  const arrayStart = enclosingBracketStart(source, literal.quoteStart, "[", "]");

  if (arrayStart === null || arrayStart < openParen) {
    return false;
  }

  const arrayEnd = matchingBracketOffset(source, arrayStart, "[", "]");

  if (arrayEnd === null || literal.quoteEnd > arrayEnd) {
    return false;
  }

  const argumentName = topLevelCallArgumentNameAtOffset(
    source,
    openParen,
    closeParen,
    arrayStart,
  );
  const argumentIndex = topLevelArgumentIndexAtOffset(
    source,
    openParen,
    arrayStart,
  );

  if (
    !isLaravelRelationNamedArgument(argumentName) &&
    (argumentIndex !== 0 ||
      !isTopLevelWhitespaceBetween(source, openParen + 1, arrayStart))
  ) {
    return false;
  }

  if (!isTopLevelBetween(source, arrayStart + 1, literal.quoteStart)) {
    return false;
  }

  return topLevelArrayRelationLiteralRole(source, arrayStart, arrayEnd, literal) !== null;
}

function isLaravelRelationNamedArgument(argumentName: string | null): boolean {
  const normalizedName = argumentName?.toLowerCase();

  return normalizedName === "relation" || normalizedName === "relations";
}

function topLevelArrayRelationLiteralRole(
  source: string,
  arrayStart: number,
  arrayEnd: number,
  literal: StringLiteralRange,
): "element" | "key" | null {
  const itemStart = previousTopLevelArrayDelimiter(source, arrayStart, literal.quoteStart);
  const literalAfterOffset =
    literal.quoteEnd > literal.quoteStart ? literal.quoteEnd + 1 : literal.quoteEnd;
  const itemEnd = nextTopLevelArrayDelimiter(source, literalAfterOffset, arrayEnd);
  const beforeLiteral = source.slice(itemStart, literal.quoteStart);
  const afterLiteral = source.slice(literalAfterOffset, itemEnd);

  if (hasTopLevelDoubleArrow(beforeLiteral)) {
    return null;
  }

  if (hasTopLevelDoubleArrow(afterLiteral)) {
    return "key";
  }

  if (/^\s*$/.test(beforeLiteral) && /^\s*$/.test(afterLiteral)) {
    return "element";
  }

  return null;
}

function previousTopLevelArrayDelimiter(
  source: string,
  arrayStart: number,
  targetOffset: number,
): number {
  let delimiter = arrayStart + 1;

  scanTopLevel(source, arrayStart + 1, targetOffset, (index, character) => {
    if (character === ",") {
      delimiter = index + 1;
    }
  });

  return delimiter;
}

function nextTopLevelArrayDelimiter(
  source: string,
  startOffset: number,
  arrayEnd: number,
): number {
  let delimiter = arrayEnd;

  scanTopLevel(source, startOffset, arrayEnd, (index, character) => {
    if (character === "," && delimiter === arrayEnd) {
      delimiter = index;
    }
  });

  return delimiter;
}

function hasTopLevelDoubleArrow(source: string): boolean {
  let found = false;

  scanTopLevel(source, 0, source.length, (index) => {
    if (source.slice(index, index + 2) === "=>") {
      found = true;
    }
  });

  return found;
}

function laravelRelationCallContextAt(
  source: string,
  openParen: number,
): Omit<PhpLaravelRelationStringContext, "kind" | "relationName"> | null {
  const beforeCall = source.slice(Math.max(0, openParen - 800), openParen);
  const memberPattern = new RegExp(
    `(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:\\s*->\\s*[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\([^)]*\\))?)*)\\s*->\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*$`,
  );
  const memberMatch = memberPattern.exec(beforeCall);

  if (memberMatch?.[1] && memberMatch[2]) {
    const methodName = memberMatch[2];

    if (!laravelRelationStringMethods.has(methodName.toLowerCase())) {
      return null;
    }

    return {
      className: null,
      methodName,
      receiverExpression: phpNormalizeReceiverExpression(memberMatch[1]),
    };
  }

  const staticMatch =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/.exec(
      beforeCall,
    );

  if (!staticMatch?.[1] || !staticMatch[2]) {
    return null;
  }

  const methodName = staticMatch[2];

  if (!laravelRelationStringMethods.has(methodName.toLowerCase())) {
    return null;
  }

  return {
    className: staticMatch[1].replace(/^\\+/, ""),
    methodName,
    receiverExpression: null,
  };
}

function laravelRouteActionContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpLaravelRouteActionMethodContext | null {
  const invokableRouteAction = laravelInvokableRouteActionContextAt(
    source,
    identifier,
  );

  if (invokableRouteAction) {
    return invokableRouteAction;
  }

  const literal = stringLiteralAtOffset(source, identifier.start);

  if (!literal) {
    return null;
  }

  const stringRouteAction = laravelRouteActionStringContextAt(source, literal);

  if (stringRouteAction) {
    return stringRouteAction;
  }

  if (literal.value !== identifier.name) {
    return null;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(literal.value)) {
    return null;
  }

  const controllerGroupClassName = laravelControllerGroupClassNameForRouteAction(
    source,
    literal,
  );

  if (controllerGroupClassName) {
    return {
      className: controllerGroupClassName,
      kind: "laravelRouteActionMethod",
      methodName: literal.value,
    };
  }

  const arrayStart = source.lastIndexOf("[", literal.quoteStart);

  if (arrayStart < 0) {
    return null;
  }

  const arrayEnd = matchingBracketOffset(source, arrayStart, "[", "]");

  if (!arrayEnd || literal.quoteEnd > arrayEnd) {
    return null;
  }

  const beforeLiteral = source.slice(arrayStart + 1, literal.quoteStart);
  const classMatch =
    /(?:^|[,\s])((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*class\s*,\s*$/m.exec(
      beforeLiteral,
    );

  if (!classMatch?.[1]) {
    return null;
  }

  return {
    className: classMatch[1],
    kind: "laravelRouteActionMethod",
    methodName: literal.value,
  };
}

const laravelRouteActionStringPattern =
  /^(\\{0,2}[A-Za-z_][A-Za-z0-9_]*(?:\\{1,2}[A-Za-z_][A-Za-z0-9_]*)*)@([A-Za-z_][A-Za-z0-9_]*)$/;

function laravelRouteActionStringContextAt(
  source: string,
  literal: StringLiteralRange & { value: string },
): PhpLaravelRouteActionMethodContext | null {
  const actionMatch = laravelRouteActionStringPattern.exec(literal.value);
  const className = actionMatch?.[1];
  const methodName = actionMatch?.[2];

  if (!className || !methodName) {
    return null;
  }

  if (!isPhpCodeOffset(source, literal.quoteStart)) {
    return null;
  }

  if (!laravelControllerGroupRouteCallForAction(source, literal)) {
    return null;
  }

  return {
    className: className.replace(/\\+/g, "\\"),
    kind: "laravelRouteActionMethod",
    methodName,
  };
}

function laravelInvokableRouteActionContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpLaravelRouteActionMethodContext | null {
  const classReference = classConstantReferenceAtIdentifier(source, identifier);

  if (!classReference) {
    return null;
  }

  const routeCall = laravelRouteCallForActionArgument(
    source,
    classReference.start,
  );

  if (!routeCall) {
    return null;
  }

  if (!isTopLevelBetween(source, routeCall.openParen + 1, classReference.start)) {
    return null;
  }

  return {
    className: classReference.className,
    kind: "laravelRouteActionMethod",
    methodName: "__invoke",
  };
}

function classConstantReferenceAtIdentifier(
  source: string,
  identifier: IdentifierAtOffset,
): { className: string; start: number } | null {
  const classConstantPattern =
    /((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*class\b/g;

  for (const match of source.matchAll(classConstantPattern)) {
    const matchStart = match.index ?? 0;
    const className = match[1];

    if (!className) {
      continue;
    }

    const classStart = matchStart + match[0].indexOf(className);
    const classEnd = classStart + className.length;
    const magicStart = matchStart + match[0].lastIndexOf("class");
    const magicEnd = magicStart + "class".length;
    const isOnClassName =
      identifier.start >= classStart && identifier.end <= classEnd;
    const isOnMagicClass =
      identifier.start >= magicStart && identifier.end <= magicEnd;

    if (!isOnClassName && !isOnMagicClass) {
      continue;
    }

    return {
      className,
      start: classStart,
    };
  }

  return null;
}

function laravelRouteCallForActionArgument(
  source: string,
  targetOffset: number,
): { openParen: number } | null {
  const routePattern = /\bRoute\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of source.matchAll(routePattern)) {
    const routeStart = match.index ?? 0;
    const routeMethod = match[1]?.toLowerCase() ?? "";

    if (!laravelControllerGroupRouteMethods.has(routeMethod)) {
      continue;
    }

    const openParen = routeStart + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (
      closeParen === null ||
      targetOffset <= openParen ||
      targetOffset >= closeParen
    ) {
      continue;
    }

    const argumentName = topLevelCallArgumentNameAtOffset(
      source,
      openParen,
      closeParen,
      targetOffset,
    );
    const argumentIndex = topLevelCallArgumentIndexAt(
      source,
      openParen,
      closeParen,
      targetOffset,
    );

    if (argumentIndex === 1 || argumentName?.toLowerCase() === "action") {
      return { openParen };
    }
  }

  return null;
}

function laravelControllerGroupClassNameForRouteAction(
  source: string,
  literal: StringLiteralRange,
): string | null {
  const routeCall = laravelControllerGroupRouteCallForAction(source, literal);

  if (!routeCall) {
    return null;
  }

  for (const group of laravelControllerGroups(source)) {
    if (routeCall.routeStart > group.bodyStart && routeCall.routeStart < group.bodyEnd) {
      return group.className;
    }
  }

  return null;
}

function laravelControllerGroupRouteCallForAction(
  source: string,
  literal: StringLiteralRange,
): { routeStart: number } | null {
  const routePattern = /\bRoute\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;

  for (const match of source.matchAll(routePattern)) {
    const routeStart = match.index ?? 0;
    const routeMethod = match[1]?.toLowerCase() ?? "";

    if (!laravelControllerGroupRouteMethods.has(routeMethod)) {
      continue;
    }

    const openParen = routeStart + match[0].lastIndexOf("(");
    const closeParen = matchingBracketOffset(source, openParen, "(", ")");

    if (
      closeParen === null ||
      literal.quoteStart <= openParen ||
      literal.quoteEnd >= closeParen
    ) {
      continue;
    }

    if (!isTopLevelBetween(source, openParen + 1, literal.quoteStart)) {
      continue;
    }

    const argumentName = topLevelCallArgumentNameAtOffset(
      source,
      openParen,
      closeParen,
      literal.quoteStart,
    );
    const argumentIndex = topLevelCallArgumentIndexAt(
      source,
      openParen,
      closeParen,
      literal.quoteStart,
    );

    if (argumentIndex === 1 || argumentName?.toLowerCase() === "action") {
      return { routeStart };
    }
  }

  return null;
}

function laravelControllerGroups(
  source: string,
): Array<{ bodyEnd: number; bodyStart: number; className: string }> {
  const groups: Array<{ bodyEnd: number; bodyStart: number; className: string }> = [];
  const controllerPattern =
    /(?:\bRoute\s*::|->\s*)controller\s*\(\s*(?:controller\s*:\s*)?((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*::\s*class\s*\)/g;

  for (const match of source.matchAll(controllerPattern)) {
    const controllerStart = match.index ?? 0;
    const className = match[1];

    if (!className) {
      continue;
    }

    const chainSource = source.slice(controllerStart);
    const groupMatch = /->\s*group\s*\(/g.exec(chainSource);

    if (!groupMatch) {
      continue;
    }

    const groupOpenParen =
      controllerStart +
      (groupMatch.index ?? 0) +
      groupMatch[0].lastIndexOf("(");
    const groupCloseParen = matchingBracketOffset(source, groupOpenParen, "(", ")");

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
      className,
    });
  }

  return groups.sort((left, right) => left.bodyStart - right.bodyStart);
}

function laravelRelationPrefixContext(
  prefix: string,
): { prefix: string; previousRelationNames: string[] } | null {
  if (prefix === "") {
    return {
      prefix: "",
      previousRelationNames: [],
    };
  }

  const segments = prefix.split(".");
  const currentPrefix = segments.pop() ?? "";
  const previousRelationNames = segments;

  if (
    previousRelationNames.some(
      (segment) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(segment),
    )
  ) {
    return null;
  }

  if (currentPrefix !== "" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(currentPrefix)) {
    return null;
  }

  return {
    prefix: currentPrefix,
    previousRelationNames,
  };
}

function laravelRelationSegmentContext(
  value: string,
  relativeStart: number,
  relativeEnd: number,
): { previousRelationNames: string[]; relationName: string } | null {
  if (!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(value)) {
    return null;
  }

  const previousRelationNames: string[] = [];
  let segmentStart = 0;

  for (const segment of value.split(".")) {
    const segmentEnd = segmentStart + segment.length;

    if (relativeStart >= segmentStart && relativeEnd <= segmentEnd) {
      return {
        previousRelationNames,
        relationName: segment,
      };
    }

    previousRelationNames.push(segment);
    segmentStart = segmentEnd + 1;
  }

  return null;
}

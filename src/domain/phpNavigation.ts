import type { EditorPosition } from "./languageServerFeatures";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  phpNormalizeReceiverExpression,
  phpSimpleVariableName,
} from "./phpReceiverExpressions";
import {
  joinWorkspacePath,
  type ComposerPackageDescriptor,
  type PhpProjectDescriptor,
  type Psr4Root,
} from "./workspace";
import { phpLaravelNamedRouteReferenceContextAt } from "./phpLaravelRoutes";

export type PhpIdentifierContext =
  | {
      kind: "classIdentifier";
      name: string;
    }
  | {
      className: string;
      kind: "laravelRouteActionMethod";
      methodName: string;
    }
  | {
      className: string | null;
      kind: "laravelRelationString";
      methodName: string;
      previousRelationNames?: string[];
      receiverExpression: string | null;
      relationName: string;
    }
  | {
      kind: "laravelNamedRouteString";
      routeName: string;
    }
  | {
      kind: "methodCall";
      methodName: string;
      receiverExpression: string;
      variableName: string;
    }
  | {
      className: string;
      kind: "staticMethodCall";
      methodName: string;
    };

export interface PhpMethodDefinitionHint {
  className: string;
  methodName: string;
}

export interface PhpImplementationDeclarationContext {
  methodName: string;
  typeKind: "class" | "enum" | "interface" | "trait";
}

export interface PhpLaravelRelationStringCompletionContext {
  className: string | null;
  methodName: string;
  previousRelationNames?: string[];
  prefix: string;
  receiverExpression: string | null;
}

interface IdentifierAtOffset {
  end: number;
  name: string;
  start: number;
}

interface StringLiteralRange {
  quoteEnd: number;
  quoteStart: number;
}

export function phpIdentifierContextAt(
  source: string,
  position: EditorPosition,
): PhpIdentifierContext | null {
  const namedRoute = phpLaravelNamedRouteReferenceContextAt(source, position);

  if (namedRoute) {
    return {
      kind: "laravelNamedRouteString",
      routeName: namedRoute.name,
    };
  }

  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  const relationString = laravelRelationStringContextAt(source, identifier);

  if (relationString) {
    return relationString;
  }

  const routeAction = laravelRouteActionContextAt(source, identifier);

  if (routeAction) {
    return routeAction;
  }

  const methodCall = methodCallContextAt(source, identifier);

  if (methodCall) {
    return methodCall;
  }

  const staticMethodCall = staticMethodCallContextAt(source, identifier);

  if (staticMethodCall) {
    return staticMethodCall;
  }

  return {
    kind: "classIdentifier",
    name: identifier.name,
  };
}

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

export function resolvePhpClassName(
  source: string,
  className: string,
): string | null {
  const trimmedClassName = className.trim();
  const isFullyQualified = trimmedClassName.startsWith("\\");
  const normalizedClassName = trimmedClassName.replace(/^\\+/, "");

  if (!normalizedClassName) {
    return null;
  }

  const imports = phpUseImports(source);
  const [firstSegment, ...remainingSegments] = normalizedClassName.split("\\");
  const importedName = imports.get(firstSegment.toLowerCase());

  if (importedName) {
    return [importedName, ...remainingSegments].join("\\");
  }

  if (isFullyQualified) {
    return normalizedClassName;
  }

  const namespace = phpNamespace(source);

  if (namespace) {
    return `${namespace}\\${normalizedClassName}`;
  }
  return normalizedClassName;
}

export function phpParameterTypeForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const parameterList = enclosingFunctionParameters(source, offset);

  if (!parameterList) {
    return null;
  }

  for (const parameter of splitPhpParameterList(parameterList)) {
    const variableIndex = parameter.search(
      new RegExp(`\\$${escapeRegExp(variableName)}\\b`),
    );

    if (variableIndex < 0) {
      continue;
    }

    const typeName = phpParameterType(parameter.slice(0, variableIndex));

    if (typeName) {
      return typeName;
    }
  }

  return null;
}

export function phpClassPathCandidates(
  rootPath: string,
  descriptor: PhpProjectDescriptor,
  className: string,
): string[] {
  const candidates = [
    ...phpRootClassPathCandidates(rootPath, descriptor.psr4Roots, className),
    ...descriptor.packages.flatMap((composerPackage) =>
      phpPackageClassPathCandidates(rootPath, composerPackage, className),
    ),
  ];

  return Array.from(new Set(candidates));
}

export function phpLaravelRequestMethodDefinition(
  variableType: string | null,
  methodName: string,
): PhpMethodDefinitionHint | null {
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

export function phpNamedTypePosition(
  source: string,
  name: string,
): EditorPosition {
  const match = new RegExp(
    `\\b(?:class|interface|trait|enum)\\s+${escapeRegExp(name)}\\b`,
  ).exec(source);

  if (!match) {
    return { column: 1, lineNumber: 1 };
  }

  return editorPositionAtOffset(source, match.index + match[0].lastIndexOf(name));
}

export function phpMethodPosition(
  source: string,
  methodName: string,
): EditorPosition {
  return phpMethodPositionOrNull(source, methodName) ?? {
    column: 1,
    lineNumber: 1,
  };
}

export function phpMethodPositionOrNull(
  source: string,
  methodName: string,
): EditorPosition | null {
  const match = new RegExp(
    `\\bfunction\\s+${escapeRegExp(methodName)}\\b`,
  ).exec(source);

  if (!match) {
    return null;
  }

  return editorPositionAtOffset(
    source,
    match.index + match[0].lastIndexOf(methodName),
  );
}

export function phpImplementationDeclarationContextAt(
  source: string,
  position: EditorPosition,
): PhpImplementationDeclarationContext | null {
  const methodName = phpMethodDeclarationNameAtPosition(source, position);

  if (!methodName) {
    return null;
  }

  const typeKind = phpCurrentTypeKind(source);

  if (typeKind === "interface") {
    return { methodName, typeKind };
  }

  if (typeKind !== "class") {
    return null;
  }

  const declarationPrefix = phpMethodDeclarationPrefixAt(source, position);

  if (!declarationPrefix || !/\babstract\b/.test(declarationPrefix)) {
    return null;
  }

  return { methodName, typeKind };
}

export function phpCurrentTypeKind(
  source: string,
): "class" | "trait" | "enum" | "interface" | null {
  const match = /\b(class|trait|enum|interface)\s+[A-Za-z_][A-Za-z0-9_]*\b/.exec(
    source,
  );
  const kind = match?.[1];

  if (
    kind === "class" ||
    kind === "trait" ||
    kind === "enum" ||
    kind === "interface"
  ) {
    return kind;
  }

  return null;
}

export function phpExtendsClassName(source: string): string | null {
  const match =
    /\b(?:class|interface)\s+[A-Za-z_][A-Za-z0-9_]*[^{;]*?\bextends\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)\b/m.exec(
      source,
    );
  return match?.[1]?.trim().replace(/^\\+/, "") || null;
}

export function phpSuperTypeReferences(source: string): string[] {
  const declaration =
    /\b(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+[A-Za-z_][A-Za-z0-9_]*\b[\s\S]*?\{/.exec(
      source,
    );

  if (!declaration) {
    return [];
  }

  const header = declaration[0].slice(0, -1);
  const references: string[] = [];
  const extendsMatch = /\bextends\s+([\s\S]*?)(?=\bimplements\b|$)/.exec(
    header,
  );
  const implementsMatch = /\bimplements\s+([\s\S]*?)$/.exec(header);

  references.push(...phpClassReferenceList(extendsMatch?.[1] ?? ""));
  references.push(...phpClassReferenceList(implementsMatch?.[1] ?? ""));

  return references;
}

function methodCallContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpIdentifierContext | null {
  const contextStart = Math.max(0, identifier.start - 800);
  const contextEnd = source.indexOf("\n", identifier.end);
  const context = source.slice(
    contextStart,
    contextEnd < 0 ? source.length : contextEnd,
  );
  const methodPattern = new RegExp(
    `(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:\\s*->\\s*[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\([^)]*\\))?)*)\\s*->\\s*${escapeRegExp(identifier.name)}\\b`,
    "g",
  );

  for (const match of context.matchAll(methodPattern)) {
    const matchStart = contextStart + (match.index ?? 0);
    const methodStart = matchStart + match[0].lastIndexOf(identifier.name);
    const methodEnd = methodStart + identifier.name.length;

    if (identifier.start >= methodStart && identifier.end <= methodEnd) {
      return {
        kind: "methodCall",
        methodName: identifier.name,
        receiverExpression: phpNormalizeReceiverExpression(match[1] || ""),
        variableName: phpSimpleVariableName(match[1] || "") || "",
      };
    }
  }

  return null;
}

function staticMethodCallContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpIdentifierContext | null {
  if (identifier.name.toLowerCase() === "class") {
    return null;
  }

  const contextStart = Math.max(0, identifier.start - 800);
  const contextEnd = source.indexOf("\n", identifier.end);
  const context = source.slice(
    contextStart,
    contextEnd < 0 ? source.length : contextEnd,
  );
  const staticMethodPattern = new RegExp(
    `((?:\\\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\\s*::\\s*${escapeRegExp(identifier.name)}\\b`,
    "g",
  );

  for (const match of context.matchAll(staticMethodPattern)) {
    const matchStart = contextStart + (match.index ?? 0);
    const methodStart = matchStart + match[0].lastIndexOf(identifier.name);
    const methodEnd = methodStart + identifier.name.length;

    if (identifier.start >= methodStart && identifier.end <= methodEnd) {
      return {
        className: (match[1] ?? "").replace(/^\\+/, ""),
        kind: "staticMethodCall",
        methodName: identifier.name,
      };
    }
  }

  return null;
}

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
  "loadsum",
  "ordoesnthave",
  "ordoesnthavemorph",
  "orhas",
  "orhasmorph",
  "orwherehas",
  "orwherehasmorph",
  "orwheredoesnthave",
  "orwheredoesnthavemorph",
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
  "wherehas",
  "wherehasmorph",
  "wheredoesnthavemorph",
  "wheremorphedto",
  "wheredoesnthave",
  "whererelation",
  "without",
]);

function laravelRelationStringContextAt(
  source: string,
  identifier: IdentifierAtOffset,
): PhpIdentifierContext | null {
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

    if (isDirectFirstArgumentString(source, openParen, literal.quoteStart)) {
      return openParen;
    }

    if (isFirstArgumentArrayRelationString(source, openParen, literal)) {
      return openParen;
    }
  }

  return null;
}

function isDirectFirstArgumentString(
  source: string,
  openParen: number,
  quoteStart: number,
): boolean {
  return (
    topLevelArgumentIndexAtOffset(source, openParen, quoteStart) === 0 &&
    isTopLevelBetween(source, openParen + 1, quoteStart)
  );
}

function isFirstArgumentArrayRelationString(
  source: string,
  openParen: number,
  literal: StringLiteralRange,
): boolean {
  const arrayStart = enclosingBracketStart(source, literal.quoteStart, "[", "]");

  if (arrayStart === null || arrayStart < openParen) {
    return false;
  }

  const arrayEnd = matchingBracketOffset(source, arrayStart, "[", "]");

  if (arrayEnd === null || literal.quoteEnd > arrayEnd) {
    return false;
  }

  if (
    topLevelArgumentIndexAtOffset(source, openParen, arrayStart) !== 0 ||
    !isTopLevelBetween(source, openParen + 1, arrayStart)
  ) {
    return false;
  }

  if (!isTopLevelBetween(source, arrayStart + 1, literal.quoteStart)) {
    return false;
  }

  return topLevelArrayRelationLiteralRole(source, arrayStart, arrayEnd, literal) !== null;
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
): Omit<
  Extract<PhpIdentifierContext, { kind: "laravelRelationString" }>,
  "kind" | "relationName"
> | null {
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
): PhpIdentifierContext | null {
  const literal = stringLiteralAtOffset(source, identifier.start);

  if (!literal) {
    return null;
  }

  if (literal.value !== identifier.name) {
    return null;
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(literal.value)) {
    return null;
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

function stringLiteralAtOffset(
  source: string,
  offset: number,
): { quoteEnd: number; quoteStart: number; value: string } | null {
  let quote: string | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character !== quote) {
        continue;
      }

      if (offset > quoteStart && offset < index) {
        return {
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

  return null;
}

function stringLiteralCompletionAtOffset(
  source: string,
  offset: number,
): { prefix: string; quoteEnd: number; quoteStart: number } | null {
  let quote: string | null = null;
  let quoteStart = -1;

  for (let index = 0; index < source.length && index < offset; index += 1) {
    const character = source[index] || "";

    if (quote) {
      if (character === "\\" && quote !== "`") {
        index += 1;
        continue;
      }

      if (character === quote) {
        quote = null;
        quoteStart = -1;
      }

      continue;
    }

    if (character !== "'" && character !== "\"") {
      continue;
    }

    quote = character;
    quoteStart = index;
  }

  if (!quote || quoteStart < 0 || offset <= quoteStart) {
    return null;
  }

  return {
    prefix: source.slice(quoteStart + 1, offset),
    quoteEnd: closingQuoteOffset(source, offset, quote) ?? offset,
    quoteStart,
  };
}

function closingQuoteOffset(
  source: string,
  startOffset: number,
  quote: string,
): number | null {
  for (let index = startOffset; index < source.length; index += 1) {
    const character = source[index] || "";

    if (character === "\\" && quote !== "`") {
      index += 1;
      continue;
    }

    if (character === quote) {
      return index;
    }
  }

  return null;
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

function matchingBracketOffset(
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

function topLevelArgumentIndexAtOffset(
  source: string,
  openParenOffset: number,
  targetOffset: number,
): number {
  let argumentIndex = 0;
  let depth = 0;
  let quote: string | null = null;

  for (
    let index = openParenOffset + 1;
    index < source.length && index < targetOffset;
    index += 1
  ) {
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

function enclosingBracketStart(
  source: string,
  targetOffset: number,
  open: string,
  close: string,
): number | null {
  const stack: number[] = [];
  let quote: string | null = null;

  for (let index = 0; index < source.length && index < targetOffset; index += 1) {
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

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === open) {
      stack.push(index);
      continue;
    }

    if (character === close) {
      stack.pop();
    }
  }

  return stack.length > 0 ? stack[stack.length - 1] ?? null : null;
}

function isTopLevelBetween(
  source: string,
  startOffset: number,
  targetOffset: number,
): boolean {
  let topLevel = true;

  scanTopLevel(source, startOffset, targetOffset, () => undefined, (depth) => {
    if (depth > 0) {
      topLevel = false;
    }
  });

  return topLevel;
}

function scanTopLevel(
  source: string,
  startOffset: number,
  endOffset: number,
  onTopLevelCharacter: (index: number, character: string) => void,
  onDepth?: (depth: number) => void,
): void {
  let depth = 0;
  let quote: string | null = null;

  for (
    let index = startOffset;
    index < source.length && index < endOffset;
    index += 1
  ) {
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

    if (character === "'" || character === "\"") {
      quote = character;
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      onDepth?.(depth);
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      onDepth?.(depth);
      continue;
    }

    if (depth === 0) {
      onTopLevelCharacter(index, character);
    }
  }
}

function identifierAtOffset(
  source: string,
  offset: number,
): IdentifierAtOffset | null {
  for (const match of source.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;

    if (offset >= start && offset <= end) {
      return {
        end,
        name: match[0],
        start,
      };
    }
  }

  return null;
}

function phpMethodDeclarationNameAtPosition(
  source: string,
  position: EditorPosition,
): string | null {
  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  return phpMethodDeclarationPrefixAt(source, position) ? identifier.name : null;
}

function phpMethodDeclarationPrefixAt(
  source: string,
  position: EditorPosition,
): string | null {
  const offset = offsetAtPosition(source, position);
  const identifier = identifierAtOffset(source, offset);

  if (!identifier) {
    return null;
  }

  const declarationStart =
    Math.max(
      source.lastIndexOf(";", identifier.start - 1),
      source.lastIndexOf("{", identifier.start - 1),
      source.lastIndexOf("}", identifier.start - 1),
    ) + 1;
  const prefix = source.slice(declarationStart, identifier.start);

  return /\bfunction\s*&?\s*$/.test(prefix) ? prefix : null;
}

function phpClassReferenceList(source: string): string[] {
  return source
    .split(",")
    .map((part) => /\\?[A-Za-z_][A-Za-z0-9_\\]*/.exec(part.trim())?.[0] ?? "")
    .filter(Boolean);
}

function phpUseImports(source: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importSource = source.slice(0, firstPhpTypeDeclarationOffset(source));

  for (const match of importSource.matchAll(/^\s*use\s+(?!function\b|const\b)([^;]+);/gm)) {
    const importName = (match[1] || "").trim();

    if (!importName) {
      continue;
    }

    if (importName.includes("{")) {
      continue;
    }

    const aliasMatch = /^(.*?)\s+as\s+([A-Za-z_][A-Za-z0-9_]*)$/i.exec(
      importName,
    );
    const fullyQualifiedName = (aliasMatch?.[1] || importName)
      .trim()
      .replace(/^\\+/, "");
    const alias = aliasMatch?.[2] || shortPhpName(fullyQualifiedName);

    imports.set(alias.toLowerCase(), fullyQualifiedName);
  }

  return imports;
}

function firstPhpTypeDeclarationOffset(source: string): number {
  const match = /^\s*(?:abstract\s+|final\s+)?(?:class|interface|trait|enum)\s+/m.exec(
    source,
  );

  return match?.index ?? source.length;
}

function phpNamespace(source: string): string | null {
  const match = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  return match?.[1]?.trim().replace(/^\\+/, "") || null;
}

function enclosingFunctionParameters(
  source: string,
  offset: number,
): string | null {
  let parameters: string | null = null;

  for (const match of source.matchAll(/\bfunction\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/g)) {
    const parametersStart = (match.index ?? 0) + match[0].length;

    if (parametersStart > offset) {
      continue;
    }

    const parametersEnd = matchingParenthesisOffset(source, parametersStart - 1);

    if (!parametersEnd || parametersEnd > offset) {
      parameters = source.slice(parametersStart, parametersEnd || offset);
      continue;
    }

    parameters = source.slice(parametersStart, parametersEnd);
  }

  return parameters;
}

function matchingParenthesisOffset(source: string, openOffset: number): number | null {
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

    if (character === "(") {
      depth += 1;
      continue;
    }

    if (character !== ")") {
      continue;
    }

    depth -= 1;

    if (depth === 0) {
      return index;
    }
  }

  return null;
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

function phpParameterType(beforeVariable: string): string | null {
  const typeSource = beforeVariable
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .trim();
  const typeParts = typeSource.split(/\s+/).filter(Boolean);
  const typeName = typeParts[typeParts.length - 1];

  if (!typeName) {
    return null;
  }

  const normalized = typeName
    .replace(/^\\+/, "")
    .replace(/^\?/, "")
    .split(/[|&]/)
    .find((candidate) => !isPhpBuiltinType(candidate));

  return normalized || null;
}

function isPhpBuiltinType(typeName: string | undefined): boolean {
  return (
    !typeName ||
    [
      "array",
      "bool",
      "callable",
      "false",
      "float",
      "int",
      "iterable",
      "mixed",
      "never",
      "null",
      "object",
      "self",
      "static",
      "string",
      "true",
      "void",
    ].includes(typeName.toLowerCase())
  );
}

function phpRootClassPathCandidates(
  rootPath: string,
  roots: Psr4Root[],
  className: string,
): string[] {
  return roots.flatMap((root) =>
    root.paths.map((path) => psr4ClassPath(rootPath, path, root.namespace, className)),
  ).filter((path): path is string => Boolean(path));
}

function phpPackageClassPathCandidates(
  rootPath: string,
  composerPackage: ComposerPackageDescriptor,
  className: string,
): string[] {
  const packagePath = composerPackage.installPath
    ? composerInstallPath(rootPath, composerPackage.installPath)
    : joinWorkspacePath(rootPath, `vendor/${composerPackage.name}`);

  return composerPackage.psr4Roots
    .flatMap((root) =>
      root.paths.map((path) =>
        psr4ClassPath(packagePath, path, root.namespace, className),
      ),
    )
    .filter((path): path is string => Boolean(path));
}

function psr4ClassPath(
  basePath: string,
  relativeRoot: string,
  namespace: string,
  className: string,
): string | null {
  if (!className.startsWith(namespace)) {
    return null;
  }

  const relativeClassName = className.slice(namespace.length);
  const relativePath = `${trimSlashes(relativeRoot)}/${relativeClassName
    .split("\\")
    .join("/")}.php`;

  return joinWorkspacePath(basePath, relativePath);
}

function composerInstallPath(rootPath: string, installPath: string): string {
  if (installPath.startsWith("/")) {
    return normalizePath(installPath);
  }

  return normalizePath(joinWorkspacePath(`${rootPath}/vendor/composer`, installPath));
}

function normalizePath(path: string): string {
  const parts: string[] = [];

  for (const part of path.split("/")) {
    if (!part || part === ".") {
      continue;
    }

    if (part === "..") {
      parts.pop();
      continue;
    }

    parts.push(part);
  }

  return `/${parts.join("/")}`;
}

function shortPhpName(className: string): string {
  const parts = className.split("\\");
  return parts[parts.length - 1] || className;
}

function trimSlashes(path: string): string {
  return path.trim().split("\\").join("/").replace(/^\/+|\/+$/g, "");
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

function editorPositionAtOffset(
  source: string,
  offset: number,
): EditorPosition {
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

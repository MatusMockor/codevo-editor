import type { EditorPosition } from "./languageServerFeatures";
import { phpParameterTypeForVariable } from "./phpNavigation";
import {
  firstPhpDocTypeToken,
  phpDocClassStringReturnTemplate,
} from "./phpDocTemplates";
import {
  PHP_CLASS_NAME_PATTERN,
  PHP_CLASS_NAME_CAPTURE_PATTERN,
  PHP_EXPRESSION_RECEIVER_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";

export interface PhpMethodCallExpression {
  methodName: string;
  receiverExpression: string;
}

export interface PhpStaticCallExpression {
  className: string;
  methodName: string;
}

export interface PhpPropertyAccessExpression {
  propertyName: string;
  receiverExpression: string;
}

export type PhpClassStringCallExpression =
  | {
      argumentClassName: string;
      functionName: string;
      kind: "functionCall";
    }
  | {
      argumentClassName: string;
      kind: "methodCall";
      methodName: string;
      receiverExpression: string;
    }
  | {
      argumentClassName: string;
      className: string;
      kind: "staticCall";
      methodName: string;
    };

export interface PhpLaravelContainerBinding {
  abstractClassName: string;
  concreteClassName: string;
}

export interface PhpDocGenericInheritance {
  className: string;
  genericTypes: string[];
}

export interface PhpLaravelQueryCallbackContext {
  methodName: string;
  modelClassName: string | null;
  receiverExpression: string | null;
  relationName: string | null;
}

const laravelQueryCallbackMethods =
  "where|orWhere|whereHas|orWhereHas|withWhereHas|whereDoesntHave|orWhereDoesntHave|with";

export function phpCurrentClassName(source: string): string | null {
  const classMatch = /\b(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
    source,
  );

  if (!classMatch?.[1]) {
    return null;
  }

  const namespaceMatch = /^\s*namespace\s+([^;{]+)[;{]/m.exec(source);
  const namespace = namespaceMatch?.[1]?.trim().replace(/^\\+/, "");

  return namespace ? `${namespace}\\${classMatch[1]}` : classMatch[1];
}

export function phpReceiverExpressionTypeInSource(
  source: string,
  position: EditorPosition,
  receiverExpression: string,
): string | null {
  const normalizedExpression = phpNormalizeReceiverExpression(receiverExpression);

  if (normalizedExpression === "$this") {
    return phpCurrentClassName(source);
  }

  const thisPropertyMatch = /^\$this->([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    normalizedExpression,
  );

  if (thisPropertyMatch?.[1]) {
    return phpThisPropertyType(source, thisPropertyMatch[1]);
  }

  const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    normalizedExpression,
  );

  if (!variableMatch?.[1]) {
    return null;
  }

  return phpVariableTypeInSource(source, position, variableMatch[1]);
}

export function phpVariableTypeInSource(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  return (
    phpParameterTypeForVariable(source, position, variableName) ??
    phpDocTypeForVariableBefore(source, position, variableName) ??
    phpNewExpressionClassName(
      phpAssignmentExpressionForVariableBefore(source, position, variableName) ?? "",
    ) ??
    phpLaravelContainerExpressionClassName(
      phpAssignmentExpressionForVariableBefore(source, position, variableName) ?? "",
    )
  );
}

export function phpLaravelQueryCallbackContextForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): PhpLaravelQueryCallbackContext | null {
  const callback =
    phpClosureCallbackForVariable(source, position, variableName) ??
    phpArrowCallbackForVariable(source, position, variableName);

  if (!callback) {
    return null;
  }

  const methodCallPattern = new RegExp(
    String.raw`(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:\s*->\s*[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?)*)\s*->\s*(` +
      laravelQueryCallbackMethods +
      String.raw`)\s*\(`,
    "g",
  );
  const staticCallPattern = new RegExp(
    String.raw`(` +
      PHP_CLASS_NAME_PATTERN +
      String.raw`)\s*::\s*(` +
      laravelQueryCallbackMethods +
      String.raw`)\s*\(`,
    "g",
  );
  const methodCallContext = phpCallbackMethodCallContext(
    source,
    callback.startOffset,
    methodCallPattern,
  );

  if (methodCallContext) {
    return {
      methodName: methodCallContext.methodName,
      modelClassName: null,
      receiverExpression: phpNormalizeReceiverExpression(
        methodCallContext.receiverOrClassName,
      ),
      relationName: methodCallContext.relationName,
    };
  }

  const staticCallContext = phpCallbackMethodCallContext(
    source,
    callback.startOffset,
    staticCallPattern,
  );

  if (staticCallContext) {
    return {
      methodName: staticCallContext.methodName,
      modelClassName: staticCallContext.receiverOrClassName.replace(/^\\+/, ""),
      receiverExpression: null,
      relationName: staticCallContext.relationName,
    };
  }

  return null;
}

export function phpThisPropertyType(
  source: string,
  propertyName: string,
): string | null {
  return (
    phpPromotedPropertyType(source, propertyName) ??
    phpDeclaredPropertyType(source, propertyName) ??
    phpDocTypeForProperty(source, propertyName)
  );
}

export function phpAssignmentExpressionForVariableBefore(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const before = source.slice(0, offset);
  const pattern = new RegExp(
    `\\$${escapeRegExp(variableName)}\\s*=\\s*([^;\\n]+)`,
    "g",
  );
  let expression: string | null = null;

  for (const match of before.matchAll(pattern)) {
    expression = match[1]?.trim() || null;
  }

  return expression;
}

export function phpNewExpressionClassName(expression: string): string | null {
  const match =
    /^new\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\b(?:\s*\([^)]*\))?\s*$/.exec(
      expression.trim(),
    );

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

export function phpLaravelContainerExpressionClassName(
  expression: string,
): string | null {
  const normalized = expression.trim();
  const match =
    new RegExp(
      `^(?:app|resolve|make)\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
    ).exec(normalized) ??
    new RegExp(
      `(?:->|::)make\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
    ).exec(normalized);

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

export function phpLaravelContainerBindingsFromSource(
  source: string,
): PhpLaravelContainerBinding[] {
  const bindings: PhpLaravelContainerBinding[] = [];
  const directBindingPattern = new RegExp(
    `(?:->|::)(?:bind|singleton|scoped)\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\s*,\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class`,
    "g",
  );
  const contextualBindingPattern = new RegExp(
    `->\\s*needs\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\s*\\)\\s*->\\s*give\\s*\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class`,
    "g",
  );

  for (const match of source.matchAll(directBindingPattern)) {
    const abstractClassName = match[1]?.replace(/^\\+/, "");
    const concreteClassName = match[2]?.replace(/^\\+/, "");

    if (abstractClassName && concreteClassName) {
      bindings.push({ abstractClassName, concreteClassName });
    }
  }

  for (const match of source.matchAll(contextualBindingPattern)) {
    const abstractClassName = match[1]?.replace(/^\\+/, "");
    const concreteClassName = match[2]?.replace(/^\\+/, "");

    if (abstractClassName && concreteClassName) {
      bindings.push({ abstractClassName, concreteClassName });
    }
  }

  return bindings;
}

export function phpClassStringCallExpression(
  expression: string,
): PhpClassStringCallExpression | null {
  const normalized = expression.trim();
  const argumentMatch = new RegExp(
    `\\(\\s*${PHP_CLASS_NAME_CAPTURE_PATTERN}::class\\b`,
  ).exec(normalized);
  const argumentClassName = argumentMatch?.[1]?.replace(/^\\+/, "");

  if (!argumentClassName) {
    return null;
  }

  const methodCall = phpMethodCallExpression(normalized);

  if (methodCall) {
    return {
      argumentClassName,
      kind: "methodCall",
      methodName: methodCall.methodName,
      receiverExpression: methodCall.receiverExpression,
    };
  }

  const staticCall = phpStaticCallExpression(normalized);

  if (staticCall) {
    return {
      argumentClassName,
      className: staticCall.className,
      kind: "staticCall",
      methodName: staticCall.methodName,
    };
  }

  const functionMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(normalized);

  if (!functionMatch?.[1]) {
    return null;
  }

  return {
    argumentClassName,
    functionName: functionMatch[1],
    kind: "functionCall",
  };
}

export function phpMethodCallExpression(
  expression: string,
): PhpMethodCallExpression | null {
  const match =
    new RegExp(
      `^(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:\\s*->\\s*[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\([^)]*\\))?)*)\\s*->\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*\\(`,
    ).exec(
      expression.trim(),
    );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    methodName: match[2],
    receiverExpression: phpNormalizeReceiverExpression(match[1]),
  };
}

export function phpPropertyAccessExpression(
  expression: string,
): PhpPropertyAccessExpression | null {
  const match = new RegExp(
    `^(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:\\s*->\\s*[A-Za-z_][A-Za-z0-9_]*\\s*(?:\\([^)]*\\))?)*)\\s*->\\s*([A-Za-z_][A-Za-z0-9_]*)\\s*$`,
  ).exec(expression.trim());

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    propertyName: match[2],
    receiverExpression: phpNormalizeReceiverExpression(match[1]),
  };
}

export function phpMethodReturnExpressions(
  source: string,
  methodName: string,
): string[] {
  const pattern = new RegExp(
    `\\bfunction\\s+&?\\s*${escapeRegExp(methodName)}\\s*\\(`,
    "g",
  );
  const expressions: string[] = [];

  for (const match of source.matchAll(pattern)) {
    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingPairOffset(source, parametersStart, "(", ")");

    if (parametersEnd === null) {
      continue;
    }

    const bodyStart = source.indexOf("{", parametersEnd);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    expressions.push(
      ...topLevelReturnExpressions(source.slice(bodyStart + 1, bodyEnd)),
    );
  }

  return expressions;
}

export function phpFunctionReturnsClassStringArgument(
  source: string,
  functionName: string,
): boolean {
  const pattern = new RegExp(
    `\\bfunction\\s+&?\\s*${escapeRegExp(functionName)}\\s*\\(`,
    "g",
  );

  for (const match of source.matchAll(pattern)) {
    const functionOffset = match.index ?? 0;
    const docBlock = phpDocBlockBefore(source, functionOffset);

    if (phpDocClassStringReturnTemplate(docBlock)) {
      return true;
    }
  }

  return false;
}

export function phpStaticCallExpression(
  expression: string,
): PhpStaticCallExpression | null {
  const match =
    /^((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/.exec(
      expression.trim(),
    );

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    className: match[1].replace(/^\\+/, ""),
    methodName: match[2],
  };
}

export function phpDocTypeForVariableBefore(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const rawTypeName = phpDocRawTypeForVariableBefore(
    source,
    position,
    variableName,
  );

  return rawTypeName ? phpDeclaredTypeCandidate(rawTypeName) : null;
}

export function phpDocRawTypeForVariableBefore(
  source: string,
  position: EditorPosition,
  variableName: string,
): string | null {
  const offset = offsetAtPosition(source, position);
  const before = source.slice(0, offset);
  const pattern = new RegExp(
    `\\/\\*\\*[\\s\\S]*?@var\\s+([\\s\\S]*?)\\s+\\$${escapeRegExp(
      variableName,
    )}\\b[\\s\\S]*?\\*\\/`,
    "g",
  );
  let typeName: string | null = null;

  for (const match of before.matchAll(pattern)) {
    typeName = phpDocNormalizeType(match[1] ?? "") || null;
  }

  return typeName;
}

export function phpDeclaredTypeCandidate(typeName: string): string | null {
  const normalized = typeName
    .trim()
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .trim()
    .replace(/^\?/, "")
    .replace(/\[\]$/, "")
    .replace(/^\\+/, "");
  const candidate = splitPhpTypeUnion(normalized)
    .map((part) => part.trim().replace(/^\?/, "").replace(/^\\+/, ""))
    .map((part) => phpTypeBaseCandidate(part) ?? phpTypeGenericCandidate(part))
    .find((part) => part && !isPhpBuiltinType(part));

  return candidate ?? null;
}

export function phpDeclaredGenericTypeCandidates(typeName: string): string[] {
  return splitPhpTypeUnion(typeName)
    .flatMap((part) => phpGenericArguments(part))
    .map((part) => phpDeclaredTypeCandidate(part))
    .filter((part): part is string => Boolean(part));
}

export function phpDocTemplateNames(source: string): string[] {
  const templates: string[] = [];

  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm)-)?template(?:-(?!extends\b|implements\b|use\b)[A-Za-z]+)?\s+([A-Za-z_][A-Za-z0-9_]*)\b/g,
  )) {
    const template = match[1];

    if (!template || templates.includes(template)) {
      continue;
    }

    templates.push(template);
  }

  return templates;
}

export function phpDocGenericInheritances(
  source: string,
): PhpDocGenericInheritance[] {
  const inheritances: PhpDocGenericInheritance[] = [];

  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm|template)-)?(?:extends|implements|use)\s+([^\r\n*]+)/g,
  )) {
    const typeName = firstPhpDocTypeToken(match[1] ?? "");
    const className = typeName ? phpDeclaredTypeCandidate(typeName) : null;

    if (!typeName || !className) {
      continue;
    }

    inheritances.push({
      className,
      genericTypes: phpDeclaredGenericTypeCandidates(typeName),
    });
  }

  return inheritances;
}

function phpPromotedPropertyType(
  source: string,
  propertyName: string,
): string | null {
  const constructorMatch = /\bfunction\s+__construct\s*\(([\s\S]*?)\)\s*[{;]/.exec(
    source,
  );

  if (!constructorMatch?.[1]) {
    return null;
  }

  for (const parameter of splitPhpList(constructorMatch[1])) {
    if (!/\b(?:public|protected|private)\b/.test(parameter)) {
      continue;
    }

    const variableIndex = parameter.search(
      new RegExp(`\\$${escapeRegExp(propertyName)}\\b`),
    );

    if (variableIndex < 0) {
      continue;
    }

    return phpDeclaredTypeCandidate(parameter.slice(0, variableIndex));
  }

  return null;
}

function phpDeclaredPropertyType(
  source: string,
  propertyName: string,
): string | null {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:public|protected|private)\\s+(?:readonly\\s+)?(?:static\\s+)?([^\\n;=]+?)\\s+\\$${escapeRegExp(
      propertyName,
    )}\\b`,
    "g",
  );
  let typeName: string | null = null;

  for (const match of source.matchAll(pattern)) {
    typeName = phpDeclaredTypeCandidate(match[1] ?? "");
  }

  return typeName;
}

function phpDocTypeForProperty(
  source: string,
  propertyName: string,
): string | null {
  const pattern = new RegExp(
    `\\/\\*\\*[\\s\\S]*?@var\\s+([^\\r\\n*]+)[\\s\\S]*?\\*\\/\\s*(?:public|protected|private)?\\s+(?:readonly\\s+)?(?:static\\s+)?(?:[^\\n;=]+?\\s+)?\\$${escapeRegExp(
      propertyName,
    )}\\b`,
    "g",
  );
  let typeName: string | null = null;

  for (const match of source.matchAll(pattern)) {
    typeName = phpDeclaredTypeCandidate(phpDocNormalizeType(match[1] ?? ""));
  }

  return typeName;
}

function phpDocNormalizeType(rawTypeName: string): string {
  return rawTypeName
    .replace(/\s+/g, " ")
    .replace(/\s*\*\/.*$/, "")
    .replace(/\s+\$[A-Za-z_][A-Za-z0-9_]*\b.*$/, "")
    .trim();
}

function phpDocBlockBefore(source: string, offset: number): string | null {
  const beforeOffset = source.slice(0, offset);
  const docStart = beforeOffset.lastIndexOf("/**");
  const docEnd = beforeOffset.lastIndexOf("*/");

  if (docStart < 0 || docEnd < docStart) {
    return null;
  }

  const betweenDocAndOffset = beforeOffset.slice(docEnd + 2).trim();

  if (betweenDocAndOffset) {
    return null;
  }

  return beforeOffset.slice(docStart, docEnd + 2);
}

function splitPhpList(parameters: string): string[] {
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

function topLevelReturnExpressions(body: string): string[] {
  const expressions: string[] = [];
  let quote: string | null = null;
  let depth = 0;

  for (const match of body.matchAll(/\breturn\b/g)) {
    const returnOffset = match.index ?? 0;

    if (!isTopLevelKeywordOffset(body, returnOffset)) {
      continue;
    }

    let start = returnOffset + match[0].length;

    while (/\s/.test(body[start] || "")) {
      start += 1;
    }

    quote = null;
    depth = 0;

    for (let index = start; index < body.length; index += 1) {
      const character = body[index] || "";

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

      if (character !== ";" || depth > 0) {
        continue;
      }

      const expression = body.slice(start, index).trim();

      if (expression) {
        expressions.push(expression);
      }

      break;
    }
  }

  return expressions;
}

function isTopLevelKeywordOffset(source: string, offset: number): boolean {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
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
    }
  }

  return depth === 0;
}

function phpClosureCallbackForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): { startOffset: number } | null {
  const offset = offsetAtPosition(source, position);
  const callbackPattern =
    /\bfunction\s*\(([^)]*)\)\s*(?:use\s*\([^)]*\)\s*)?(?::\s*[^{]+)?\{/g;

  for (const match of source.matchAll(callbackPattern)) {
    const startOffset = match.index ?? 0;

    if (startOffset > offset) {
      break;
    }

    if (!phpParameterListHasVariable(match[1] ?? "", variableName)) {
      continue;
    }

    const bodyStart = startOffset + (match[0]?.lastIndexOf("{") ?? -1);

    if (bodyStart < startOffset) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null || offset <= bodyStart || offset > bodyEnd) {
      continue;
    }

    return { startOffset };
  }

  return null;
}

function phpArrowCallbackForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): { startOffset: number } | null {
  const offset = offsetAtPosition(source, position);
  const callbackPattern = /\bfn\s*\(([^)]*)\)\s*(?::\s*[^=]+)?=>/g;

  for (const match of source.matchAll(callbackPattern)) {
    const startOffset = match.index ?? 0;

    if (startOffset > offset) {
      break;
    }

    if (!phpParameterListHasVariable(match[1] ?? "", variableName)) {
      continue;
    }

    const expressionStart = startOffset + match[0].length;

    if (offset <= expressionStart) {
      continue;
    }

    if (source.slice(expressionStart, offset).includes(";")) {
      continue;
    }

    return { startOffset };
  }

  return null;
}

function phpParameterListHasVariable(
  parametersSource: string,
  variableName: string,
): boolean {
  return new RegExp(String.raw`(?:^|[,\s&])\$${escapeRegExp(variableName)}\b`).test(
    parametersSource,
  );
}

function phpCallbackMethodCallContext(
  source: string,
  callbackStartOffset: number,
  pattern: RegExp,
): {
  methodName: string;
  receiverOrClassName: string;
  relationName: string | null;
} | null {
  let context: {
    methodName: string;
    receiverOrClassName: string;
    relationName: string | null;
    startOffset: number;
  } | null = null;

  for (const match of source.matchAll(pattern)) {
    const startOffset = match.index ?? 0;

    if (startOffset > callbackStartOffset) {
      break;
    }

    const openOffset = startOffset + (match[0]?.lastIndexOf("(") ?? -1);

    if (openOffset < startOffset) {
      continue;
    }

    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (
      closeOffset === null ||
      callbackStartOffset <= openOffset ||
      callbackStartOffset >= closeOffset
    ) {
      continue;
    }

    const receiverOrClassName = match[1]?.trim() ?? "";
    const methodName = match[2] ?? "";

    if (!receiverOrClassName || !methodName) {
      continue;
    }

    context = {
      methodName,
      receiverOrClassName,
      relationName: phpRelationNameBeforeCallbackArgument(
        source,
        openOffset + 1,
        closeOffset,
        callbackStartOffset,
      ),
      startOffset,
    };
  }

  return context
    ? {
        methodName: context.methodName,
        receiverOrClassName: context.receiverOrClassName,
        relationName: context.relationName,
      }
    : null;
}

function phpRelationNameBeforeCallbackArgument(
  source: string,
  argumentsStartOffset: number,
  argumentsEndOffset: number,
  callbackStartOffset: number,
): string | null {
  const argumentsSource = source.slice(argumentsStartOffset, argumentsEndOffset);
  const callbackRelativeOffset = callbackStartOffset - argumentsStartOffset;
  const argumentsList = splitPhpArgumentsWithOffsets(argumentsSource);
  const callbackArgumentIndex = argumentsList.findIndex(
    (argument) =>
      argument.start <= callbackRelativeOffset &&
      callbackRelativeOffset <= argument.end,
  );

  if (callbackArgumentIndex < 0) {
    return null;
  }

  for (let index = callbackArgumentIndex - 1; index >= 0; index -= 1) {
    const value = phpNamedArgumentValue(argumentsList[index]?.value ?? "");
    const relationName = phpStringLiteralValue(value);

    if (relationName) {
      return relationName.split(".")[0]?.trim() || null;
    }
  }

  return null;
}

function splitPhpArgumentsWithOffsets(
  argumentsSource: string,
): Array<{ end: number; start: number; value: string }> {
  const argumentsList: Array<{ end: number; start: number; value: string }> = [];
  let start = 0;
  let quote: string | null = null;
  let depth = 0;

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

    if (character !== "," || depth > 0) {
      continue;
    }

    argumentsList.push({
      end: index,
      start,
      value: argumentsSource.slice(start, index).trim(),
    });
    start = index + 1;
  }

  argumentsList.push({
    end: argumentsSource.length,
    start,
    value: argumentsSource.slice(start).trim(),
  });

  return argumentsList.filter((argument) => argument.value.length > 0);
}

function phpNamedArgumentValue(argument: string): string {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(
    argument.trim(),
  );

  return match?.[2]?.trim() ?? argument.trim();
}

function phpStringLiteralValue(expression: string): string | null {
  const match = /^(['"])([\s\S]*?)\1$/.exec(expression.trim());

  return match?.[2] ?? null;
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
  let quote: string | null = null;
  let depth = 0;

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

function isPhpBuiltinType(typeName: string | undefined): boolean {
  const normalized = typeName?.replace(/^\\+/, "").toLowerCase();

  return (
    !normalized ||
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
      "string",
      "true",
      "void",
    ].includes(normalized)
  );
}

function splitPhpTypeUnion(typeName: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < typeName.length; index += 1) {
    const character = typeName[index] || "";

    if (character === "<" || character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ">" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if ((character === "|" || character === "&") && depth === 0) {
      parts.push(typeName.slice(start, index).trim());
      start = index + 1;
    }
  }

  parts.push(typeName.slice(start).trim());
  return parts.filter(Boolean);
}

function phpTypeBaseCandidate(typeName: string): string | null {
  const normalized = typeName
    .trim()
    .replace(/\[\]$/, "")
    .replace(/^\\+/, "");
  const genericStart = normalized.indexOf("<");
  const base = genericStart >= 0 ? normalized.slice(0, genericStart) : normalized;

  if (!base || isPhpBuiltinType(base)) {
    return null;
  }

  return base;
}

function phpTypeGenericCandidate(typeName: string): string | null {
  return phpGenericArguments(typeName)
    .map((argument) => phpDeclaredTypeCandidate(argument))
    .find((argument): argument is string => Boolean(argument)) ?? null;
}

function phpGenericArguments(typeName: string): string[] {
  const start = typeName.indexOf("<");

  if (start < 0) {
    return [];
  }

  let depth = 0;

  for (let index = start; index < typeName.length; index += 1) {
    const character = typeName[index] || "";

    if (character === "<") {
      depth += 1;
      continue;
    }

    if (character !== ">") {
      continue;
    }

    depth -= 1;

    if (depth !== 0) {
      continue;
    }

    return splitPhpTypeList(typeName.slice(start + 1, index));
  }

  return [];
}

function splitPhpTypeList(typeList: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;

  for (let index = 0; index < typeList.length; index += 1) {
    const character = typeList[index] || "";

    if (character === "<" || character === "(" || character === "[") {
      depth += 1;
      continue;
    }

    if (character === ">" || character === ")" || character === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character !== "," || depth > 0) {
      continue;
    }

    parts.push(typeList.slice(start, index).trim());
    start = index + 1;
  }

  parts.push(typeList.slice(start).trim());
  return parts.filter(Boolean);
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

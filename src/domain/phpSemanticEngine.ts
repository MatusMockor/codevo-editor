import type { EditorPosition } from "./languageServerFeatures";
import { phpParameterTypeForVariable } from "./phpNavigation";
import {
  firstPhpDocTypeToken,
  phpDocClassStringReturnTemplate,
} from "./phpDocTemplates";
import {
  PHP_CLASS_NAME_CAPTURE_PATTERN,
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
} from "./phpTypeAnalysis";
import {
  phpFrameworkContainerConcreteClassNameFromSource,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkPropertyTypeFromSource,
  type PhpFrameworkProvider,
  type PhpFrameworkSourceContext,
} from "./phpFrameworkProviders";
export {
  phpLaravelQueryCallbackContextForVariable,
  type PhpLaravelQueryCallbackContext,
} from "./phpLaravelQueryCallbackContext";

export {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
  phpMethodReturnExpressions,
} from "./phpTypeAnalysis";
export {
  phpLaravelContainerBindingsFromSource,
  phpLaravelContainerExpressionClassName,
  type PhpLaravelContainerBinding,
} from "./phpFrameworkLaravel";

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

export interface PhpDocGenericInheritance {
  className: string;
  genericTypes: string[];
}

export interface PhpSemanticEngineOptions {
  contextualThisClassName?: string;
  frameworkProviders?: readonly PhpFrameworkProvider[];
  frameworkSourceContext?: PhpFrameworkSourceContext;
}

const phpFrameworkOwnedMethodReturnNames = new Set(["findOrFail"]);

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

function phpCurrentClassNameAtPosition(
  source: string,
  position: EditorPosition,
): string | null {
  const offset = offsetAtPosition(source, position);
  const pattern =
    /\b(?:class|interface|trait|enum)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{;]*/g;
  let containingClassName: string | null = null;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const className = match[1];

    if (!className) {
      continue;
    }

    const bodyStart = source.indexOf("{", pattern.lastIndex);

    if (bodyStart < 0 || offset < bodyStart) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null || offset > bodyEnd) {
      continue;
    }

    const namespace = phpNamespaceBeforeOffset(source, match.index ?? 0);
    containingClassName = namespace ? `${namespace}\\${className}` : className;
    pattern.lastIndex = bodyEnd + 1;
  }

  return containingClassName;
}

export function phpReceiverExpressionTypeInSource(
  source: string,
  position: EditorPosition,
  receiverExpression: string,
  options: PhpSemanticEngineOptions = {},
): string | null {
  const normalizedExpression = phpNormalizeReceiverExpression(receiverExpression);

  if (normalizedExpression === "$this") {
    return options.contextualThisClassName?.trim().replace(/^\\+/, "") ||
      phpCurrentClassNameAtPosition(source, position) ||
      phpCurrentClassName(source);
  }

  const thisPropertyMatch = new RegExp(
    `^\\$this${PHP_MEMBER_ACCESS_PATTERN}([A-Za-z_][A-Za-z0-9_]*)$`,
  ).exec(normalizedExpression);

  if (thisPropertyMatch?.[1]) {
    return phpThisPropertyType(source, thisPropertyMatch[1], options);
  }

  // Laravel container resolution as a receiver: `app(X::class)`,
  // `resolve(X::class)`, `app()->make(X::class)`, `App::make(X::class)`, … all
  // yield an instance of `X`. This mirrors the variable-assignment path
  // (`phpVariableTypeInSource`) so inline chains like
  // `app()->make(X::class)->method()` resolve the receiver type and stop emitting
  // false "undefined method" diagnostics. Gated by an active framework provider,
  // and the resolver only fires when the container call is the outer operation.
  const containerClassName = phpFrameworkContainerConcreteClassNameFromSource(
    source,
    normalizedExpression,
    options.frameworkProviders,
    options.frameworkSourceContext,
  );

  if (containerClassName) {
    return containerClassName;
  }

  const newExpressionClassName = phpNewExpressionClassName(normalizedExpression);

  if (newExpressionClassName) {
    return newExpressionClassName;
  }

  const propertyAccess = phpPropertyAccessExpression(normalizedExpression);

  if (propertyAccess) {
    const receiverType = phpReceiverExpressionTypeInSource(
      source,
      position,
      propertyAccess.receiverExpression,
      options,
    );

    return phpFrameworkPropertyTypeFromSource(
      source,
      propertyAccess.propertyName,
      options.frameworkProviders,
      receiverType,
    );
  }

  const methodCall = phpMethodCallExpression(normalizedExpression);

  if (methodCall) {
    const receiverType = phpReceiverExpressionTypeInSource(
      source,
      position,
      methodCall.receiverExpression,
      options,
    );

    return phpFrameworkMethodCallReturnTypeFromSource(
      source,
      methodCall.methodName,
      receiverType,
      methodCall.receiverExpression,
      options.frameworkProviders,
      normalizedExpression,
      options.frameworkSourceContext,
    ) ?? phpSameSourceMethodCallReturnType(
      source,
      methodCall.methodName,
      receiverType,
    );
  }

  const staticCall = phpStaticCallExpression(normalizedExpression);

  if (staticCall) {
    const fallbackReceiverType = phpStaticCallReceiverType(
      source,
      staticCall.className,
    );

    return phpFrameworkMethodCallReturnTypeFromSource(
      source,
      staticCall.methodName,
      staticCall.className,
      normalizedExpression,
      options.frameworkProviders,
      normalizedExpression,
      options.frameworkSourceContext,
    ) ?? phpSameSourceMethodCallReturnType(
      source,
      staticCall.methodName,
      fallbackReceiverType,
    );
  }

  const variableMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    normalizedExpression,
  );

  if (!variableMatch?.[1]) {
    return null;
  }

  return phpVariableTypeInSource(source, position, variableMatch[1], options);
}

export function phpVariableTypeInSource(
  source: string,
  position: EditorPosition,
  variableName: string,
  options: PhpSemanticEngineOptions = {},
): string | null {
  const assignmentExpression =
    phpAssignmentExpressionForVariableBefore(source, position, variableName) ?? "";

  return (
    phpParameterTypeForVariable(source, position, variableName) ??
    phpDocTypeForVariableBefore(source, position, variableName) ??
    phpNewExpressionClassName(assignmentExpression) ??
    phpFrameworkContainerConcreteClassNameFromSource(
      source,
      assignmentExpression,
      options.frameworkProviders,
      options.frameworkSourceContext,
    ) ??
    phpFrameworkPropertyAccessAssignmentReturnType(
      source,
      position,
      variableName,
      assignmentExpression,
      options,
    ) ??
    phpFrameworkMethodCallAssignmentReturnType(
      source,
      position,
      variableName,
      assignmentExpression,
      options,
    ) ??
    phpForeachValueTypeForVariableBefore(source, position, variableName, options)
  );
}

export function phpThisPropertyType(
  source: string,
  propertyName: string,
  options: PhpSemanticEngineOptions = {},
): string | null {
  return (
    phpPromotedPropertyType(source, propertyName) ??
    phpDeclaredPropertyType(source, propertyName) ??
    phpDocTypeForProperty(source, propertyName) ??
    phpConstructorAssignedPropertyType(source, propertyName) ??
    phpFrameworkPropertyTypeFromSource(
      source,
      propertyName,
      options.frameworkProviders,
      options.contextualThisClassName ?? phpCurrentClassName(source),
    )
  );
}

function phpFrameworkPropertyAccessAssignmentReturnType(
  source: string,
  position: EditorPosition,
  variableName: string,
  assignmentExpression: string,
  options: PhpSemanticEngineOptions,
): string | null {
  const propertyAccess = phpPropertyAccessExpression(assignmentExpression);

  if (!propertyAccess) {
    return null;
  }

  if (
    new RegExp(`^\\$${escapeRegExp(variableName)}\\b`).test(
      propertyAccess.receiverExpression,
    )
  ) {
    return null;
  }

  return phpReceiverExpressionTypeInSource(
    source,
    position,
    assignmentExpression,
    options,
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
    `\\$${escapeRegExp(variableName)}\\s*=\\s*`,
    "g",
  );
  let expression: string | null = null;

  for (const match of before.matchAll(pattern)) {
    const assignmentStart = (match.index ?? 0) + match[0].length;
    expression =
      phpAssignmentExpressionAfterEquals(before, assignmentStart)?.trim() || null;
  }

  return expression;
}

function phpAssignmentExpressionAfterEquals(
  source: string,
  startOffset: number,
): string | null {
  const semicolonOffset = source.indexOf(";", startOffset);
  const endOffset = semicolonOffset >= 0 ? semicolonOffset : source.length;

  return source.slice(startOffset, endOffset).trim() || null;
}

export function phpNewExpressionClassName(expression: string): string | null {
  const value = phpStripOuterParentheses(expression.trim());
  const match =
    /^new\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\b(?:\s*\([^)]*\))?\s*$/.exec(
      value,
    );

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

function phpStripOuterParentheses(expression: string): string {
  let value = expression.trim();

  while (value.startsWith("(")) {
    const closeOffset = matchingPairOffset(value, 0, "(", ")");

    if (closeOffset !== value.length - 1) {
      break;
    }

    value = value.slice(1, -1).trim();
  }

  return value;
}

function phpFrameworkMethodCallAssignmentReturnType(
  source: string,
  position: EditorPosition,
  variableName: string,
  assignmentExpression: string,
  options: PhpSemanticEngineOptions,
): string | null {
  const methodCall = phpMethodCallExpression(assignmentExpression);

  if (!methodCall) {
    const staticCall = phpStaticCallExpression(assignmentExpression);

    if (!staticCall) {
      return null;
    }

    const fallbackReceiverType = phpStaticCallReceiverType(
      source,
      staticCall.className,
    );

    return phpFrameworkMethodCallReturnTypeFromSource(
      source,
      staticCall.methodName,
      staticCall.className,
      assignmentExpression,
      options.frameworkProviders,
      assignmentExpression,
      options.frameworkSourceContext,
    ) ?? phpSameSourceMethodCallReturnType(
      source,
      staticCall.methodName,
      fallbackReceiverType,
    );
  }

  if (
    new RegExp(`^\\$${escapeRegExp(variableName)}\\b`).test(
      methodCall.receiverExpression,
    )
  ) {
    return null;
  }

  const receiverType = phpReceiverExpressionTypeInSource(
    source,
    position,
    methodCall.receiverExpression,
    options,
  );

  return phpFrameworkMethodCallReturnTypeFromSource(
    source,
    methodCall.methodName,
    receiverType,
    methodCall.receiverExpression,
    options.frameworkProviders,
    assignmentExpression,
    options.frameworkSourceContext,
  ) ?? phpSameSourceMethodCallReturnType(
    source,
    methodCall.methodName,
    receiverType,
  );
}

function phpForeachValueTypeForVariableBefore(
  source: string,
  position: EditorPosition,
  variableName: string,
  options: PhpSemanticEngineOptions,
): string | null {
  const offset = offsetAtPosition(source, position);
  const foreachPattern = /\bforeach\s*\(/g;
  let typeName: string | null = null;

  for (const match of source.matchAll(foreachPattern)) {
    const openOffset = source.indexOf("(", match.index ?? 0);

    if (openOffset < 0 || openOffset > offset) {
      continue;
    }

    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (
      closeOffset === null ||
      closeOffset > offset ||
      !phpForeachBodyContainsOffset(source, closeOffset, offset)
    ) {
      continue;
    }

    const header = source.slice(openOffset + 1, closeOffset);
    const asOffset = topLevelKeywordOffset(header, "as");

    if (asOffset === null) {
      continue;
    }

    const iterableExpression = header.slice(0, asOffset).trim();
    const valueExpression = phpForeachValueExpression(
      header.slice(asOffset + "as".length),
    );
    const valueVariableName = /^\s*&?\s*\$([A-Za-z_][A-Za-z0-9_]*)\b/.exec(
      valueExpression,
    )?.[1];

    if (valueVariableName !== variableName) {
      continue;
    }

    typeName =
      phpForeachIterableValueType(source, position, iterableExpression, options) ??
      typeName;
  }

  return typeName;
}

function phpForeachValueExpression(source: string): string {
  const arrowOffset = topLevelFatArrowOffset(source);

  return (arrowOffset === null ? source : source.slice(arrowOffset + 2)).trim();
}

function phpForeachIterableValueType(
  source: string,
  position: EditorPosition,
  iterableExpression: string,
  options: PhpSemanticEngineOptions,
): string | null {
  const variableName = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    iterableExpression.trim(),
  )?.[1];
  const rawDocType = variableName
    ? phpDocRawTypeForVariableBefore(source, position, variableName)
    : null;

  return (
    phpGenericValueTypeCandidate(rawDocType) ??
    phpGenericValueTypeCandidate(
      phpReceiverExpressionTypeInSource(
        source,
        position,
        iterableExpression,
        options,
      ),
    )
  );
}

function phpGenericValueTypeCandidate(typeName: string | null): string | null {
  const candidates = phpDeclaredGenericTypeCandidates(typeName ?? "");

  return candidates[candidates.length - 1] ?? null;
}

function phpForeachBodyContainsOffset(
  source: string,
  headerCloseOffset: number,
  offset: number,
): boolean {
  let bodyStart = headerCloseOffset + 1;

  while (/\s/.test(source[bodyStart] ?? "")) {
    bodyStart += 1;
  }

  if (source[bodyStart] === "{") {
    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    return bodyEnd !== null && offset > bodyStart && offset <= bodyEnd;
  }

  if (source[bodyStart] === ":") {
    const bodyEnd = source.indexOf("endforeach", bodyStart + 1);

    return bodyEnd >= 0 && offset > bodyStart && offset <= bodyEnd;
  }

  const statementEnd = source.indexOf(";", bodyStart);

  return statementEnd >= 0 && offset >= bodyStart && offset <= statementEnd;
}

function phpSameSourceMethodCallReturnType(
  source: string,
  methodName: string,
  receiverType: string | null,
): string | null {
  if (phpFrameworkOwnedMethodReturnNames.has(methodName)) {
    return null;
  }

  const normalizedReceiverType = phpNormalizeClassName(receiverType);

  if (!normalizedReceiverType) {
    return null;
  }

  for (const classBody of phpSameSourceClassBodies(source)) {
    if (
      !phpClassNameMatchesReceiverType(classBody.className, normalizedReceiverType)
    ) {
      continue;
    }

    const returnType = phpDeclaredMethodReturnType(classBody.body, methodName);

    if (returnType) {
      return returnType;
    }

    const phpDocReturnType = classBody.docBlock
      ? phpDocMethodReturnType(classBody.docBlock, methodName)
      : null;

    if (phpDocReturnType) {
      return phpDocReturnType;
    }
  }

  return null;
}

function phpStaticCallReceiverType(
  source: string,
  className: string,
): string | null {
  const normalizedClassName = phpNormalizeClassName(className);

  if (normalizedClassName === "self" || normalizedClassName === "static") {
    return phpCurrentClassName(source);
  }

  if (normalizedClassName === "parent") {
    return null;
  }

  return normalizedClassName;
}

function phpSameSourceClassBodies(
  source: string,
): { body: string; className: string; docBlock: string | null }[] {
  const bodies: {
    body: string;
    className: string;
    docBlock: string | null;
  }[] = [];
  const pattern =
    /\b(?:class|interface|trait)\s+([A-Za-z_][A-Za-z0-9_]*)\b[^{;]*/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    const className = match[1];

    if (!className) {
      continue;
    }

    const bodyStart = source.indexOf("{", pattern.lastIndex);

    if (bodyStart < 0) {
      continue;
    }

    const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

    if (bodyEnd === null) {
      continue;
    }

    const namespace = phpNamespaceBeforeOffset(source, match.index ?? 0);

    bodies.push({
      body: source.slice(bodyStart + 1, bodyEnd),
      className: namespace ? `${namespace}\\${className}` : className,
      docBlock: phpDocBlockBefore(source, match.index ?? 0),
    });

    pattern.lastIndex = bodyEnd + 1;
  }

  return bodies;
}

function phpDeclaredMethodReturnType(
  classBody: string,
  methodName: string,
): string | null {
  const pattern = new RegExp(
    `\\bfunction\\s+&?\\s*${escapeRegExp(methodName)}\\s*\\(`,
    "g",
  );
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(classBody)) !== null) {
    if (!phpIsTopLevelClassBodyOffset(classBody, match.index ?? 0)) {
      continue;
    }

    const parametersStart = (match.index ?? 0) + match[0].length - 1;
    const parametersEnd = matchingPairOffset(
      classBody,
      parametersStart,
      "(",
      ")",
    );

    if (parametersEnd === null) {
      continue;
    }

    let returnStart = parametersEnd + 1;

    while (/\s/.test(classBody[returnStart] ?? "")) {
      returnStart += 1;
    }

    if (classBody[returnStart] !== ":") {
      continue;
    }

    returnStart += 1;

    const returnEnd = phpMethodReturnTypeEndOffset(classBody, returnStart);

    if (returnEnd === null) {
      continue;
    }

    const returnType = phpDeclaredTypeCandidate(
      classBody.slice(returnStart, returnEnd),
    );

    if (returnType) {
      return returnType;
    }
  }

  return null;
}

function phpDocMethodReturnType(
  docBlock: string,
  methodName: string,
): string | null {
  for (const line of docBlock.split(/\r?\n/)) {
    const tagMatch = /@(?:(?:phpstan|psalm)-)?method\s+([^\r\n*]+)/.exec(line);

    if (!tagMatch?.[1]) {
      continue;
    }

    const signature = phpDocNormalizeType(tagMatch[1]).replace(/\s+/g, " ");
    const returnType = phpDocMethodSignatureReturnType(signature, methodName);

    if (returnType) {
      return returnType;
    }
  }

  return null;
}

function phpDocMethodSignatureReturnType(
  signature: string,
  methodName: string,
): string | null {
  const methodMatch = new RegExp(
    `\\b${escapeRegExp(methodName)}\\s*\\(`,
  ).exec(signature);

  if (!methodMatch) {
    return null;
  }

  const parametersStart = signature.indexOf("(", methodMatch.index);
  const parametersEnd = matchingPairOffset(signature, parametersStart, "(", ")");

  if (parametersEnd === null) {
    return null;
  }

  const afterParameters = signature.slice(parametersEnd + 1).trim();
  const colonReturnMatch = /^:\s*(.+)$/.exec(afterParameters);

  if (colonReturnMatch?.[1]) {
    return phpDeclaredTypeCandidate(colonReturnMatch[1]);
  }

  const beforeMethod = signature.slice(0, methodMatch.index).trim();
  const returnType = beforeMethod.replace(/^static\s+/, "").trim();

  return returnType ? phpDeclaredTypeCandidate(returnType) : null;
}

function phpMethodReturnTypeEndOffset(
  source: string,
  startOffset: number,
): number | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = startOffset; index < source.length; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "(" || character === "[" || character === "<") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === ">") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if ((character === "{" || character === ";") && depth === 0) {
      return index;
    }
  }

  return null;
}

function phpIsTopLevelClassBodyOffset(source: string, offset: number): boolean {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";

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

    if (character === "{") {
      depth += 1;
      continue;
    }

    if (character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return depth === 0;
}

function phpClassNameMatchesReceiverType(
  className: string,
  receiverType: string,
): boolean {
  const normalizedClassName = phpNormalizeClassName(className);
  const normalizedReceiverType = phpNormalizeClassName(receiverType);

  if (!normalizedClassName || !normalizedReceiverType) {
    return false;
  }

  return (
    normalizedClassName === normalizedReceiverType ||
    phpShortClassName(normalizedClassName) ===
      phpShortClassName(normalizedReceiverType)
  );
}

function phpNormalizeClassName(
  className: string | null | undefined,
): string | null {
  const normalized = className?.trim().replace(/^\\+/, "") ?? "";

  return normalized || null;
}

function phpShortClassName(className: string): string {
  return className.split("\\").pop() ?? className;
}

function phpNamespaceBeforeOffset(source: string, offset: number): string | null {
  let namespace: string | null = null;
  const pattern = /\bnamespace\s+([^;{]+)[;{]/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(source)) !== null) {
    if ((match.index ?? 0) > offset) {
      break;
    }

    namespace = match[1]?.trim().replace(/^\\+/, "") || null;
  }

  return namespace;
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
  const normalized = expression.trim();
  const methodCall = phpLastTopLevelMethodCall(normalized);

  if (!methodCall) {
    return null;
  }

  return {
    methodName: methodCall.methodName,
    receiverExpression: phpNormalizeReceiverExpression(
      normalized.slice(0, methodCall.operatorStart),
    ),
  };
}

function phpLastTopLevelMethodCall(
  expression: string,
): { methodName: string; operatorStart: number } | null {
  let lastCall: { methodName: string; operatorStart: number } | null = null;
  let quote: string | null = null;

  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index] ?? "";

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
      const close =
        character === "(" ? ")" : character === "[" ? "]" : "}";
      const closeOffset = matchingPairOffset(expression, index, character, close);

      if (closeOffset === null) {
        break;
      }

      index = closeOffset;
      continue;
    }

    const operatorLength = expression.startsWith("?->", index)
      ? 3
      : expression.startsWith("->", index)
        ? 2
        : 0;

    if (operatorLength === 0) {
      continue;
    }

    let methodStart = index + operatorLength;

    while (/\s/.test(expression[methodStart] ?? "")) {
      methodStart += 1;
    }

    const methodMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
      expression.slice(methodStart),
    );

    if (!methodMatch?.[0]) {
      continue;
    }

    let openOffset = methodStart + methodMatch[0].length;

    while (/\s/.test(expression[openOffset] ?? "")) {
      openOffset += 1;
    }

    if (expression[openOffset] !== "(") {
      continue;
    }

    const closeOffset = matchingPairOffset(expression, openOffset, "(", ")");

    if (closeOffset === null) {
      break;
    }

    lastCall = {
      methodName: methodMatch[0],
      operatorStart: index,
    };
    index = closeOffset;
  }

  return lastCall;
}

export function phpPropertyAccessExpression(
  expression: string,
): PhpPropertyAccessExpression | null {
  const match = new RegExp(
    `^(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN})*)${PHP_MEMBER_ACCESS_PATTERN}([A-Za-z_][A-Za-z0-9_]*)\\s*$`,
  ).exec(expression.trim());

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    propertyName: match[2],
    receiverExpression: phpNormalizeReceiverExpression(match[1]),
  };
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
  const docBlockPattern = /\/\*\*[\s\S]*?\*\//g;
  const pattern = new RegExp(
    `@(?:(?:phpstan|psalm)-)?var\\s+([^\\r\\n*]+?)\\s+\\$${escapeRegExp(
      variableName,
    )}\\b`,
  );
  let typeName: string | null = null;

  for (const blockMatch of before.matchAll(docBlockPattern)) {
    const match = pattern.exec(blockMatch[0] ?? "");

    if (match?.[1]) {
      typeName = phpDocNormalizeType(match[1]) || null;
    }
  }

  return typeName;
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

export function phpDocGenericMixins(source: string): PhpDocGenericInheritance[] {
  const mixins: PhpDocGenericInheritance[] = [];

  for (const match of source.matchAll(
    /@(?:(?:phpstan|psalm)-)?mixin\s+([^\r\n*]+)/g,
  )) {
    const typeName = firstPhpDocTypeToken(match[1] ?? "");
    const className = typeName ? phpDeclaredTypeCandidate(typeName) : null;

    if (!typeName || !className) {
      continue;
    }

    mixins.push({
      className,
      genericTypes: phpDeclaredGenericTypeCandidates(typeName),
    });
  }

  return mixins;
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
  // Anchor on a genuine property declaration: a visibility keyword followed by a
  // PHP type and the `$name`. Plain `function __construct(Type $name)` params share
  // the property name but are NOT properties, so the captured type segment must not
  // span the parameter list — exclude `(` and `)` from it so the `function ...(`
  // context can never be mistaken for a property type (root cause of the previous
  // "last match wins" garbage like `function __construct(PostRepository`).
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:public|protected|private)\\s+(?:readonly\\s+)?(?:static\\s+)?([^\\n;=()]+?)\\s+\\$${escapeRegExp(
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
  // Two-stage (linear) resolution mirroring `phpDocRawTypeForVariableBefore`:
  // extract each `/** ... */` docblock once, then check its `@var` against the
  // declaration that immediately follows it. The previous single regex used two
  // unbounded lazy `[\s\S]*?` spans that could run past the closing `*/`, which
  // caused catastrophic backtracking (multi-second per-keystroke freezes on large
  // documented classes) and also cross-matched a far-away docblock onto the wrong
  // property. Anchoring on the docblock that directly precedes the declaration
  // keeps the result identical for well-formed code while removing the blow-up.
  const docBlockPattern = /\/\*\*[\s\S]*?\*\//g;
  const varPattern = /@(?:(?:phpstan|psalm)-)?var\s+([^\r\n*]+)/;
  // Each modifier owns its own trailing `\s+` and the optional type token is a
  // single whitespace-free run (`[^\s;=()]+`), so no whitespace run can be split
  // multiple ways. A lazy `[^\n;=]+?\s+` here (matching whitespace two ways) would
  // reintroduce catastrophic backtracking on a long indented/blank line following
  // the docblock, re-freezing the per-keystroke completion hot path.
  const declarationPattern = new RegExp(
    `^\\s*(?:(?:public|protected|private)\\s+)?(?:readonly\\s+)?(?:static\\s+)?(?:[^\\s;=()]+\\s+)?\\$${escapeRegExp(
      propertyName,
    )}\\b`,
  );
  let typeName: string | null = null;
  let blockMatch: RegExpExecArray | null;

  while ((blockMatch = docBlockPattern.exec(source)) !== null) {
    const varMatch = varPattern.exec(blockMatch[0]);

    if (!varMatch?.[1]) {
      continue;
    }

    if (!declarationPattern.test(source.slice(docBlockPattern.lastIndex))) {
      continue;
    }

    typeName = phpDeclaredTypeCandidate(phpDocNormalizeType(varMatch[1]));
  }

  return typeName;
}

function phpConstructorAssignedPropertyType(
  source: string,
  propertyName: string,
): string | null {
  if (!phpUntypedDeclaredPropertyExists(source, propertyName)) {
    return null;
  }

  const constructor = phpConstructorDeclaration(source);

  if (!constructor?.body) {
    return null;
  }

  const assignedParameterName = phpConstructorAssignedParameterName(
    constructor.body,
    propertyName,
  );

  if (!assignedParameterName) {
    return null;
  }

  return phpConstructorParameterType(
    constructor.parameters,
    assignedParameterName,
  );
}

function phpConstructorDeclaration(
  source: string,
): { body: string | null; parameters: string } | null {
  const match = /\bfunction\s+__construct\s*\(/.exec(source);

  if (!match) {
    return null;
  }

  const parametersStart = match.index + match[0].length - 1;
  const parametersEnd = matchingPairOffset(source, parametersStart, "(", ")");

  if (parametersEnd === null) {
    return null;
  }

  let bodyStart = parametersEnd + 1;

  while (/\s/.test(source[bodyStart] ?? "")) {
    bodyStart += 1;
  }

  if (source[bodyStart] !== "{") {
    return {
      body: null,
      parameters: source.slice(parametersStart + 1, parametersEnd),
    };
  }

  const bodyEnd = matchingPairOffset(source, bodyStart, "{", "}");

  if (bodyEnd === null) {
    return null;
  }

  return {
    body: source.slice(bodyStart + 1, bodyEnd),
    parameters: source.slice(parametersStart + 1, parametersEnd),
  };
}

function phpUntypedDeclaredPropertyExists(
  source: string,
  propertyName: string,
): boolean {
  const pattern = new RegExp(
    `(?:^|\\n)\\s*(?:public|protected|private)\\s+(?:static\\s+)?\\$${escapeRegExp(
      propertyName,
    )}\\b\\s*(?:=[^;]*)?;`,
    "g",
  );

  return pattern.test(source);
}

function phpConstructorAssignedParameterName(
  constructorBody: string,
  propertyName: string,
): string | null {
  const pattern = new RegExp(
    `\\$this\\s*->\\s*${escapeRegExp(propertyName)}\\s*=`,
    "g",
  );
  const assignments: string[] = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(constructorBody)) !== null) {
    const equalsOffset = (match.index ?? 0) + match[0].length;
    const expression =
      phpAssignmentExpressionAfterEquals(constructorBody, equalsOffset)?.trim() ??
      "";
    const parameterMatch = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(expression);

    if (!parameterMatch?.[1]) {
      return null;
    }

    assignments.push(parameterMatch[1]);
  }

  return assignments.length === 1 ? (assignments[0] ?? null) : null;
}

function phpConstructorParameterType(
  parametersSource: string,
  parameterName: string,
): string | null {
  for (const parameter of splitPhpList(parametersSource)) {
    const variableMatch = new RegExp(
      `\\$${escapeRegExp(parameterName)}\\b`,
    ).exec(parameter);

    if (!variableMatch) {
      continue;
    }

    const typeSource = parameter.slice(0, variableMatch.index);

    return phpUnambiguousDeclaredTypeCandidate(typeSource);
  }

  return null;
}

function phpUnambiguousDeclaredTypeCandidate(typeName: string): string | null {
  const normalized = typeName
    .trim()
    .replace(/\b(?:public|protected|private|readonly|static)\b/g, " ")
    .replace(/^\s*&\s*/, "")
    .trim();
  const typeParts = normalized
    .split("|")
    .map((part) => part.trim())
    .filter(Boolean);

  if (!typeParts.length) {
    return null;
  }

  const candidates = typeParts
    .map((part) => phpDeclaredTypeCandidate(part))
    .filter((part): part is string => Boolean(part));
  const uniqueCandidates = [...new Set(candidates)];

  return uniqueCandidates.length === 1 ? (uniqueCandidates[0] ?? null) : null;
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

function topLevelKeywordOffset(source: string, keyword: string): number | null {
  const pattern = new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "g");

  for (const match of source.matchAll(pattern)) {
    const offset = match.index ?? 0;

    if (isTopLevelExpressionOffset(source, offset)) {
      return offset;
    }
  }

  return null;
}

function topLevelFatArrowOffset(source: string): number | null {
  for (let index = 0; index < source.length - 1; index += 1) {
    if (
      source[index] === "=" &&
      source[index + 1] === ">" &&
      isTopLevelExpressionOffset(source, index)
    ) {
      return index;
    }
  }

  return null;
}

function isTopLevelExpressionOffset(source: string, offset: number): boolean {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < offset; index += 1) {
    const character = source[index] ?? "";

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

  return depth === 0 && !quote;
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

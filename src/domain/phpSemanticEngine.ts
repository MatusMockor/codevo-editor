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
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";
import {
  phpDeclaredGenericTypeCandidates,
  phpDeclaredTypeCandidate,
} from "./phpTypeAnalysis";
import {
  phpFrameworkContainerExpressionClassName,
  phpFrameworkMethodCallReturnTypeFromSource,
  phpFrameworkPropertyTypeFromSource,
  type PhpFrameworkProvider,
} from "./phpFrameworkProviders";

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

export interface PhpLaravelQueryCallbackContext {
  methodName: string;
  modelClassName: string | null;
  morphTypeClassNames?: string[];
  previousRelationNames?: string[];
  receiverExpression: string | null;
  relationName: string | null;
}

export interface PhpSemanticEngineOptions {
  contextualThisClassName?: string;
  frameworkProviders?: readonly PhpFrameworkProvider[];
}

const laravelQueryCallbackMethodNames = [
  "where",
  "orWhere",
  "whereHas",
  "orWhereHas",
  "withWhereHas",
  "whereHasMorph",
  "orWhereHasMorph",
  "whereDoesntHave",
  "orWhereDoesntHave",
  "whereDoesntHaveMorph",
  "orWhereDoesntHaveMorph",
  "with",
  "when",
  "unless",
  "tap",
];
const laravelQueryCallbackMethods = laravelQueryCallbackMethodNames.join("|");
const laravelCurrentBuilderCallbackMethods = new Set(["when", "unless", "tap"]);

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
  options: PhpSemanticEngineOptions = {},
): string | null {
  const normalizedExpression = phpNormalizeReceiverExpression(receiverExpression);

  if (normalizedExpression === "$this") {
    return options.contextualThisClassName?.trim().replace(/^\\+/, "") ||
      phpCurrentClassName(source);
  }

  const thisPropertyMatch = new RegExp(
    `^\\$this${PHP_MEMBER_ACCESS_PATTERN}([A-Za-z_][A-Za-z0-9_]*)$`,
  ).exec(normalizedExpression);

  if (thisPropertyMatch?.[1]) {
    return phpThisPropertyType(source, thisPropertyMatch[1], options);
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
    return phpFrameworkMethodCallReturnTypeFromSource(
      source,
      methodCall.methodName,
      phpReceiverExpressionTypeInSource(
        source,
        position,
        methodCall.receiverExpression,
        options,
      ),
      methodCall.receiverExpression,
      options.frameworkProviders,
      normalizedExpression,
    );
  }

  const staticCall = phpStaticCallExpression(normalizedExpression);

  if (staticCall) {
    return phpFrameworkMethodCallReturnTypeFromSource(
      source,
      staticCall.methodName,
      staticCall.className,
      normalizedExpression,
      options.frameworkProviders,
      normalizedExpression,
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
    phpFrameworkContainerExpressionClassName(
      assignmentExpression,
      options.frameworkProviders,
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
    String.raw`(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:` +
      PHP_MEMBER_CHAIN_SEGMENT_PATTERN +
      String.raw`)*)` +
      PHP_MEMBER_ACCESS_PATTERN +
      String.raw`(` +
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
      ...(methodCallContext.morphTypeClassNames
        ? { morphTypeClassNames: methodCallContext.morphTypeClassNames }
        : {}),
      ...(methodCallContext.previousRelationNames?.length
        ? { previousRelationNames: methodCallContext.previousRelationNames }
        : {}),
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
      ...(staticCallContext.morphTypeClassNames
        ? { morphTypeClassNames: staticCallContext.morphTypeClassNames }
        : {}),
      ...(staticCallContext.previousRelationNames?.length
        ? { previousRelationNames: staticCallContext.previousRelationNames }
        : {}),
      receiverExpression: null,
      relationName: staticCallContext.relationName,
    };
  }

  return null;
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
  const match =
    /^new\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\b(?:\s*\([^)]*\))?\s*$/.exec(
      expression.trim(),
    );

  return match?.[1]?.replace(/^\\+/, "") ?? null;
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

    return phpFrameworkMethodCallReturnTypeFromSource(
      source,
      staticCall.methodName,
      staticCall.className,
      assignmentExpression,
      options.frameworkProviders,
      assignmentExpression,
    );
  }

  if (
    new RegExp(`^\\$${escapeRegExp(variableName)}\\b`).test(
      methodCall.receiverExpression,
    )
  ) {
    return null;
  }

  return phpFrameworkMethodCallReturnTypeFromSource(
    source,
    methodCall.methodName,
    phpReceiverExpressionTypeInSource(
      source,
      position,
      methodCall.receiverExpression,
      options,
    ),
    methodCall.receiverExpression,
    options.frameworkProviders,
    assignmentExpression,
  );
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
  morphTypeClassNames?: string[];
  previousRelationNames?: string[];
  receiverOrClassName: string;
  relationName: string | null;
} | null {
  let context: {
    methodName: string;
    morphTypeClassNames?: string[];
    previousRelationNames?: string[];
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

    if (
      !phpLaravelQueryCallbackArgumentMatches(
        methodName,
        source,
        openOffset + 1,
        closeOffset,
        callbackStartOffset,
      )
    ) {
      continue;
    }

    const morphTypeClassNames = phpMorphTypeClassNamesBeforeCallbackArgument(
      methodName,
      source,
      openOffset + 1,
      closeOffset,
      callbackStartOffset,
    );
    const relationPath = laravelCurrentBuilderCallbackMethods.has(
      methodName.toLowerCase(),
    )
      ? null
      : phpRelationPathBeforeCallbackArgument(
          source,
          openOffset + 1,
          closeOffset,
          callbackStartOffset,
        );

    context = {
      methodName,
      ...(morphTypeClassNames ? { morphTypeClassNames } : {}),
      ...(relationPath && relationPath.length > 1
        ? { previousRelationNames: relationPath.slice(0, -1) }
        : {}),
      receiverOrClassName,
      relationName: relationPath?.[relationPath.length - 1] ?? null,
      startOffset,
    };
  }

  return context
    ? {
        methodName: context.methodName,
        ...(context.morphTypeClassNames
          ? { morphTypeClassNames: context.morphTypeClassNames }
          : {}),
        ...(context.previousRelationNames?.length
          ? { previousRelationNames: context.previousRelationNames }
          : {}),
        receiverOrClassName: context.receiverOrClassName,
        relationName: context.relationName,
      }
    : null;
}

function phpLaravelQueryCallbackArgumentMatches(
  methodName: string,
  source: string,
  argumentsStartOffset: number,
  argumentsEndOffset: number,
  callbackStartOffset: number,
): boolean {
  const normalizedMethodName = methodName.toLowerCase();
  const expectedArgumentIndex =
    normalizedMethodName === "tap"
      ? 0
      : normalizedMethodName === "when" || normalizedMethodName === "unless"
        ? 1
        : null;

  if (expectedArgumentIndex === null) {
    return true;
  }

  return (
    phpCallbackArgumentIndex(
      source,
      argumentsStartOffset,
      argumentsEndOffset,
      callbackStartOffset,
    ) === expectedArgumentIndex
  );
}

function phpCallbackArgumentIndex(
  source: string,
  argumentsStartOffset: number,
  argumentsEndOffset: number,
  callbackStartOffset: number,
): number | null {
  const argumentsSource = source.slice(argumentsStartOffset, argumentsEndOffset);
  const callbackRelativeOffset = callbackStartOffset - argumentsStartOffset;
  const argumentsList = splitPhpArgumentsWithOffsets(argumentsSource);
  const callbackArgumentIndex = argumentsList.findIndex(
    (argument) =>
      argument.start <= callbackRelativeOffset &&
      callbackRelativeOffset <= argument.end,
  );

  return callbackArgumentIndex >= 0 ? callbackArgumentIndex : null;
}

function phpMorphTypeClassNamesBeforeCallbackArgument(
  methodName: string,
  source: string,
  argumentsStartOffset: number,
  argumentsEndOffset: number,
  callbackStartOffset: number,
): string[] | undefined {
  if (!/where(?:Has|DoesntHave)Morph$/i.test(methodName)) {
    return undefined;
  }

  const argumentsSource = source.slice(argumentsStartOffset, argumentsEndOffset);
  const callbackRelativeOffset = callbackStartOffset - argumentsStartOffset;
  const argumentsList = splitPhpArgumentsWithOffsets(argumentsSource);
  const callbackArgumentIndex = argumentsList.findIndex(
    (argument) =>
      argument.start <= callbackRelativeOffset &&
      callbackRelativeOffset <= argument.end,
  );

  if (callbackArgumentIndex < 0) {
    return undefined;
  }

  for (let index = callbackArgumentIndex - 1; index >= 0; index -= 1) {
    const namedArgument = phpNamedArgument(argumentsList[index]?.value ?? "");

    if (namedArgument?.name.toLowerCase() !== "types") {
      continue;
    }

    return phpMorphTypeClassNamesFromExpression(namedArgument.value);
  }

  if (callbackArgumentIndex <= 1) {
    return undefined;
  }

  const positionalTypesArgument = argumentsList[1]?.value;

  return positionalTypesArgument
    ? phpMorphTypeClassNamesFromExpression(
        phpNamedArgumentValue(positionalTypesArgument),
      )
    : undefined;
}

function phpMorphTypeClassNamesFromExpression(
  expression: string,
): string[] | undefined {
  const normalizedExpression = expression.trim();

  if (!normalizedExpression || phpStringLiteralValue(normalizedExpression) === "*") {
    return [];
  }

  const directClassName = phpClassConstantClassName(normalizedExpression);

  if (directClassName) {
    return [directClassName];
  }

  if (normalizedExpression.startsWith("[") && normalizedExpression.endsWith("]")) {
    const entries = splitPhpArgumentsWithOffsets(
      normalizedExpression.slice(1, -1),
    );
    const classNames = entries.flatMap((entry) => {
      const value = phpNamedArgumentValue(entry.value);

      if (phpStringLiteralValue(value) === "*") {
        return [];
      }

      const className = phpClassConstantClassName(value);

      return className ? [className] : [];
    });

    return classNames;
  }

  return undefined;
}

function phpClassConstantClassName(expression: string): string | null {
  const match = new RegExp(
    String.raw`^\s*` +
      PHP_CLASS_NAME_CAPTURE_PATTERN +
      String.raw`\s*::\s*class\s*$`,
  ).exec(expression);

  return match?.[1]?.replace(/^\\+/, "") ?? null;
}

function phpRelationPathBeforeCallbackArgument(
  source: string,
  argumentsStartOffset: number,
  argumentsEndOffset: number,
  callbackStartOffset: number,
): string[] | null {
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

  const callbackArgument = argumentsList[callbackArgumentIndex];
  const relationNameFromArrayKey = callbackArgument
    ? phpRelationPathFromArrayArgumentKey(
        argumentsSource.slice(callbackArgument.start, callbackArgument.end),
        callbackRelativeOffset - callbackArgument.start,
      )
    : null;

  if (relationNameFromArrayKey) {
    return relationNameFromArrayKey;
  }

  for (let index = callbackArgumentIndex - 1; index >= 0; index -= 1) {
    const value = phpNamedArgumentValue(argumentsList[index]?.value ?? "");
    const relationName = phpStringLiteralValue(value);

    if (relationName) {
      return phpRelationPathSegments(relationName);
    }
  }

  return null;
}

function phpRelationPathFromArrayArgumentKey(
  argumentSource: string,
  callbackOffset: number,
): string[] | null {
  const arrayRange = phpTopLevelArrayRangeContainingOffset(
    argumentSource,
    callbackOffset,
  );

  if (!arrayRange) {
    return null;
  }

  const arraySource = argumentSource.slice(arrayRange.start + 1, arrayRange.end);
  const callbackArrayOffset = callbackOffset - arrayRange.start - 1;
  const entries = splitPhpArgumentsWithOffsets(arraySource);
  const entry = entries.find(
    (candidate) =>
      candidate.start <= callbackArrayOffset &&
      callbackArrayOffset <= candidate.end,
  );

  if (!entry) {
    return null;
  }

  const entrySource = arraySource.slice(entry.start, entry.end);
  const separatorIndex = topLevelFatArrowIndexBefore(
    entrySource,
    callbackArrayOffset - entry.start,
  );

  if (separatorIndex === null) {
    return null;
  }

  const relationName = phpStringLiteralValue(entrySource.slice(0, separatorIndex));

  return relationName ? phpRelationPathSegments(relationName) : null;
}

function phpRelationPathSegments(relationName: string): string[] | null {
  const segments = relationName
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments : null;
}

function phpTopLevelArrayRangeContainingOffset(
  source: string,
  offset: number,
): { end: number; start: number } | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < source.length; index += 1) {
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

    if (character === "[") {
      if (depth === 0) {
        const end = matchingPairOffset(source, index, "[", "]");

        if (end !== null && index < offset && offset < end) {
          return { end, start: index };
        }
      }

      depth += 1;
      continue;
    }

    if (character === "(" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === "]" || character === ")" || character === "}") {
      depth = Math.max(0, depth - 1);
    }
  }

  return null;
}

function topLevelFatArrowIndexBefore(
  source: string,
  beforeOffset: number,
): number | null {
  let quote: string | null = null;
  let depth = 0;

  for (let index = 0; index < source.length && index < beforeOffset; index += 1) {
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
      continue;
    }

    if (character === "=" && source[index + 1] === ">" && depth === 0) {
      return index;
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
  const match = phpNamedArgument(argument);

  return match?.value ?? argument.trim();
}

function phpNamedArgument(
  argument: string,
): { name: string; value: string } | null {
  const match = /^([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)\s*([\s\S]+)$/.exec(
    argument.trim(),
  );

  return match?.[1] && match[2] !== undefined
    ? { name: match[1], value: match[2].trim() }
    : null;
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

import type { EditorPosition } from "./languageServerFeatures";
import {
  parsePhpClassStructure,
  phpTopLevelTypeDeclarationNames,
} from "./phpClassStructure";
import {
  phpMethodParameters,
  type PhpMethodCompletion,
  type PhpMethodParameter,
} from "./phpMethodCompletions";
import {
  maskPhpStringsAndComments,
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
  phpStatementPrefixBeforeOffset,
} from "./phpReceiverExpressions";

export type PhpNamedArgumentCallTarget =
  | { functionName: string; kind: "function" }
  | { kind: "local-callable"; variableName: string }
  | { className: string; kind: "constructor" }
  | { kind: "member-method"; methodName: string; receiverExpression: string }
  | { className: string; kind: "static-method"; methodName: string };

export interface PhpNamedArgumentCompletionContext {
  callTarget: PhpNamedArgumentCallTarget;
  positionalArgumentCount: number;
  prefix: string;
  usedArgumentNames: string[];
}

const CONSTRUCTOR_CALL_PATTERN = new RegExp(
  String.raw`(?:^|[^A-Za-z0-9_$\\])new\s+((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*$`,
);
const MEMBER_METHOD_CALL_PATTERN = new RegExp(
  `(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN})*)${PHP_MEMBER_ACCESS_PATTERN}([A-Za-z_][A-Za-z0-9_]*)\\s*$`,
);
const STATIC_METHOD_CALL_PATTERN =
  /(?<![$A-Za-z0-9_])((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*|self|static|parent)\s*::\s*([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const BARE_ARGUMENT_SEGMENT_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)?\s*$/;
const NAMED_ARGUMENT_SEGMENT_PATTERN = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*:(?!:)/;
const FUNCTION_CALL_PATTERN =
  /(?<![$A-Za-z0-9_>:\\])((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)\s*$/;
const LOCAL_CALLABLE_PATTERN =
  /(?<![A-Za-z0-9_])\$([A-Za-z_][A-Za-z0-9_]*)\s*$/;
const DECLARATION_KEYWORDS = new Set([
  "array",
  "class",
  "fn",
  "function",
  "isset",
  "list",
  "match",
  "unset",
]);

export function phpNamedArgumentCompletionContextAt(
  source: string,
  position: EditorPosition,
  phpVersionConstraint: string | null = null,
): PhpNamedArgumentCompletionContext | null {
  if (!phpVersionSupportsNamedArguments(phpVersionConstraint)) {
    return null;
  }
  const offset = offsetAtPosition(source, position);
  if (
    phpHeredocRanges(source).some(
      (range) => offset > range.start && offset <= range.end,
    )
  ) {
    return null;
  }
  const statementUntilCursor = phpStatementPrefixBeforeOffset(source, offset);
  const masked = maskPhpStringsAndComments(statementUntilCursor);

  if (hasUnterminatedBlockComment(masked)) {
    return null;
  }

  const openParenOffset = innermostOpenParenOffset(masked);

  if (openParenOffset === null) {
    return null;
  }

  const segments = topLevelArgumentSegments(masked.slice(openParenOffset + 1));
  const currentSegment = segments[segments.length - 1] ?? "";
  const prefixMatch = BARE_ARGUMENT_SEGMENT_PATTERN.exec(currentSegment);

  if (!prefixMatch) {
    return null;
  }

  const callTarget = phpNamedArgumentCallTargetBefore(
    statementUntilCursor.slice(0, openParenOffset),
  );

  if (!callTarget) {
    return null;
  }

  const usedArgumentNames: string[] = [];
  let positionalArgumentCount = 0;

  for (const segment of segments.slice(0, -1)) {
    if (/^\s*\.\.\./.test(segment)) {
      return null;
    }
    const argumentName = NAMED_ARGUMENT_SEGMENT_PATTERN.exec(segment)?.[1];

    if (argumentName) {
      usedArgumentNames.push(argumentName);
      continue;
    }

    positionalArgumentCount += 1;
  }

  return {
    callTarget,
    positionalArgumentCount,
    prefix: prefixMatch[1] ?? "",
    usedArgumentNames,
  };
}

export function phpNamedArgumentCompletions(
  context: PhpNamedArgumentCompletionContext,
  callableMembers: readonly PhpMethodCompletion[],
): PhpMethodCompletion[] {
  const methodName =
    context.callTarget.kind === "constructor"
      ? "__construct"
      : context.callTarget.kind === "function" ||
          context.callTarget.kind === "local-callable"
        ? "__invoke"
        : context.callTarget.methodName;
  const member = callableMembers.find(
    (candidate) =>
      !candidate.kind &&
      candidate.name.toLowerCase() === methodName.toLowerCase(),
  );

  if (!member) {
    return [];
  }

  const normalizedPrefix = context.prefix.toLowerCase();
  const usedNames = new Set(
    context.usedArgumentNames.map((name) => name.toLowerCase()),
  );

  return phpMethodParameters(member.parameters)
    .slice(context.positionalArgumentCount)
    .filter((parameter) => !isVariadicParameter(parameter))
    .flatMap((parameter) => {
      const parameterName = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
        parameter.name,
      )?.[1];

      if (
        !parameterName ||
        usedNames.has(parameterName.toLowerCase()) ||
        !parameterName.toLowerCase().startsWith(normalizedPrefix)
      ) {
        return [];
      }

      return [namedArgumentCompletion(member, parameter, parameterName)];
    });
}

function namedArgumentCompletion(
  member: PhpMethodCompletion,
  parameter: PhpMethodParameter,
  parameterName: string,
): PhpMethodCompletion {
  return {
    completionBehavior: {
      insertTextMode: "plain",
      triggerParameterHints: false,
    },
    declaringClassName: member.declaringClassName,
    detail: namedArgumentDetail(member, parameter),
    documentation: `Named argument\n\n${namedArgumentCallableLabel(member)}(${parameter.raw.trim()})`,
    insertText: `${parameterName}: `,
    kind: "property",
    name: `${parameterName}:`,
    parameters: "",
    returnType: parameter.type,
  };
}

export function phpNamedArgumentCallableMembersFromSource(
  source: string,
  context: PhpNamedArgumentCompletionContext,
  position?: EditorPosition,
): PhpMethodCompletion[] {
  const target = context.callTarget;
  const cursorOffset = position
    ? offsetAtPosition(source, position)
    : source.length;

  if (target.kind === "function") {
    const parameters = functionParametersFromSource(
      source,
      target.functionName,
      cursorOffset,
    );
    return parameters === null
      ? []
      : [callableCompletion(target.functionName, parameters)];
  }

  if (target.kind === "local-callable") {
    const parameters = localCallableParametersFromSource(
      source.slice(0, cursorOffset),
      target.variableName,
    );
    return parameters === null
      ? []
      : [callableCompletion(`$${target.variableName}`, parameters)];
  }

  return [];
}

export function phpNamedArgumentFunctionIdentity(
  source: string,
  context: PhpNamedArgumentCompletionContext,
  position: EditorPosition,
): string | null {
  if (context.callTarget.kind !== "function") {
    return null;
  }

  const offset = offsetAtPosition(source, position);
  const sourceBeforeCursor = source.slice(0, offset);
  return resolveFunctionIdentityAt(
    sourceBeforeCursor,
    maskNamedArgumentSource(sourceBeforeCursor),
    context.callTarget.functionName,
    sourceBeforeCursor.length,
  );
}

export function phpVersionSupportsNamedArguments(
  constraint: string | null,
): boolean {
  if (!constraint?.trim()) {
    return true;
  }

  const versions = [
    ...constraint.matchAll(/(?:^|[^0-9])(\d+)(?:\.(\d+))?/g),
  ].map((match) => Number(`${match[1]}.${match[2] ?? "0"}`));

  if (versions.length === 0) {
    return true;
  }

  return versions.every((version) => version >= 8);
}

function isVariadicParameter(parameter: PhpMethodParameter): boolean {
  return parameter.raw.includes("...");
}

function phpNamedArgumentCallTargetBefore(
  callablePrefix: string,
): PhpNamedArgumentCallTarget | null {
  const memberMatch = MEMBER_METHOD_CALL_PATTERN.exec(callablePrefix);

  if (memberMatch?.[1] && memberMatch[2]) {
    return {
      kind: "member-method",
      methodName: memberMatch[2],
      receiverExpression: phpNormalizeReceiverExpression(memberMatch[1]),
    };
  }

  const staticMatch = STATIC_METHOD_CALL_PATTERN.exec(callablePrefix);

  if (staticMatch?.[1] && staticMatch[2]) {
    return {
      className: staticMatch[1].replace(/^\\+/, ""),
      kind: "static-method",
      methodName: staticMatch[2],
    };
  }

  const constructorMatch = CONSTRUCTOR_CALL_PATTERN.exec(callablePrefix);
  const constructorClassName = constructorMatch?.[1]?.replace(/^\\+/, "");

  if (constructorClassName && constructorClassName.toLowerCase() !== "class") {
    return { className: constructorClassName, kind: "constructor" };
  }

  const localCallable = LOCAL_CALLABLE_PATTERN.exec(callablePrefix);

  if (localCallable?.[1]) {
    return { kind: "local-callable", variableName: localCallable[1] };
  }

  const functionMatch = FUNCTION_CALL_PATTERN.exec(callablePrefix);
  const functionName = functionMatch?.[1]?.replace(/^\\+/, "");

  if (
    functionMatch &&
    functionName &&
    !DECLARATION_KEYWORDS.has(functionName.toLowerCase()) &&
    !/(?:function|fn)\s+$/.test(callablePrefix.slice(0, functionMatch.index))
  ) {
    return { functionName, kind: "function" };
  }

  return null;
}

function functionParametersFromSource(
  source: string,
  requestedName: string,
  cursorOffset: number,
): string | null {
  const sourceBeforeCursor = source.slice(0, cursorOffset);
  const masked = maskNamedArgumentSource(sourceBeforeCursor);
  const requestedIdentity = resolveFunctionIdentityAt(
    sourceBeforeCursor,
    masked,
    requestedName,
    sourceBeforeCursor.length,
  );
  const shortName = requestedIdentity.split("\\").pop()?.toLowerCase();

  if (!shortName) {
    return null;
  }

  const pattern = /\bfunction\s+&?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\(/g;
  const typeBodyRanges = phpTopLevelTypeDeclarationNames(
    sourceBeforeCursor,
  ).flatMap((className) => {
    const identity = parsePhpClassStructure(
      sourceBeforeCursor,
      className,
    ).typeDeclaration;
    return identity
      ? [
          {
            end: identity.bodyEndOffset,
            start: identity.bodyStartOffset,
          },
        ]
      : [];
  });
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(masked))) {
    if (
      typeBodyRanges.some(
        (range) => match!.index > range.start && match!.index < range.end,
      )
    ) {
      continue;
    }
    const declaredName = match[1];
    if (!declaredName || declaredName.toLowerCase() !== shortName) {
      continue;
    }

    const declarationNamespace = namespaceAtOffset(masked, match.index);
    const declarationIdentity = declarationNamespace
      ? `${declarationNamespace}\\${declaredName}`.toLowerCase()
      : declaredName.toLowerCase();

    if (declarationIdentity !== requestedIdentity.toLowerCase()) {
      continue;
    }

    return parenthesizedContent(sourceBeforeCursor, pattern.lastIndex - 1);
  }

  return null;
}

function localCallableParametersFromSource(
  source: string,
  variableName: string,
): string | null {
  const masked = maskNamedArgumentSource(source);
  const callScope = lexicalFunctionScopeAt(masked, masked.length);
  const escapedName = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const assignmentPattern = new RegExp(`\\$${escapedName}\\s*=(?!=)`, "g");
  let latestAssignmentEnd: number | null = null;

  while (assignmentPattern.exec(masked)) {
    if (
      !sameLexicalFunctionScope(
        callScope,
        lexicalFunctionScopeAt(masked, assignmentPattern.lastIndex),
      )
    ) {
      continue;
    }
    latestAssignmentEnd = assignmentPattern.lastIndex;
  }

  if (latestAssignmentEnd === null) {
    return null;
  }

  const assignedSuffix = masked.slice(latestAssignmentEnd);
  const callablePrefix = /^\s*(?:static\s+)?(?:function\s*|fn\s*)\(/.exec(
    assignedSuffix,
  );

  if (!callablePrefix) {
    return null;
  }

  const relativeOpenOffset = callablePrefix[0].lastIndexOf("(");
  return parenthesizedContent(source, latestAssignmentEnd + relativeOpenOffset);
}

interface PhpLexicalFunctionScope {
  readonly end: number;
  readonly start: number;
}

function lexicalFunctionScopeAt(
  masked: string,
  offset: number,
): PhpLexicalFunctionScope | null {
  const scopes: PhpLexicalFunctionScope[] = [];
  const functionPattern = /\bfunction\b/g;
  let match: RegExpExecArray | null;

  while ((match = functionPattern.exec(masked))) {
    if (match.index >= offset) {
      break;
    }

    const parameterOpen = masked.indexOf("(", functionPattern.lastIndex);
    if (parameterOpen < 0 || parameterOpen >= offset) {
      continue;
    }

    const parameterClose = matchingDelimiterOffset(
      masked,
      parameterOpen,
      "(",
      ")",
    );
    if (parameterClose < 0) {
      continue;
    }

    const bodyOpen = functionBodyOpenOffset(masked, parameterClose + 1);
    if (bodyOpen < 0 || bodyOpen >= offset) {
      continue;
    }

    const bodyClose = matchingBraceOffset(masked, bodyOpen);
    if (offset > bodyClose) {
      continue;
    }

    scopes.push({ end: bodyClose, start: bodyOpen + 1 });
  }

  return scopes.reduce<PhpLexicalFunctionScope | null>((innermost, scope) => {
    if (!innermost || scope.start >= innermost.start) {
      return scope;
    }
    return innermost;
  }, null);
}

function functionBodyOpenOffset(masked: string, start: number): number {
  for (let index = start; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "{") {
      return index;
    }
    if (character === ";" || masked.slice(index, index + 2) === "=>") {
      return -1;
    }
  }
  return -1;
}

function matchingDelimiterOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number {
  let depth = 0;
  for (let index = openOffset; index < source.length; index += 1) {
    if (source[index] === open) {
      depth += 1;
      continue;
    }
    if (source[index] !== close) {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return index;
    }
  }
  return -1;
}

function sameLexicalFunctionScope(
  left: PhpLexicalFunctionScope | null,
  right: PhpLexicalFunctionScope | null,
): boolean {
  if (!left || !right) {
    return left === right;
  }
  return left.start === right.start && left.end === right.end;
}

function parenthesizedContent(
  source: string,
  openOffset: number,
): string | null {
  const masked = maskNamedArgumentSource(source);
  let depth = 0;

  for (let index = openOffset; index < masked.length; index += 1) {
    const character = masked[index];
    if (character === "(") {
      depth += 1;
      continue;
    }
    if (character !== ")") {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return source.slice(openOffset + 1, index);
    }
  }

  return null;
}

function resolveFunctionIdentityAt(
  source: string,
  masked: string,
  requestedName: string,
  offset: number,
): string {
  const absolute = requestedName.startsWith("\\");
  const normalized = requestedName.replace(/^\\+/, "");

  if (absolute) {
    return normalized;
  }

  const namespaceName = namespaceAtOffset(masked, offset);
  if (normalized.includes("\\")) {
    return namespaceName ? `${namespaceName}\\${normalized}` : normalized;
  }

  const importedIdentity = importedFunctionIdentityAt(
    source,
    masked,
    normalized,
    offset,
  );
  if (importedIdentity) {
    return importedIdentity;
  }

  return namespaceName ? `${namespaceName}\\${normalized}` : normalized;
}

function importedFunctionIdentityAt(
  source: string,
  masked: string,
  requestedName: string,
  offset: number,
): string | null {
  const namespaceRange = namespaceRangeAtOffset(masked, offset);
  const rangeStart = namespaceRange?.start ?? 0;
  const rangeEnd = Math.min(offset, namespaceRange?.end ?? offset);
  const importPattern =
    /\buse\s+function\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/gi;
  importPattern.lastIndex = rangeStart;
  let match: RegExpExecArray | null;

  while ((match = importPattern.exec(masked))) {
    if (match.index >= rangeEnd) {
      break;
    }

    const identity = source
      .slice(match.index, importPattern.lastIndex)
      .match(
        /\buse\s+function\s+(\\?[A-Za-z_][A-Za-z0-9_\\]*)(?:\s+as\s+([A-Za-z_][A-Za-z0-9_]*))?\s*;/i,
      );
    const importedName = identity?.[1]?.replace(/^\\+/, "");
    const alias = identity?.[2] ?? importedName?.split("\\").pop();

    if (importedName && alias?.toLowerCase() === requestedName.toLowerCase()) {
      return importedName;
    }
  }

  return null;
}

interface PhpNamespaceRange {
  readonly end: number;
  readonly name: string;
  readonly start: number;
}

function namespaceAtOffset(masked: string, offset: number): string {
  return namespaceRangeAtOffset(masked, offset)?.name ?? "";
}

function namespaceRangeAtOffset(
  masked: string,
  offset: number,
): PhpNamespaceRange | null {
  const declarations = [
    ...masked.matchAll(/\bnamespace\s+([A-Za-z_][A-Za-z0-9_\\]*)\s*([;{])/g),
  ];

  for (let index = declarations.length - 1; index >= 0; index -= 1) {
    const declaration = declarations[index];
    if (declaration?.index === undefined || declaration.index >= offset) {
      continue;
    }

    const name = declaration[1];
    const delimiter = declaration[2];
    if (!name || !delimiter) {
      continue;
    }

    const start = declaration.index + declaration[0].length;
    if (delimiter === ";") {
      const nextStart = declarations[index + 1]?.index ?? masked.length;
      if (offset <= nextStart) {
        return { end: nextStart, name, start };
      }
      continue;
    }

    const openBrace = start - 1;
    const closeBrace = matchingBraceOffset(masked, openBrace);
    if (offset > openBrace && offset <= closeBrace) {
      return { end: closeBrace, name, start };
    }
  }

  return null;
}

function matchingBraceOffset(masked: string, openOffset: number): number {
  let depth = 0;
  for (let index = openOffset; index < masked.length; index += 1) {
    if (masked[index] === "{") {
      depth += 1;
      continue;
    }
    if (masked[index] !== "}") {
      continue;
    }
    depth -= 1;
    if (depth === 0) {
      return index;
    }
  }
  return masked.length;
}

function maskNamedArgumentSource(source: string): string {
  const characters = [...maskPhpStringsAndComments(source)];
  for (const range of phpHeredocRanges(source)) {
    for (let index = range.start; index < range.end; index += 1) {
      if (characters[index] !== "\n" && characters[index] !== "\r") {
        characters[index] = " ";
      }
    }
  }
  return characters.join("");
}

interface PhpSourceRange {
  readonly end: number;
  readonly start: number;
}

function phpHeredocRanges(source: string): PhpSourceRange[] {
  const ranges: PhpSourceRange[] = [];
  const baseMasked = maskPhpStringsAndComments(source);
  const openerPattern =
    /<<<[ \t]*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|([A-Za-z_][A-Za-z0-9_]*))[^\r\n]*(?:\r?\n|$)/g;
  let opener: RegExpExecArray | null;

  while ((opener = openerPattern.exec(source))) {
    if (baseMasked.slice(opener.index, opener.index + 3) !== "<<<") {
      continue;
    }
    const label = opener[1] ?? opener[2] ?? opener[3];
    if (!label || opener.index === undefined) {
      continue;
    }
    const terminatorPattern = new RegExp(
      `^[ \\t]*${label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")};?[ \\t]*(?:\\r?$)`,
      "m",
    );
    const suffix = source.slice(openerPattern.lastIndex);
    const terminator = terminatorPattern.exec(suffix);
    const end = terminator
      ? openerPattern.lastIndex + terminator.index + terminator[0].length
      : source.length;
    ranges.push({ end, start: opener.index });
    openerPattern.lastIndex = end;
  }
  return ranges;
}

function callableCompletion(
  label: string,
  parameters: string,
): PhpMethodCompletion {
  return {
    declaringClassName: label,
    name: "__invoke",
    parameters,
    returnType: null,
  };
}

function namedArgumentCallableLabel(member: PhpMethodCompletion): string {
  return member.name === "__invoke"
    ? member.declaringClassName
    : `${member.declaringClassName}::${member.name}`;
}

function namedArgumentDetail(
  member: PhpMethodCompletion,
  parameter: PhpMethodParameter,
): string {
  return `parameter ${parameter.raw.trim()} of ${namedArgumentCallableLabel(member)}()`;
}

function innermostOpenParenOffset(masked: string): number | null {
  const openOffsets: number[] = [];

  for (let index = 0; index < masked.length; index += 1) {
    const character = masked[index] || "";

    if (character === "(") {
      openOffsets.push(index);
      continue;
    }

    if (character === ")") {
      openOffsets.pop();
    }
  }

  return openOffsets.length > 0
    ? (openOffsets[openOffsets.length - 1] ?? null)
    : null;
}

function topLevelArgumentSegments(argumentsSource: string): string[] {
  const segments: string[] = [];
  let segmentStart = 0;
  let depth = 0;

  for (let index = 0; index < argumentsSource.length; index += 1) {
    const character = argumentsSource[index] || "";

    if (character === "(" || character === "[" || character === "{") {
      depth += 1;
      continue;
    }

    if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (character === "," && depth === 0) {
      segments.push(argumentsSource.slice(segmentStart, index));
      segmentStart = index + 1;
    }
  }

  segments.push(argumentsSource.slice(segmentStart));
  return segments;
}

function hasUnterminatedBlockComment(masked: string): boolean {
  const lastOpen = masked.lastIndexOf("/*");

  return lastOpen >= 0 && masked.indexOf("*/", lastOpen) < 0;
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

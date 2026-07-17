import type { EditorPosition } from "./languageServerFeatures";
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

export function phpNamedArgumentCompletionContextAt(
  source: string,
  position: EditorPosition,
): PhpNamedArgumentCompletionContext | null {
  const offset = offsetAtPosition(source, position);
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
    detail: `parameter ${parameter.raw.trim()} of ${member.declaringClassName}::${member.name}()`,
    documentation: `Named argument\n\n${member.declaringClassName}::${member.name}(${parameter.raw.trim()})`,
    insertText: `${parameterName}: `,
    kind: "property",
    name: `${parameterName}:`,
    parameters: "",
    returnType: parameter.type,
  };
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

  if (
    constructorClassName &&
    constructorClassName.toLowerCase() !== "class"
  ) {
    return { className: constructorClassName, kind: "constructor" };
  }

  return null;
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
    ? openOffsets[openOffsets.length - 1] ?? null
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

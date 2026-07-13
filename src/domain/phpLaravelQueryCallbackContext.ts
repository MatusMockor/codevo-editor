import type { EditorPosition } from "./languageServerFeatures";
import {
  PHP_CLASS_NAME_CAPTURE_PATTERN,
  PHP_CLASS_NAME_PATTERN,
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";

export interface PhpLaravelQueryCallbackContext {
  methodName: string;
  modelClassName: string | null;
  morphTypeClassNames?: string[];
  previousRelationNames?: string[];
  receiverExpression: string | null;
  relationName: string | null;
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

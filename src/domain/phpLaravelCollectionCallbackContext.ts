import type { EditorPosition } from "./languageServerFeatures";
import { isLaravelHigherOrderCollectionProxyMethod } from "./phpLaravelHigherOrderProxy";
import {
  matchingPairOffset,
  phpArrowCallbackForVariable,
  phpCallbackArgumentIndex,
  phpClosureCallbackForVariable,
  splitPhpArgumentsWithOffsets,
} from "./phpLaravelQueryCallbackContext";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_ACCESS_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";

export interface PhpLaravelCollectionCallbackContext {
  methodName: string;
  receiverExpression: string;
}

export function phpLaravelCollectionCallbackContextForVariable(
  source: string,
  position: EditorPosition,
  variableName: string,
): PhpLaravelCollectionCallbackContext | null {
  const callback =
    phpClosureCallbackForVariable(source, position, variableName) ??
    phpArrowCallbackForVariable(source, position, variableName);

  if (!callback) {
    return null;
  }

  if (
    phpUntypedFirstCallbackParameterName(callback.parametersSource) !==
    variableName
  ) {
    return null;
  }

  const methodCallPattern = new RegExp(
    String.raw`(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:` +
      PHP_MEMBER_CHAIN_SEGMENT_PATTERN +
      String.raw`)*)` +
      PHP_MEMBER_ACCESS_PATTERN +
      String.raw`([A-Za-z_][A-Za-z0-9_]*)\s*\(`,
    "g",
  );
  let context: PhpLaravelCollectionCallbackContext | null = null;

  for (const match of source.matchAll(methodCallPattern)) {
    const startOffset = match.index ?? 0;

    if (startOffset > callback.startOffset) {
      break;
    }

    const methodName = match[2] ?? "";

    if (!isLaravelHigherOrderCollectionProxyMethod(methodName)) {
      continue;
    }

    const openOffset = startOffset + (match[0]?.lastIndexOf("(") ?? -1);

    if (openOffset < startOffset) {
      continue;
    }

    const closeOffset = matchingPairOffset(source, openOffset, "(", ")");

    if (
      closeOffset === null ||
      callback.startOffset <= openOffset ||
      callback.startOffset >= closeOffset
    ) {
      continue;
    }

    if (
      phpCallbackArgumentIndex(
        source,
        openOffset + 1,
        closeOffset,
        callback.startOffset,
      ) !== 0
    ) {
      continue;
    }

    const receiverExpression = phpNormalizeReceiverExpression(
      match[1]?.trim() ?? "",
    );

    if (!receiverExpression) {
      continue;
    }

    context = { methodName, receiverExpression };
  }

  return context;
}

function phpUntypedFirstCallbackParameterName(
  parametersSource: string,
): string | null {
  const firstParameter =
    splitPhpArgumentsWithOffsets(parametersSource)[0]?.value ?? "";
  const parameterVariable = /^(?:&|\.\.\.)?\s*\$([A-Za-z_][A-Za-z0-9_]*)/.exec(
    firstParameter,
  );

  return parameterVariable?.[1] ?? null;
}

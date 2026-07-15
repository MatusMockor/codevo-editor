import type { EditorPosition } from "./languageServerFeatures";
import {
  PHP_EXPRESSION_RECEIVER_PATTERN,
  PHP_MEMBER_CHAIN_SEGMENT_PATTERN,
  phpNormalizeReceiverExpression,
} from "./phpReceiverExpressions";
import { maskPhpSource } from "./phpSourceMask";

export interface PhpNetteDatabaseDefinitionContext {
  key: string;
  kind: "activeRow" | "selection";
  position: EditorPosition;
  receiverExpression: string;
  receiverPhpDocType: string | null;
  tableName: string;
}

const receiverSuffixPattern = new RegExp(
  `(${PHP_EXPRESSION_RECEIVER_PATTERN}(?:${PHP_MEMBER_CHAIN_SEGMENT_PATTERN})*)\\s*$`,
);

export function phpNetteDatabaseDefinitionContextAt(
  source: string,
  offset: number,
): PhpNetteDatabaseDefinitionContext | null {
  const literal = stringLiteralAtOffset(source, offset);

  if (!literal) {
    return null;
  }

  const masked = maskPhpSource(source);
  const openParen = previousNonWhitespaceOffset(
    masked,
    literal.startOffset - 1,
  );

  if (openParen < 0 || masked[openParen] !== "(") {
    return null;
  }

  const methodEnd = previousNonWhitespaceOffset(masked, openParen - 1);
  const methodMatch = /(?:ref|related)$/i.exec(
    masked.slice(0, methodEnd + 1),
  );

  if (
    !methodMatch ||
    methodMatch.index + methodMatch[0].length !== methodEnd + 1
  ) {
    return null;
  }

  const methodName = methodMatch[0].toLowerCase() as "ref" | "related";
  const methodStart = methodMatch.index;
  const operatorEnd = previousNonWhitespaceOffset(masked, methodStart - 1);
  const operatorPrefix = masked.slice(
    Math.max(0, operatorEnd - 2),
    operatorEnd + 1,
  );
  const operatorLength = operatorPrefix.endsWith("?->") ? 3 : 2;

  if (!operatorPrefix.endsWith("->")) {
    return null;
  }

  const operatorStart = operatorEnd - operatorLength + 1;
  const receiverMatch = receiverSuffixPattern.exec(
    source.slice(0, operatorStart),
  );
  const receiverExpression = receiverMatch?.[1] ?? "";

  if (!receiverExpression) {
    return null;
  }

  const nextOffset = nextNonWhitespaceOffset(source, literal.endOffset + 1);

  if (
    nextOffset < 0 ||
    (source[nextOffset] !== ")" && source[nextOffset] !== ",")
  ) {
    return null;
  }

  const keyPattern =
    methodName === "related"
      ? /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)?$/
      : /^[A-Za-z_][A-Za-z0-9_]*$/;

  if (!keyPattern.test(literal.value)) {
    return null;
  }

  return {
    key: literal.value,
    kind: methodName === "ref" ? "activeRow" : "selection",
    position: editorPositionAtOffset(
      source,
      Math.max(literal.startOffset + 1, Math.min(offset, literal.endOffset)),
    ),
    receiverExpression: phpNormalizeReceiverExpression(receiverExpression),
    receiverPhpDocType: phpDocParameterTypeBefore(
      source,
      literal.startOffset,
      receiverExpression,
    ),
    tableName: literal.value.split(".")[0] ?? literal.value,
  };
}

function phpDocParameterTypeBefore(
  source: string,
  offset: number,
  receiverExpression: string,
): string | null {
  const variableName = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    phpNormalizeReceiverExpression(receiverExpression),
  )?.[1];

  if (!variableName) {
    return null;
  }

  const masked = maskPhpSource(source);
  const declarationPattern =
    /\bfunction\s+&?\s*[A-Za-z_][A-Za-z0-9_]*\s*\(/g;
  let functionOffset: number | null = null;

  for (const match of masked.matchAll(declarationPattern)) {
    const declarationOffset = match.index ?? 0;
    const parametersStart = declarationOffset + match[0].lastIndexOf("(");
    const parametersEnd = matchingPairOffset(
      masked,
      parametersStart,
      "(",
      ")",
    );

    if (parametersEnd === null) {
      continue;
    }

    const parameters = source.slice(parametersStart + 1, parametersEnd);

    if (!new RegExp(`\\$${variableName}\\b`).test(parameters)) {
      continue;
    }

    const bodyStart = functionBodyStart(masked, parametersEnd + 1);

    if (bodyStart === null || bodyStart >= offset) {
      continue;
    }

    const bodyEnd = matchingPairOffset(masked, bodyStart, "{", "}");

    if (bodyEnd === null || offset > bodyEnd) {
      continue;
    }

    functionOffset = declarationOffset;
  }

  if (functionOffset === null) {
    return null;
  }

  const beforeFunction = source.slice(0, functionOffset);
  const docBlocks = Array.from(beforeFunction.matchAll(/\/\*\*[\s\S]*?\*\//g));
  const docBlock = docBlocks[docBlocks.length - 1];

  if (!docBlock) {
    return null;
  }

  const gap = beforeFunction.slice(
    (docBlock.index ?? 0) + docBlock[0].length,
  );

  if (
    !/^\s*(?:(?:final|abstract|public|protected|private|static|readonly)\s+)*$/.test(
      gap,
    )
  ) {
    return null;
  }

  const parameterPattern = new RegExp(
    `@(?:(?:phpstan|psalm)-)?param\\s+([^\\r\\n*]+?)\\s+\\$${variableName}\\b`,
  );
  const rawType = parameterPattern.exec(docBlock[0])?.[1] ?? "";

  return singlePhpDocObjectType(rawType);
}

function stringLiteralAtOffset(
  source: string,
  offset: number,
): { endOffset: number; startOffset: number; value: string } | null {
  const safeOffset = Math.max(0, Math.min(offset, source.length));
  let index = 0;

  while (index < source.length) {
    if (source.startsWith("//", index) || source[index] === "#") {
      index = source.indexOf("\n", index + 1);

      if (index < 0) {
        return null;
      }

      continue;
    }

    if (source.startsWith("/*", index)) {
      const commentEnd = source.indexOf("*/", index + 2);

      if (commentEnd < 0) {
        return null;
      }

      index = commentEnd + 2;
      continue;
    }

    const quote = source[index];

    if (quote !== "'" && quote !== '"') {
      index += 1;
      continue;
    }

    const startOffset = index;
    index += 1;

    while (index < source.length) {
      if (source[index] !== quote || isEscaped(source, index)) {
        index += 1;
        continue;
      }

      const endOffset = index;

      if (safeOffset >= startOffset && safeOffset <= endOffset) {
        return {
          endOffset,
          startOffset,
          value: source.slice(startOffset + 1, endOffset),
        };
      }

      index += 1;
      break;
    }
  }

  return null;
}

function functionBodyStart(source: string, offset: number): number | null {
  for (let index = offset; index < source.length; index += 1) {
    if (source[index] === ";") {
      return null;
    }

    if (source[index] === "{") {
      return index;
    }
  }

  return null;
}

function matchingPairOffset(
  source: string,
  openOffset: number,
  open: string,
  close: string,
): number | null {
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

  return null;
}

function singlePhpDocObjectType(rawType: string): string | null {
  const sentinels = new Set(["false", "null", "true"]);
  const builtins = new Set([
    "array",
    "bool",
    "callable",
    "float",
    "int",
    "iterable",
    "mixed",
    "never",
    "object",
    "resource",
    "scalar",
    "string",
    "void",
  ]);
  const candidates = new Map<string, string>();

  for (const rawPart of rawType.split(/[|&]/)) {
    const part = rawPart.trim().replace(/^\?/, "");
    const normalizedPart = part.toLowerCase();

    if (sentinels.has(normalizedPart)) {
      continue;
    }

    if (builtins.has(normalizedPart)) {
      return null;
    }

    if (
      !/^\\?[A-Za-z_][A-Za-z0-9_]*(?:\\[A-Za-z_][A-Za-z0-9_]*)*$/.test(
        part,
      )
    ) {
      return null;
    }

    const key = part.replace(/^\\/, "").toLowerCase();
    const previous = candidates.get(key);

    if (!previous || part.startsWith("\\")) {
      candidates.set(key, part);
    }
  }

  if (candidates.size !== 1) {
    return null;
  }

  return candidates.values().next().value ?? null;
}

function isEscaped(source: string, offset: number): boolean {
  let slashCount = 0;

  for (
    let index = offset - 1;
    index >= 0 && source[index] === "\\";
    index -= 1
  ) {
    slashCount += 1;
  }

  return slashCount % 2 === 1;
}

function previousNonWhitespaceOffset(source: string, offset: number): number {
  let index = offset;

  while (index >= 0 && /\s/.test(source[index] ?? "")) {
    index -= 1;
  }

  return index;
}

function nextNonWhitespaceOffset(source: string, offset: number): number {
  let index = offset;

  while (index < source.length && /\s/.test(source[index] ?? "")) {
    index += 1;
  }

  return index < source.length ? index : -1;
}

function editorPositionAtOffset(source: string, offset: number): EditorPosition {
  const before = source.slice(0, offset);
  const lineStart = before.lastIndexOf("\n") + 1;

  return {
    column: offset - lineStart + 1,
    lineNumber: before.split("\n").length,
  };
}

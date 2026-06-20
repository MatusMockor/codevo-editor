export const PHP_CLASS_NAME_PATTERN = String.raw`(?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*`;
export const PHP_CLASS_NAME_CAPTURE_PATTERN = String.raw`((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)`;
export const PHP_MEMBER_ACCESS_OPERATOR_PATTERN = String.raw`\??->`;
export const PHP_MEMBER_ACCESS_PATTERN = String.raw`\s*${PHP_MEMBER_ACCESS_OPERATOR_PATTERN}\s*`;
export const PHP_MEMBER_CHAIN_SEGMENT_PATTERN = String.raw`${PHP_MEMBER_ACCESS_PATTERN}[A-Za-z_][A-Za-z0-9_]*\s*(?:\([^)]*\))?`;
export const PHP_CONTAINER_CALL_PATTERN = String.raw`(?:(?:app|resolve|make)\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\)|app\s*\(\s*\)${PHP_MEMBER_ACCESS_PATTERN}make\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\)|${PHP_CLASS_NAME_PATTERN}\s*::\s*make\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\)|${PHP_CLASS_NAME_PATTERN}\s*::\s*getInstance\s*\(\s*\)${PHP_MEMBER_ACCESS_PATTERN}make\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\))`;
export const PHP_FUNCTION_CALL_RECEIVER_PATTERN = String.raw`[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)`;
export const PHP_STATIC_CALL_RECEIVER_PATTERN = String.raw`${PHP_CLASS_NAME_PATTERN}\s*::\s*[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)`;
export const PHP_MEMBER_RECEIVER_PATTERN = String.raw`(?:\$[A-Za-z_][A-Za-z0-9_]*|\$this|${PHP_CONTAINER_CALL_PATTERN})`;
export const PHP_EXPRESSION_RECEIVER_PATTERN = String.raw`(?:new\s+${PHP_CLASS_NAME_PATTERN}\s*\([^)]*\)|${PHP_MEMBER_RECEIVER_PATTERN}|${PHP_STATIC_CALL_RECEIVER_PATTERN}|${PHP_FUNCTION_CALL_RECEIVER_PATTERN})`;

export interface PhpStatementPrefix {
  startOffset: number;
  text: string;
}

export function phpNormalizeReceiverExpression(receiverExpression: string): string {
  return receiverExpression
    .replace(/\s*\?\s*->\s*/g, "?->")
    .replace(/\s*->\s*/g, "->")
    .replace(/\s*::\s*/g, "::")
    .trim();
}

export function phpSimpleVariableName(receiverExpression: string): string | null {
  const match = /^\$([A-Za-z_][A-Za-z0-9_]*)$/.exec(
    phpNormalizeReceiverExpression(receiverExpression),
  );

  return match?.[1] ?? null;
}

export function phpStatementPrefixBeforeOffset(
  source: string,
  offset: number,
): string {
  return phpStatementPrefixRangeBeforeOffset(source, offset).text;
}

export function phpStatementPrefixRangeBeforeOffset(
  source: string,
  offset: number,
  maxCharacters = 1200,
): PhpStatementPrefix {
  const safeOffset = Math.max(0, Math.min(source.length, offset));
  const windowStart = Math.max(0, safeOffset - maxCharacters);
  const text = source.slice(windowStart, safeOffset);
  const masked = maskPhpReceiverContext(text);
  let parenthesesDepth = 0;
  let bracketsDepth = 0;

  for (let index = masked.length - 1; index >= 0; index -= 1) {
    const character = masked[index];

    if (character === ")") {
      parenthesesDepth += 1;
      continue;
    }

    if (character === "(") {
      parenthesesDepth = Math.max(0, parenthesesDepth - 1);
      continue;
    }

    if (character === "]") {
      bracketsDepth += 1;
      continue;
    }

    if (character === "[") {
      bracketsDepth = Math.max(0, bracketsDepth - 1);
      continue;
    }

    if (
      parenthesesDepth === 0 &&
      bracketsDepth === 0 &&
      (character === ";" || character === "{" || character === "}")
    ) {
      return {
        startOffset: windowStart + index + 1,
        text: text.slice(index + 1),
      };
    }
  }

  const openTagOffset = text.lastIndexOf("<?php");

  if (openTagOffset >= 0) {
    return {
      startOffset: windowStart + openTagOffset + "<?php".length,
      text: text.slice(openTagOffset + "<?php".length),
    };
  }

  return {
    startOffset: windowStart,
    text,
  };
}

function maskPhpReceiverContext(source: string): string {
  return source.replace(
    /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|\/\/[^\r\n]*|#[^\r\n]*|\/\*[\s\S]*?\*\//g,
    (match) => " ".repeat(match.length),
  );
}

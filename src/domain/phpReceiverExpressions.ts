export const PHP_CLASS_NAME_PATTERN = String.raw`(?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*`;
export const PHP_CLASS_NAME_CAPTURE_PATTERN = String.raw`((?:\\?[A-Za-z_][A-Za-z0-9_]*)(?:\\[A-Za-z_][A-Za-z0-9_]*)*)`;
export const PHP_CONTAINER_CALL_PATTERN = String.raw`(?:(?:app|resolve|make)\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\)|app\s*\(\s*\)\s*->\s*make\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\)|${PHP_CLASS_NAME_PATTERN}\s*::\s*make\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\)|${PHP_CLASS_NAME_PATTERN}\s*::\s*getInstance\s*\(\s*\)\s*->\s*make\s*\(\s*${PHP_CLASS_NAME_PATTERN}::class\s*\))`;
export const PHP_FUNCTION_CALL_RECEIVER_PATTERN = String.raw`[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)`;
export const PHP_STATIC_CALL_RECEIVER_PATTERN = String.raw`${PHP_CLASS_NAME_PATTERN}\s*::\s*[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)`;
export const PHP_MEMBER_RECEIVER_PATTERN = String.raw`(?:\$[A-Za-z_][A-Za-z0-9_]*|\$this|${PHP_CONTAINER_CALL_PATTERN})`;
export const PHP_EXPRESSION_RECEIVER_PATTERN = String.raw`(?:new\s+${PHP_CLASS_NAME_PATTERN}\s*\([^)]*\)|${PHP_MEMBER_RECEIVER_PATTERN}|${PHP_STATIC_CALL_RECEIVER_PATTERN}|${PHP_FUNCTION_CALL_RECEIVER_PATTERN})`;

export function phpNormalizeReceiverExpression(receiverExpression: string): string {
  return receiverExpression
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

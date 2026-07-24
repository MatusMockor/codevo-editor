export const MAX_NODE_DEBUG_TASK_LABEL_BYTES = 256;

export function isNodeDebugTaskLabel(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.trim() === value &&
    new TextEncoder().encode(value).byteLength <= MAX_NODE_DEBUG_TASK_LABEL_BYTES &&
    !hasUnsafeDisplayCharacter(value)
  );
}

function hasUnsafeDisplayCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0)!;
    if (
      codePoint === 0x7f ||
      (codePoint >= 0 && codePoint <= 0x1f) ||
      (codePoint >= 0x80 && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069)
    ) {
      return true;
    }
  }
  return false;
}

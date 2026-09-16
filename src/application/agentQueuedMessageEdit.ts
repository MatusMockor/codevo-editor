export const RESTORED_PROMPT_SEPARATOR = "\n\n";

const TRAILING_WHITESPACE = /\s+$/u;

export function mergeRestoredPrompt(existing: string, restored: string): string {
  if (restored === "") return existing;
  const kept = existing.replace(TRAILING_WHITESPACE, "");
  if (kept === "") return restored;
  return `${kept}${RESTORED_PROMPT_SEPARATOR}${restored}`;
}

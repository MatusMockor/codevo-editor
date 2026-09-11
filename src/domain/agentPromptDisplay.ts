const ATTACHED_IMAGE_LINE_PREFIX = '[Attached image "';
const ATTACHED_IMAGE_LINE_SEPARATOR = '" is saved at: ';
const ATTACHED_IMAGE_LINE_SUFFIX = "]";

export function isAttachedImagePromptLine(line: string): boolean {
  if (!line.startsWith(ATTACHED_IMAGE_LINE_PREFIX)) return false;
  if (!line.endsWith(ATTACHED_IMAGE_LINE_SUFFIX)) return false;
  const body = line.slice(
    ATTACHED_IMAGE_LINE_PREFIX.length,
    line.length - ATTACHED_IMAGE_LINE_SUFFIX.length,
  );
  const separator = body.indexOf(ATTACHED_IMAGE_LINE_SEPARATOR);
  if (separator <= 0) return false;
  const name = body.slice(0, separator);
  const storedPath = body.slice(separator + ATTACHED_IMAGE_LINE_SEPARATOR.length);
  return !name.includes('"') && storedPath.startsWith("/");
}

export function agentPromptDisplayText(prompt: string): string {
  if (!prompt.includes(ATTACHED_IMAGE_LINE_PREFIX)) return prompt;
  const lines = prompt.split("\n");
  const kept = lines.filter((line) => !isAttachedImagePromptLine(line));
  if (kept.length === lines.length) return prompt;
  return kept.join("\n").replace(/\n+$/u, "");
}

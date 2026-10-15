export const MAX_TEXT_DIFF_INPUT_CHARS = 1_000_000;

export interface BoundedDiffText {
  readonly text: string;
  readonly truncated: boolean;
}

export function boundDiffText(text: string, maxChars = MAX_TEXT_DIFF_INPUT_CHARS): BoundedDiffText {
  if (text.length <= maxChars) return { text, truncated: false };
  const cut = text.lastIndexOf("\n", maxChars - 1);
  return { text: text.slice(0, cut >= 0 ? cut + 1 : maxChars), truncated: true };
}

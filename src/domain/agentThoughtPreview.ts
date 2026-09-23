export const MAX_AGENT_THOUGHT_PREVIEW_SOURCE_CHARS = 1_024;
export const MAX_AGENT_THOUGHT_PREVIEW_CHARS = 240;

const MARKDOWN_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/```[^\n]*/gu, " "],
  [/<[a-zA-Z/!][^>\n]{0,199}>/gu, " "],
  [/!\[([^\]\n]*)\]\([^)\n]*\)/gu, "$1"],
  [/\[([^\]\n]*)\]\([^)\n]*\)/gu, "$1"],
  [/^[ \t]{0,3}#{1,6}[ \t]+/gmu, ""],
  [/^[ \t]{0,3}>[ \t]?/gmu, ""],
  [/^[ \t]*(?:[-*_][ \t]*){3,}$/gmu, " "],
  [/^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+/gmu, ""],
  [/(\*\*|~~)(?=\S)([^\n]*?\S)\1/gu, "$2"],
  [/(?<!\w)__(?=\S)([^\n]*?\S)__(?!\w)/gu, "$1"],
  [/\*(?=\S)([^\n*]*?\S)\*/gu, "$1"],
  [/(?<!\w)_(?=\S)([^\n_]*?\S)_(?!\w)/gu, "$1"],
  [/`+/gu, ""],
];

export function agentThoughtPreview(text: string): string {
  let plain = text
    .slice(0, MAX_AGENT_THOUGHT_PREVIEW_SOURCE_CHARS)
    .replace(/[\uD800-\uDBFF]$/u, "");
  for (const [pattern, replacement] of MARKDOWN_RULES) {
    plain = plain.replace(pattern, replacement);
  }
  const collapsed = plain.replace(/\s+/gu, " ").trim();
  if (collapsed.length <= MAX_AGENT_THOUGHT_PREVIEW_CHARS) return collapsed;
  return `${Array.from(collapsed).slice(0, MAX_AGENT_THOUGHT_PREVIEW_CHARS).join("").trimEnd()}…`;
}

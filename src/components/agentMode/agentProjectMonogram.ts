export function agentProjectMonogram(label: string): string {
  const first = [...label].find((character) => /[\p{L}\p{N}]/u.test(character));
  return first === undefined ? "?" : first.toLocaleUpperCase();
}

export function agentProjectBadgeMonogram(label: string): string {
  const words =
    label
      .normalize("NFKC")
      .trim()
      .match(/[\p{L}\p{N}]+/gu) ?? [];
  const firstWord = words[0];
  if (firstWord === undefined) return "PR";
  const glyphs = [...firstWord];
  const first = glyphs[0] ?? "P";
  const lastWord = words.length > 1 ? words[words.length - 1] : undefined;
  const second =
    glyphs.slice(1).find((glyph) => /\p{N}/u.test(glyph)) ??
    (lastWord === undefined ? glyphs[glyphs.length - 1] : [...lastWord][0]) ??
    first;
  return [...`${first}${second}`.toLocaleUpperCase()].slice(0, 2).join("");
}

export const AGENT_PROJECT_BADGE_TONES = 7;

export function agentProjectBadgeTone(label: string): number {
  const seed = label.normalize("NFKC").trim().toLocaleLowerCase("en-US") || "project";
  let index = 0;
  for (const glyph of seed) {
    index = (index * 31 + (glyph.codePointAt(0) ?? 0)) % AGENT_PROJECT_BADGE_TONES;
  }
  return index;
}

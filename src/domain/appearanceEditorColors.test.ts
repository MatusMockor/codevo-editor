import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EDITOR_EXTRA_COLORS } from "./appearanceEditorColors";

const semantic = readFileSync(resolve(import.meta.dirname, "../ui/tokens/semantic.css"), "utf8");

function schemeBlock(scheme: "dark" | "light"): string {
  const marker = `:root[data-cv-scheme="${scheme}"] {`;
  const start = semantic.indexOf(marker);
  expect(start, marker).toBeGreaterThanOrEqual(0);
  return semantic.slice(start, semantic.indexOf("}", start));
}

describe("EDITOR_EXTRA_COLORS", () => {
  it.each(["dark", "light"] as const)("matches the %s editor tokens in semantic.css", (scheme) => {
    const block = schemeBlock(scheme);
    const colors = EDITOR_EXTRA_COLORS[scheme];

    expect(block).toContain(`--cv-git-mod: ${colors.gitModified};`);
    expect(block).toContain(`--cv-breakpoint: ${colors.breakpoint};`);
    expect(block).toContain(`--cv-match: ${colors.match};`);
    expect(block).toContain(`--cv-match-current: ${colors.matchCurrent};`);
  });
});

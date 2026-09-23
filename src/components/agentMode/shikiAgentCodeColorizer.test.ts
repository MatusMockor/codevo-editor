import { describe, expect, it, vi } from "vitest";
import type { HighlighterCore } from "shiki/core";
import { MAX_AGENT_COLORIZED_CODE_CHARS } from "./agentCodeColorizer";
import { createShikiAgentCodeColorizer } from "./shikiAgentCodeColorizer";

function fakeHighlighter(initial: ReadonlyArray<string>) {
  const languages = new Set(initial);
  const loadLanguage = vi.fn(async () => {
    languages.add("shellscript");
  });
  const codeToTokensBase = vi.fn((code: string) => [
    [{ content: code, offset: 0, color: "#ABCDEF", fontStyle: 3 }],
  ]);
  const highlighter = {
    getLoadedLanguages: () => [...languages],
    getLoadedThemes: () => ["calm-dark"],
    loadLanguage,
    codeToTokensBase,
  } as unknown as HighlighterCore;
  return { highlighter, loadLanguage, codeToTokensBase };
}

describe("createShikiAgentCodeColorizer", () => {
  it("maps aliases, sanitizes styles and caches repeated blocks", async () => {
    const fake = fakeHighlighter(["typescript"]);
    const colorizer = createShikiAgentCodeColorizer("calm-dark", async () => fake.highlighter);
    const lines = await colorizer.colorize("const a = 1;", "tsx");
    expect(lines).toEqual([[{ text: "const a = 1;", color: "#ABCDEF", italic: true, bold: true }]]);
    await colorizer.colorize("const a = 1;", "tsx");
    expect(fake.codeToTokensBase).toHaveBeenCalledTimes(1);
  });

  it("lazily loads a shell grammar once and skips unknown languages and oversized code", async () => {
    const fake = fakeHighlighter([]);
    const colorizer = createShikiAgentCodeColorizer("calm-dark", async () => fake.highlighter);
    expect(await colorizer.colorize("ls", "bash")).not.toBeNull();
    expect(await colorizer.colorize("pwd", "sh")).not.toBeNull();
    expect(fake.loadLanguage).toHaveBeenCalledTimes(1);
    expect(await colorizer.colorize("x", "cobol")).toBeNull();
    expect(
      await colorizer.colorize("x".repeat(MAX_AGENT_COLORIZED_CODE_CHARS + 1), "bash"),
    ).toBeNull();
  });

  it("stays plain when the theme is not loaded", async () => {
    const fake = fakeHighlighter(["typescript"]);
    const colorizer = createShikiAgentCodeColorizer("dracula", async () => fake.highlighter);
    expect(await colorizer.colorize("const a = 1;", "ts")).toBeNull();
  });
});

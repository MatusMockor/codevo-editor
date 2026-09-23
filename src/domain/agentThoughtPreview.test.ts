import { describe, expect, it } from "vitest";
import {
  agentThoughtPreview,
  MAX_AGENT_THOUGHT_PREVIEW_CHARS,
  MAX_AGENT_THOUGHT_PREVIEW_SOURCE_CHARS,
} from "./agentThoughtPreview";

describe("agentThoughtPreview", () => {
  it("strips basic markdown and collapses whitespace into one line", () => {
    const text = [
      "## Plan",
      "",
      "> **Check** the `parser` and [docs](https://example.com)",
      "- first *step*",
      "1. then ~~skip~~ ![chart](a.png)",
      "---",
      "```ts",
      "const snake_case_name = 1;",
      "```",
    ].join("\n");

    expect(agentThoughtPreview(text)).toBe(
      "Plan Check the parser and docs first step then skip chart const snake_case_name = 1;",
    );
  });

  it("returns an empty preview for whitespace-only text", () => {
    expect(agentThoughtPreview(" \n\t ")).toBe("");
  });

  it("bounds long previews without splitting surrogate pairs", () => {
    const preview = agentThoughtPreview("🧠".repeat(5_000));
    expect(Array.from(preview)).toHaveLength(MAX_AGENT_THOUGHT_PREVIEW_CHARS + 1);
    expect(preview.endsWith("…")).toBe(true);
    expect(preview).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  it("drops a surrogate pair split by the source cut", () => {
    const text = `${"a".repeat(MAX_AGENT_THOUGHT_PREVIEW_SOURCE_CHARS - 1)}🧠`;
    expect(agentThoughtPreview(text)).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/u);
  });

  it("keeps comparison operators that are not tags", () => {
    expect(agentThoughtPreview("if a < 3 and b > 2 then <br> done")).toBe(
      "if a < 3 and b > 2 then done",
    );
  });
});

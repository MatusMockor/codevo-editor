import { describe, expect, it } from "vitest";
import { committableBlockCount, stabilizeStreamingMarkdownTail } from "./agentMarkdownStreaming";

describe("committableBlockCount", () => {
  it("never commits the last non-blank block because more text may extend it", () => {
    expect(committableBlockCount([{ type: "paragraph", raw: "hello" }])).toBe(0);
    expect(
      committableBlockCount([
        { type: "paragraph", raw: "hello" },
        { type: "space", raw: "\n\n" },
      ]),
    ).toBe(0);
  });

  it("commits every block before the last non-blank block, including blank runs", () => {
    expect(
      committableBlockCount([
        { type: "paragraph", raw: "a" },
        { type: "space", raw: "\n\n" },
        { type: "list", raw: "- x\n\n- y" },
        { type: "space", raw: "\n\n" },
        { type: "code", raw: "```js\nlet a\n" },
      ]),
    ).toBe(4);
  });

  it("keeps an unfinished list open when nothing follows it", () => {
    expect(
      committableBlockCount([
        { type: "paragraph", raw: "a" },
        { type: "space", raw: "\n\n" },
        { type: "list", raw: "- x" },
        { type: "space", raw: "\n\n" },
      ]),
    ).toBe(2);
  });

  it("returns zero for no tokens", () => {
    expect(committableBlockCount([])).toBe(0);
  });
});

describe("stabilizeStreamingMarkdownTail", () => {
  it("promotes a lone pipe header row to a table while the delimiter is still streaming", () => {
    expect(stabilizeStreamingMarkdownTail("| kontrola | výsledok |")).toBe(
      "| kontrola | výsledok |\n| --- | --- |",
    );
  });

  it("replaces a half-written delimiter row instead of stacking a second one", () => {
    expect(stabilizeStreamingMarkdownTail("| a | b |\n|--")).toBe("| a | b |\n| --- | --- |");
    expect(stabilizeStreamingMarkdownTail("| a | b |\n| --- |")).toBe("| a | b |\n| --- | --- |");
    expect(stabilizeStreamingMarkdownTail("| a | b |\n| --- | :")).toBe("| a | b |\n| --- | --- |");
  });

  it("keeps body rows that already arrived", () => {
    expect(stabilizeStreamingMarkdownTail("| a | b |\n| 1 | 2 |\n| 3 |")).toBe(
      "| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 |",
    );
  });

  it("preserves trailing whitespace so committed offsets stay exact", () => {
    expect(stabilizeStreamingMarkdownTail("| a | b |\n\n")).toBe("| a | b |\n| --- | --- |\n\n");
  });

  it("never promotes a single-column pipe run, so prose starting with a pipe stays prose", () => {
    expect(stabilizeStreamingMarkdownTail("Use the syntax:\n| means or")).toBe(
      "Use the syntax:\n| means or",
    );
    expect(stabilizeStreamingMarkdownTail("| kontrola")).toBe("| kontrola");
  });

  it("leaves a complete table alone, including a minimal delimiter row", () => {
    const table = "| a | b |\n| --- | --- |\n| 1 | 2 |";
    expect(stabilizeStreamingMarkdownTail(table)).toBe(table);
    expect(stabilizeStreamingMarkdownTail("| a | b |\n| --- | -")).toBe("| a | b |\n| --- | -");
  });

  it("promotes a trailing pipe run that continues a prose line without a blank line", () => {
    expect(stabilizeStreamingMarkdownTail("Výsledky:\n| kontrola | výsledok |")).toBe(
      "Výsledky:\n| kontrola | výsledok |\n| --- | --- |",
    );
    expect(stabilizeStreamingMarkdownTail("Intro\nmore\n| a | b |\n| 1 | 2 |")).toBe(
      "Intro\nmore\n| a | b |\n| --- | --- |\n| 1 | 2 |",
    );
  });

  it("leaves prose, lists and empty tails alone", () => {
    for (const tail of ["", "\n\n", "plain text", "- item | with pipe", "a | b"]) {
      expect(stabilizeStreamingMarkdownTail(tail)).toBe(tail);
    }
  });

  it("ignores a header row without any cell content", () => {
    expect(stabilizeStreamingMarkdownTail("|")).toBe("|");
    expect(stabilizeStreamingMarkdownTail("| |")).toBe("| |");
  });
});

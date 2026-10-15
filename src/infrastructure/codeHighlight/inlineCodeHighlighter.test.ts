import { describe, expect, it } from "vitest";
import type {
  CodeHighlightOutcome,
  CodeHighlightRequest,
} from "../../application/codeHighlight/codeHighlighter";
import type { CodeLanguageId } from "../../domain/codeHighlight/codeLanguage";
import {
  MAX_HIGHLIGHT_CHARS,
  MAX_TOKENIZED_LINE_CHARS,
  type HighlightedLines,
} from "../../domain/codeHighlight/highlightedCode";
import { createInlineCodeHighlighter } from "./inlineCodeHighlighter";

const highlighter = createInlineCodeHighlighter();

function request(language: CodeLanguageId, text: string): CodeHighlightRequest {
  return { language, text, theme: "dark-plus" };
}

function highlightedLines(outcome: CodeHighlightOutcome): HighlightedLines {
  if (outcome.kind !== "highlighted")
    throw new Error(`expected highlighted, got ${outcome.reason}`);
  return outcome.lines;
}

function distinctColors(lines: HighlightedLines): Set<string> {
  return new Set(lines.flat().flatMap((token) => (token.color === null ? [] : [token.color])));
}

const SAMPLES: ReadonlyArray<readonly [CodeLanguageId, string]> = [
  ["json", '{\n  "name": "codevo",\n  "count": 3\n}'],
  ["php", '<?php\nfunction greet(string $name): string {\n  return "hi $name";\n}'],
  ["html", '<div class="a">\n  <span>text</span>\n</div>'],
  ["css", ".a {\n  color: red;\n  margin: 0 auto;\n}"],
  ["typescript", "export const value: number = 42;\nfunction f(a: string) { return a; }"],
  ["tsx", 'export function A() {\n  return <div className="x">{1}</div>;\n}'],
  ["python", 'def greet(name):\n    return f"hi {name}"\n'],
  ["rust", "fn main() {\n    let x: u32 = 1;\n}"],
  ["go", 'package main\nfunc main() { fmt.Println("x") }'],
  ["shellscript", '#!/bin/sh\necho "$HOME" && exit 1'],
  ["dockerfile", "FROM node:20\nRUN npm ci"],
  ["toml", '[package]\nname = "x"\nversion = 1'],
];

describe("createInlineCodeHighlighter", () => {
  it.each(SAMPLES)("colors %s with real Shiki and preserves the text", async (language, text) => {
    const lines = highlightedLines(await highlighter.highlight(request(language, text)));
    expect(lines.map((line) => line.map((token) => token.text).join(""))).toEqual(text.split("\n"));
    expect(distinctColors(lines).size).toBeGreaterThan(1);
  });

  it("reports plaintext as unsupported without tokenizing", async () => {
    await expect(highlighter.highlight(request("plaintext", "hello"))).resolves.toEqual({
      kind: "plain",
      reason: "unsupported-language",
    });
  });

  it("refuses input above the size budget", async () => {
    const text = "a".repeat(MAX_HIGHLIGHT_CHARS + 1);
    await expect(highlighter.highlight(request("typescript", text))).resolves.toEqual({
      kind: "plain",
      reason: "too-large",
    });
  });

  it("returns lines longer than the tokenize limit as one plain token", async () => {
    const long = `const x = "${"y".repeat(MAX_TOKENIZED_LINE_CHARS)}";`;
    const lines = highlightedLines(
      await highlighter.highlight(request("typescript", `let a = 1;\n${long}`)),
    );
    expect(lines[1]).toEqual([{ text: long, color: null, italic: false, bold: false }]);
    expect(lines[0]?.length).toBeGreaterThan(1);
  });

  it("keeps CRLF content aligned with the source lines", async () => {
    const lines = highlightedLines(
      await highlighter.highlight(request("json", '{\r\n  "a": 1\r\n}')),
    );
    expect(lines.map((line) => line.map((token) => token.text).join(""))).toEqual([
      "{",
      '  "a": 1',
      "}",
    ]);
  });

  it("reports an unknown theme as unavailable", async () => {
    const outcome = await highlighter.highlight({
      language: "json",
      text: "{}",
      theme: "cv-missing-dark" as CodeHighlightRequest["theme"],
    });
    expect(outcome).toEqual({ kind: "plain", reason: "unavailable" });
  });

  it("rejects an already aborted request", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      highlighter.highlight(request("json", "{}"), controller.signal),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

import type * as Monaco from "monaco-editor";
import { describe, expect, it } from "vitest";
import {
  flattenSelectionRange,
  toLanguageServerFormattingOptions,
  toLanguageServerRange,
  toMonacoDocumentHighlight,
  toMonacoDocumentSymbol,
  toMonacoFoldingRange,
  toMonacoLinkedEditingRanges,
  toMonacoRange,
  toMonacoSemanticTokens,
  toMonacoTextEdit,
} from "./languageServerMonacoMappings";

class FakeRange {
  constructor(
    readonly startLineNumber: number,
    readonly startColumn: number,
    readonly endLineNumber: number,
    readonly endColumn: number,
  ) {}
}

const monaco = {
  Range: FakeRange,
  languages: {
    DocumentHighlightKind: { Read: 2, Text: 1, Write: 3 },
    FoldingRangeKind: { fromValue: (value: string) => `fold:${value}` },
    SymbolKind: new Proxy(
      { Class: 5, Method: 6, Variable: 13 },
      { get: (target, key: string) => target[key as keyof typeof target] ?? 13 },
    ),
    SymbolTag: { Deprecated: 1 },
  },
} as unknown as typeof Monaco;

const lspRange = {
  start: { line: 2, character: 4 },
  end: { line: 5, character: 8 },
};

describe("language-server Monaco mappings", () => {
  it("converts ranges in both directions without leaking zero-based coordinates", () => {
    const mapped = toMonacoRange(monaco, lspRange);
    expect(mapped).toEqual(new FakeRange(3, 5, 6, 9));
    expect(toLanguageServerRange(mapped)).toEqual(lspRange);

    expect(toLanguageServerRange(new FakeRange(0, 0, 0, 0) as Monaco.Range)).toEqual({
      start: { line: 0, character: 0 },
      end: { line: 0, character: 0 },
    });
  });

  it("maps text edits, formatting options, highlights and folding ranges", () => {
    expect(toMonacoTextEdit(monaco, { newText: "next", range: lspRange })).toEqual({
      range: new FakeRange(3, 5, 6, 9),
      text: "next",
    });
    expect(toLanguageServerFormattingOptions({ insertSpaces: true, tabSize: 2 })).toEqual({
      insertSpaces: true,
      tabSize: 2,
    });
    expect(toMonacoDocumentHighlight(monaco, { kind: 3, range: lspRange })).toEqual({
      kind: 3,
      range: new FakeRange(3, 5, 6, 9),
    });
    expect(
      toMonacoFoldingRange(monaco, {
        startLine: 1,
        startCharacter: null,
        endLine: 4,
        endCharacter: null,
        kind: "region",
      }),
    ).toEqual({
      start: 2,
      end: 5,
      kind: "fold:region",
    });
  });

  it("recursively maps document symbols, deprecated tags and unknown kinds", () => {
    const symbol = toMonacoDocumentSymbol(monaco, {
      children: [
        {
          children: [],
          containerName: null,
          detail: null,
          kind: 999,
          name: "value",
          range: lspRange,
          selectionRange: lspRange,
        },
      ],
      containerName: "App",
      detail: "class App",
      kind: 5,
      name: "App",
      range: lspRange,
      selectionRange: lspRange,
      tags: [1],
    });

    expect(symbol.kind).toBe(5);
    expect(symbol.tags).toEqual([1]);
    expect(symbol.children?.[0]).toMatchObject({ detail: "", kind: 13, name: "value" });
  });

  it("maps semantic tokens without sharing mutable data", () => {
    const data = [0, 1, 2, 3, 4];
    const mapped = toMonacoSemanticTokens({ data, resultId: "tokens-1" });
    expect(mapped).toEqual({ data: Uint32Array.from(data), resultId: "tokens-1" });
    expect(mapped?.data).not.toBe(data);
    expect(toMonacoSemanticTokens({ data: [], resultId: null })).toBeNull();
    expect(toMonacoSemanticTokens(null)).toBeNull();
  });

  it("maps linked-editing and parent selection ranges defensively", () => {
    expect(
      toMonacoLinkedEditingRanges(monaco, {
        ranges: [lspRange],
        wordPattern: "[A-Za-z]+",
      }),
    ).toEqual({ ranges: [new FakeRange(3, 5, 6, 9)], wordPattern: /[A-Za-z]+/ });
    expect(toMonacoLinkedEditingRanges(monaco, { ranges: [lspRange], wordPattern: "[" })).toEqual({
      ranges: [new FakeRange(3, 5, 6, 9)],
      wordPattern: undefined,
    });
    expect(toMonacoLinkedEditingRanges(monaco, { ranges: [], wordPattern: null })).toBeNull();

    expect(
      flattenSelectionRange(monaco, {
        range: lspRange,
        parent: {
          range: { start: { line: 0, character: 0 }, end: lspRange.end },
          parent: null,
        },
      }),
    ).toEqual([{ range: new FakeRange(3, 5, 6, 9) }, { range: new FakeRange(1, 1, 6, 9) }]);
  });
});

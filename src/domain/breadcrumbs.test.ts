import { describe, expect, it } from "vitest";
import {
  breadcrumbPathFromCursorAndSymbols,
  symbolContainsCursorPosition,
} from "./breadcrumbs";
import type {
  EditorPosition,
  LanguageServerDocumentSymbol,
} from "./languageServerFeatures";

function symbol(
  overrides: Partial<LanguageServerDocumentSymbol> & {
    name: string;
    startLine: number;
    startCharacter: number;
    endLine: number;
    endCharacter: number;
  },
): LanguageServerDocumentSymbol {
  const {
    name,
    startLine,
    startCharacter,
    endLine,
    endCharacter,
    children,
    ...rest
  } = overrides;

  const range = {
    start: { line: startLine, character: startCharacter },
    end: { line: endLine, character: endCharacter },
  };

  return {
    children: children ?? [],
    containerName: null,
    detail: null,
    kind: 12,
    name,
    range,
    selectionRange: range,
    ...rest,
  };
}

function cursor(lineNumber: number, column: number): EditorPosition {
  return { lineNumber, column };
}

describe("symbolContainsCursorPosition", () => {
  it("returns true when the 1-based cursor sits inside the 0-based symbol range", () => {
    const target = symbol({
      name: "value",
      startLine: 4,
      startCharacter: 2,
      endLine: 8,
      endCharacter: 0,
    });

    // LSP lines 4..8 -> Monaco lines 5..9.
    expect(symbolContainsCursorPosition(target, cursor(5, 3))).toBe(true);
    expect(symbolContainsCursorPosition(target, cursor(9, 1))).toBe(true);
  });

  it("returns false when the cursor is before the symbol on the start line", () => {
    const target = symbol({
      name: "value",
      startLine: 4,
      startCharacter: 6,
      endLine: 4,
      endCharacter: 20,
    });

    // Start line 4 (LSP) -> Monaco line 5, start column 6 (0-based) -> column 7 (1-based).
    expect(symbolContainsCursorPosition(target, cursor(5, 5))).toBe(false);
    expect(symbolContainsCursorPosition(target, cursor(5, 7))).toBe(true);
  });

  it("returns false when the cursor is past the symbol end", () => {
    const target = symbol({
      name: "value",
      startLine: 4,
      startCharacter: 0,
      endLine: 6,
      endCharacter: 10,
    });

    expect(symbolContainsCursorPosition(target, cursor(8, 1))).toBe(false);
  });
});

describe("breadcrumbPathFromCursorAndSymbols", () => {
  it("returns an empty path when the cursor is outside every symbol", () => {
    const symbols = [
      symbol({
        name: "MyComponent",
        startLine: 2,
        startCharacter: 0,
        endLine: 10,
        endCharacter: 1,
      }),
    ];

    expect(breadcrumbPathFromCursorAndSymbols(cursor(1, 1), symbols)).toEqual(
      [],
    );
  });

  it("returns a single segment for a top-level symbol", () => {
    const target = symbol({
      name: "MyComponent",
      startLine: 2,
      startCharacter: 0,
      endLine: 10,
      endCharacter: 1,
    });

    const path = breadcrumbPathFromCursorAndSymbols(cursor(5, 1), [target]);

    expect(path).toHaveLength(1);
    expect(path[0]).toBe(target);
  });

  it("returns nested segments for a class member", () => {
    const method = symbol({
      name: "render",
      startLine: 4,
      startCharacter: 2,
      endLine: 8,
      endCharacter: 3,
    });
    const klass = symbol({
      name: "MyComponent",
      startLine: 2,
      startCharacter: 0,
      endLine: 10,
      endCharacter: 1,
      children: [method],
    });

    const path = breadcrumbPathFromCursorAndSymbols(cursor(6, 4), [klass]);

    expect(path.map((entry) => entry.name)).toEqual([
      "MyComponent",
      "render",
    ]);
  });

  it("picks the sibling that actually contains the cursor", () => {
    const first = symbol({
      name: "first",
      startLine: 0,
      startCharacter: 0,
      endLine: 3,
      endCharacter: 1,
    });
    const second = symbol({
      name: "second",
      startLine: 5,
      startCharacter: 0,
      endLine: 9,
      endCharacter: 1,
    });

    const path = breadcrumbPathFromCursorAndSymbols(cursor(7, 1), [
      first,
      second,
    ]);

    expect(path.map((entry) => entry.name)).toEqual(["second"]);
  });

  it("stops at the deepest containing child", () => {
    const inner = symbol({
      name: "inner",
      startLine: 5,
      startCharacter: 4,
      endLine: 6,
      endCharacter: 5,
    });
    const method = symbol({
      name: "render",
      startLine: 4,
      startCharacter: 2,
      endLine: 8,
      endCharacter: 3,
      children: [inner],
    });
    const klass = symbol({
      name: "MyComponent",
      startLine: 2,
      startCharacter: 0,
      endLine: 10,
      endCharacter: 1,
      children: [method],
    });

    // Monaco line 8 -> LSP line 7: inside render (4..8) but past inner (5..6).
    const path = breadcrumbPathFromCursorAndSymbols(cursor(8, 1), [klass]);

    // Cursor sits in render but not in inner.
    expect(path.map((entry) => entry.name)).toEqual([
      "MyComponent",
      "render",
    ]);
  });
});

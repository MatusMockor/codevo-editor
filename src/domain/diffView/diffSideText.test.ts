import { describe, expect, it } from "vitest";
import { groupDiffHunks, splitDiffRows } from "./diffHunks";
import { diffHunkSideTexts } from "./diffSideText";
import { computeLineDiff, type DiffLine } from "./lineDiff";

function ready(original: string, modified: string): ReadonlyArray<DiffLine> {
  const result = computeLineDiff(original, modified, { ignoreWhitespace: false });
  return result.kind === "ready" ? result.lines : [];
}

describe("diffHunkSideTexts", () => {
  it("rebuilds contiguous old and new sides of one hunk and maps every row back", () => {
    const [hunk] = groupDiffHunks(ready("a\nb\nc\n", "a\nB\nX\nc\n"));
    if (hunk === undefined) throw new Error("expected a hunk");
    const texts = diffHunkSideTexts(hunk);

    expect(texts.oldText).toBe("a\nb\nc");
    expect(texts.newText).toBe("a\nB\nX\nc");
    expect(texts.sides).toEqual([
      { oldIndex: 0, newIndex: 0 },
      { oldIndex: 1, newIndex: null },
      { oldIndex: null, newIndex: 1 },
      { oldIndex: null, newIndex: 2 },
      { oldIndex: 2, newIndex: 3 },
    ]);
  });

  it("keeps every hunk independent so no text crosses a gap", () => {
    const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const modified = original.map((line, index) =>
      index === 1 || index === 17 ? `${line}!` : line,
    );
    const hunks = groupDiffHunks(ready(original.join("\n"), modified.join("\n")));
    expect(hunks).toHaveLength(2);
    const second = hunks[1];
    if (second === undefined) throw new Error("expected a second hunk");
    const texts = diffHunkSideTexts(second);

    expect(texts.newText.split("\n")[0]).toBe(second.lines[0]?.text);
    expect(texts.newText).not.toContain("line 2!");
    second.lines.forEach((line, index) => {
      const sides = texts.sides[index];
      if (line.kind !== "del")
        expect(texts.newText.split("\n")[sides?.newIndex ?? -1]).toBe(line.text);
    });
  });

  it("gives split cells the hunk line index", () => {
    const [hunk] = groupDiffHunks(ready("a\nb\n", "a\nc\n"));
    const rows = hunk === undefined ? [] : splitDiffRows(hunk);
    expect(rows.map((row) => [row.left?.index ?? null, row.right?.index ?? null])).toEqual([
      [0, 0],
      [1, 2],
    ]);
  });
});

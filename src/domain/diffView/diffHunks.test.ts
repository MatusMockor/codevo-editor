import { describe, expect, it } from "vitest";
import { groupDiffHunks, limitDiffHunks, splitDiffRows, type DiffHunk } from "./diffHunks";
import { computeLineDiff, type DiffLine } from "./lineDiff";

function ready(original: string, modified: string): ReadonlyArray<DiffLine> {
  const result = computeLineDiff(original, modified, { ignoreWhitespace: false });
  return result.kind === "ready" ? result.lines : [];
}

const numbered = (count: number, change: number | null = null): string =>
  Array.from({ length: count }, (_, index) =>
    index + 1 === change ? "changed" : `line ${index + 1}`,
  ).join("\n");

describe("groupDiffHunks", () => {
  it("keeps three lines of context and writes a git-style header", () => {
    const hunks = groupDiffHunks(ready(numbered(20), numbered(20, 10)));
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.header).toBe("@@ -7,7 +7,7 @@");
    expect(hunks[0]?.lines).toHaveLength(8);
  });

  it("merges changes whose context overlaps and splits distant ones", () => {
    const near = groupDiffHunks(ready(numbered(30), numbered(30, 10).replace("line 14", "x")));
    const far = groupDiffHunks(ready(numbered(40), numbered(40, 5).replace("line 30", "x")));
    expect(near).toHaveLength(1);
    expect(far).toHaveLength(2);
  });

  it("uses the preceding line number for an empty old side", () => {
    const hunks = groupDiffHunks(ready("", "a\nb\n"));
    expect(hunks[0]?.header).toBe("@@ -0,0 +1,2 @@");
  });

  it("returns no hunks for identical input", () => {
    expect(groupDiffHunks(ready("a\n", "a\n"))).toEqual([]);
  });
});

describe("limitDiffHunks", () => {
  it("cuts rendered lines at the limit and reports the hidden count", () => {
    const hunks = groupDiffHunks(
      ready("", Array.from({ length: 50 }, (_, i) => `n${i}`).join("\n")),
    );
    const limited = limitDiffHunks(hunks, 20);
    expect(limited.hunks.reduce((total, hunk) => total + hunk.lines.length, 0)).toBe(20);
    expect(limited.hiddenChangedLines).toBe(30);
  });

  it("counts only changed lines as hidden, not context", () => {
    const hunks = groupDiffHunks(ready(numbered(40), numbered(40, 5).replace("line 30", "x")));
    const limited = limitDiffHunks(hunks, 1);
    const hidden = hunks
      .flatMap((hunk) => hunk.lines)
      .slice(1)
      .filter((line) => line.kind !== "context").length;
    expect(hidden).toBe(4);
    expect(limited.hiddenChangedLines).toBe(hidden);
  });
});

describe("splitDiffRows", () => {
  it("pairs deletions with insertions and pads the shorter side", () => {
    const [hunk] = groupDiffHunks(ready("a\nb\nc\nd\n", "a\nB\nC\nX\nd\n"));
    const rows = hunk === undefined ? [] : splitDiffRows(hunk);
    expect(
      rows.map((row) => [
        row.left?.kind ?? null,
        row.left?.text ?? null,
        row.right?.kind ?? null,
        row.right?.text ?? null,
      ]),
    ).toEqual([
      ["context", "a", "context", "a"],
      ["del", "b", "add", "B"],
      ["del", "c", "add", "C"],
      [null, null, "add", "X"],
      ["context", "d", "context", "d"],
    ]);
  });

  it("keeps Myers deletion-then-insertion order across multiple hunks", () => {
    const original = Array.from({ length: 20 }, (_, index) => `line ${index + 1}`);
    const modified = [
      ...original.slice(0, 2),
      "three",
      "four",
      "four b",
      ...original.slice(4, 14),
      "fifteen",
      ...original.slice(17),
    ];
    const hunks = groupDiffHunks(ready(original.join("\n"), modified.join("\n")));
    const describeRows = (hunk: DiffHunk) =>
      splitDiffRows(hunk).map((row) => [
        row.left?.kind ?? null,
        row.left?.line ?? null,
        row.left?.text ?? null,
        row.right?.kind ?? null,
        row.right?.line ?? null,
        row.right?.text ?? null,
      ]);

    expect(hunks.map((hunk) => hunk.header)).toEqual(["@@ -1,7 +1,8 @@", "@@ -12,9 +13,7 @@"]);
    expect(
      hunks.map((hunk) =>
        hunk.lines
          .map((line) => (line.kind === "context" ? " " : line.kind === "add" ? "+" : "-"))
          .join(""),
      ),
    ).toEqual(["  --+++   ", "   ---+   "]);
    const [first, second] = hunks;
    expect(first === undefined ? [] : describeRows(first)).toEqual([
      ["context", 1, "line 1", "context", 1, "line 1"],
      ["context", 2, "line 2", "context", 2, "line 2"],
      ["del", 3, "line 3", "add", 3, "three"],
      ["del", 4, "line 4", "add", 4, "four"],
      [null, null, null, "add", 5, "four b"],
      ["context", 5, "line 5", "context", 6, "line 5"],
      ["context", 6, "line 6", "context", 7, "line 6"],
      ["context", 7, "line 7", "context", 8, "line 7"],
    ]);
    expect(second === undefined ? [] : describeRows(second)).toEqual([
      ["context", 12, "line 12", "context", 13, "line 12"],
      ["context", 13, "line 13", "context", 14, "line 13"],
      ["context", 14, "line 14", "context", 15, "line 14"],
      ["del", 15, "line 15", "add", 16, "fifteen"],
      ["del", 16, "line 16", null, null, null],
      ["del", 17, "line 17", null, null, null],
      ["context", 18, "line 18", "context", 17, "line 18"],
      ["context", 19, "line 19", "context", 18, "line 19"],
      ["context", 20, "line 20", "context", 19, "line 20"],
    ]);
  });
});

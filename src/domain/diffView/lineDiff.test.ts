import { describe, expect, it } from "vitest";
import {
  MAX_DIFF_VIEW_LINES_PER_SIDE,
  computeLineDiff,
  splitDiffText,
  type DiffLine,
} from "./lineDiff";

function kinds(lines: ReadonlyArray<DiffLine>): string {
  return lines
    .map((line) => (line.kind === "context" ? " " : line.kind === "add" ? "+" : "-"))
    .join("");
}

describe("splitDiffText", () => {
  it("normalizes CRLF and drops the final newline terminator", () => {
    expect(splitDiffText("a\r\nb\n")).toEqual(["a", "b"]);
    expect(splitDiffText("")).toEqual([]);
    expect(splitDiffText("a\n\n")).toEqual(["a", ""]);
  });
});

describe("computeLineDiff", () => {
  it("returns only context for identical text", () => {
    const result = computeLineDiff("a\nb\n", "a\nb\n", { ignoreWhitespace: false });
    expect(result).toEqual({
      kind: "ready",
      added: 0,
      deleted: 0,
      lines: [
        { kind: "context", oldLine: 1, newLine: 1, text: "a" },
        { kind: "context", oldLine: 2, newLine: 2, text: "b" },
      ],
    });
  });

  it("emits a deletion followed by an insertion for a changed line", () => {
    const result = computeLineDiff("a\nb\nc\n", "a\nB\nc\n", { ignoreWhitespace: false });
    expect(result.kind).toBe("ready");
    if (result.kind !== "ready") return;
    expect(kinds(result.lines)).toBe(" -+ ");
    expect(result.lines[1]).toEqual({ kind: "del", oldLine: 2, newLine: null, text: "b" });
    expect(result.lines[2]).toEqual({ kind: "add", oldLine: null, newLine: 2, text: "B" });
    expect([result.added, result.deleted]).toEqual([1, 1]);
  });

  it("numbers lines on both sides across insertions in the middle", () => {
    const result = computeLineDiff("1\n2\n3\n4\n", "1\n2\nx\ny\n3\n4\n", {
      ignoreWhitespace: false,
    });
    if (result.kind !== "ready") {
      expect(result.kind).toBe("ready");
      return;
    }
    expect(result.lines.map((line) => [line.oldLine, line.newLine])).toEqual([
      [1, 1],
      [2, 2],
      [null, 3],
      [null, 4],
      [3, 5],
      [4, 6],
    ]);
  });

  it("handles files that were created or deleted", () => {
    const created = computeLineDiff("", "a\nb\n", { ignoreWhitespace: false });
    const deleted = computeLineDiff("a\n", "", { ignoreWhitespace: false });
    expect(created.kind === "ready" && kinds(created.lines)).toBe("++");
    expect(deleted.kind === "ready" && kinds(deleted.lines)).toBe("-");
  });

  it("treats whitespace-only changes as context when ignoring whitespace", () => {
    const strict = computeLineDiff("if (a) {\n  b();\n}\n", "if (a) {\n    b();\n}\n", {
      ignoreWhitespace: false,
    });
    const relaxed = computeLineDiff("if (a) {\n  b();\n}\n", "if (a) {\n    b();\n}\n", {
      ignoreWhitespace: true,
    });
    expect(strict.kind === "ready" && strict.added).toBe(1);
    expect(relaxed.kind === "ready" && kinds(relaxed.lines)).toBe("   ");
    expect(relaxed.kind === "ready" && relaxed.lines[1]?.text).toBe("    b();");
  });

  it("refuses inputs above the line bound", () => {
    const large = "x\n".repeat(MAX_DIFF_VIEW_LINES_PER_SIDE + 1);
    expect(computeLineDiff(large, "", { ignoreWhitespace: false })).toEqual({
      kind: "tooLarge",
      reason: "lines",
    });
  });

  it("refuses edits above the edit-distance bound instead of freezing", () => {
    const left = Array.from({ length: 1_000 }, (_, index) => `left ${index}`).join("\n");
    const right = Array.from({ length: 1_000 }, (_, index) => `right ${index}`).join("\n");
    expect(computeLineDiff(left, right, { ignoreWhitespace: false })).toEqual({
      kind: "tooLarge",
      reason: "editDistance",
    });
  });

  it("keeps very long lines intact", () => {
    const longLine = "y".repeat(5_000);
    const result = computeLineDiff("a\n", `a\n${longLine}\n`, { ignoreWhitespace: false });
    expect(result.kind === "ready" && result.lines[1]?.text.length).toBe(5_000);
  });
});

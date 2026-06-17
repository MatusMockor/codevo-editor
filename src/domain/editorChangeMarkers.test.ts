import { describe, expect, it } from "vitest";
import {
  applyEditorChangeRevert,
  editorChangeHunks,
} from "./editorChangeMarkers";

describe("editorChangeHunks", () => {
  it("detects added lines", () => {
    const hunks = editorChangeHunks("one\ntwo", "one\ninserted\ntwo");

    expect(hunks).toEqual([
      expect.objectContaining({
        currentLines: ["inserted"],
        endLineNumber: 2,
        kind: "added",
        originalLines: [],
        startLineNumber: 2,
      }),
    ]);
  });

  it("detects modified lines", () => {
    const hunks = editorChangeHunks("one\ntwo\nthree", "one\nchanged\nthree");

    expect(hunks).toEqual([
      expect.objectContaining({
        currentLines: ["changed"],
        endLineNumber: 2,
        kind: "modified",
        originalLines: ["two"],
        originalStartLineNumber: 2,
        startLineNumber: 2,
      }),
    ]);
  });

  it("detects deleted lines", () => {
    const hunks = editorChangeHunks("one\ndeleted\nthree", "one\nthree");

    expect(hunks).toEqual([
      expect.objectContaining({
        currentLines: [],
        endLineNumber: 2,
        kind: "deleted",
        originalLines: ["deleted"],
        originalStartLineNumber: 2,
        startLineNumber: 2,
      }),
    ]);
  });

  it("keeps consecutive edits together", () => {
    const hunks = editorChangeHunks(
      "one\ntwo\nthree\nfour",
      "one\nchanged\nadded\nfour",
    );

    expect(hunks).toHaveLength(1);
    expect(hunks[0]).toEqual(
      expect.objectContaining({
        currentLines: ["changed", "added"],
        kind: "modified",
        originalLines: ["two", "three"],
        startLineNumber: 2,
      }),
    );
  });
});

describe("applyEditorChangeRevert", () => {
  it("reverts a modified hunk", () => {
    const current = "one\nchanged\nthree";
    const [hunk] = editorChangeHunks("one\ntwo\nthree", current);

    expect(applyEditorChangeRevert(current, hunk)).toBe("one\ntwo\nthree");
  });

  it("reverts an added hunk", () => {
    const current = "one\ninserted\ntwo";
    const [hunk] = editorChangeHunks("one\ntwo", current);

    expect(applyEditorChangeRevert(current, hunk)).toBe("one\ntwo");
  });

  it("reverts a deleted hunk", () => {
    const current = "one\nthree";
    const [hunk] = editorChangeHunks("one\ndeleted\nthree", current);

    expect(applyEditorChangeRevert(current, hunk)).toBe("one\ndeleted\nthree");
  });
});

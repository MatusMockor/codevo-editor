import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyEditorChangeRevert,
  editorChangeHunks,
} from "./editorChangeMarkers";

describe("editorChangeHunks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not re-split the unchanged baseline on repeated edits", () => {
    const baseline = ["alpha", "beta", "gamma", "delta", "epsilon"].join("\n");
    // Prime the baseline cache so its split is counted only on the first call,
    // then measure subsequent keystrokes against the same baseline string.
    editorChangeHunks(baseline, baseline + "\nfirst");

    const splitSpy = vi.spyOn(String.prototype, "split");
    const newlineSplitCount = () =>
      splitSpy.mock.calls.filter(
        ([separator]) => (separator as unknown) === "\n",
      ).length;

    // Each subsequent keystroke must split only the current content (1 split),
    // never the unchanged baseline again.
    editorChangeHunks(baseline, baseline + "\nsecond");
    expect(newlineSplitCount()).toBe(1);

    editorChangeHunks(baseline, baseline + "\nthird");
    expect(newlineSplitCount()).toBe(2);
  });

  it("produces identical hunks whether or not the baseline was cached", () => {
    const baseline = "one\ntwo\nthree\nfour";
    const current = "one\nchanged\nthree\nfour";

    const first = editorChangeHunks(baseline, current);
    const second = editorChangeHunks(baseline, current);

    expect(second).toEqual(first);
  });

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

  it("detects a new file as added instead of modified", () => {
    const hunks = editorChangeHunks("", "first\nsecond");

    expect(hunks).toEqual([
      expect.objectContaining({
        currentLines: ["first", "second"],
        endLineNumber: 2,
        kind: "added",
        originalLines: [],
        originalStartLineNumber: 1,
        startLineNumber: 1,
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

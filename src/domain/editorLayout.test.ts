import { describe, expect, it } from "vitest";
import {
  clampEditorSplitSizes,
  editorGroupIdsInLayout,
  editorGroupLayout,
  normalizeEditorLayout,
  removeEditorGroupFromLayout,
  splitEditorLayout,
  updateEditorSplitSizes,
  type EditorLayout,
} from "./editorLayout";

describe("editorLayout", () => {
  it("splits a target to the right or down with normalized sizes", () => {
    const right = splitEditorLayout(editorGroupLayout("one"), "one", "two", "right", [3, 1]);
    expect(right).toEqual({
      kind: "split",
      orientation: "horizontal",
      sizes: [0.75, 0.25],
      children: [editorGroupLayout("one"), editorGroupLayout("two")],
    });
    expect(splitEditorLayout(right!, "two", "three", "down")).toMatchObject({
      children: [
        editorGroupLayout("one"),
        { kind: "split", orientation: "vertical" },
      ],
    });
  });

  it("rejects missing targets and duplicate identifiers", () => {
    const layout = editorGroupLayout("one");
    expect(splitEditorLayout(layout, "missing", "two", "right")).toBeNull();
    expect(splitEditorLayout(layout, "one", "one", "right")).toBeNull();
    const split = splitEditorLayout(layout, "one", "two", "right")!;
    expect(splitEditorLayout(split, "one", "two", "down")).toBeNull();
  });

  it("collapses nested splits when groups are removed", () => {
    const nested = splitEditorLayout(
      splitEditorLayout(editorGroupLayout("one"), "one", "two", "right")!,
      "two",
      "three",
      "down",
    )!;
    expect(removeEditorGroupFromLayout(nested, "two")).toEqual({
      kind: "split",
      orientation: "horizontal",
      sizes: [0.5, 0.5],
      children: [editorGroupLayout("one"), editorGroupLayout("three")],
    });
  });

  it("clamps panes to a minimum and updates a nested splitter", () => {
    expect(clampEditorSplitSizes([99, 1])).toEqual([0.9, 0.09999999999999998]);
    expect(clampEditorSplitSizes([0, 0])).toEqual([0.5, 0.5]);
    expect(clampEditorSplitSizes([Number.MAX_VALUE, Number.MAX_VALUE])).toEqual([
      0.5,
      0.5,
    ]);
    const nested = splitEditorLayout(
      splitEditorLayout(editorGroupLayout("one"), "one", "two", "right")!,
      "two",
      "three",
      "down",
    )!;
    const resized = updateEditorSplitSizes(nested, [1], [1, 4]);
    expect((resized as Extract<EditorLayout, { kind: "split" }>).children[1]).toMatchObject({
      sizes: [0.2, 0.8],
    });
    expect(updateEditorSplitSizes(nested, [9], [1, 4])).toBe(nested);
  });

  it("repairs malformed layouts, removes unknown and duplicate leaves, and normalizes sizes", () => {
    const repaired = normalizeEditorLayout(
      {
        kind: "split",
        orientation: "nonsense",
        sizes: [-5, 20],
        children: [
          { kind: "group", groupId: "one" },
          {
            kind: "split",
            children: [
              { kind: "group", groupId: "missing" },
              { kind: "group", groupId: "one" },
            ],
          },
        ],
      },
      new Set(["one", "two"]),
      "two",
    );
    expect(repaired).toEqual(editorGroupLayout("one"));
    expect(editorGroupIdsInLayout(repaired)).toEqual(["one"]);
    expect(normalizeEditorLayout(null, new Set(["two"]), "two")).toEqual(editorGroupLayout("two"));
  });
});

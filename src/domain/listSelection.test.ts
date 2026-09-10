import { describe, expect, it } from "vitest";
import {
  EMPTY_LIST_SELECTION,
  applyListSelectionGesture,
  clearSelection,
  extendSelection,
  listSelectionCommit,
  listSelectionGesture,
  hasSelectionBeyond,
  listSelectionOwner,
  orderedSelectionIds,
  ownedListSelection,
  rebaseOwnedSelection,
  reconcileSelection,
  replaceSelection,
  sameListSelectionOwner,
  selectionCount,
  toggleSelection,
  type ListSelection,
} from "./listSelection";

const PINNED = ["p1", "p2"];
const ACTIVE = ["a1", "a2", "a3"];
const ARCHIVED = ["z1"];
const VISIBLE = [...PINNED, ...ACTIVE, ...ARCHIVED];

function ids(selection: ListSelection | null): ReadonlyArray<string> {
  expect(selection).not.toBeNull();
  return orderedSelectionIds(selection as ListSelection, VISIBLE);
}

describe("list selection transitions", () => {
  it("replaces the selection with a single row and anchors on it", () => {
    const selection = replaceSelection("a2", VISIBLE);

    expect(ids(selection)).toEqual(["a2"]);
    expect(selection?.anchorId).toBe("a2");
    expect(selection?.leadId).toBe("a2");
  });

  it("toggles a row in and back out while keeping it as the anchor", () => {
    const added = toggleSelection(EMPTY_LIST_SELECTION, "a1", VISIBLE);
    expect(ids(added)).toEqual(["a1"]);

    const both = toggleSelection(added as ListSelection, "a3", VISIBLE);
    expect(ids(both)).toEqual(["a1", "a3"]);
    expect(both?.anchorId).toBe("a3");

    const removed = toggleSelection(both as ListSelection, "a1", VISIBLE);
    expect(ids(removed)).toEqual(["a3"]);
    expect(removed?.anchorId).toBe("a1");
  });

  it("extends forward from the anchor across the visible order", () => {
    const anchored = replaceSelection("a1", VISIBLE) as ListSelection;

    expect(ids(extendSelection(anchored, "z1", VISIBLE))).toEqual(["a1", "a2", "a3", "z1"]);
  });

  it("extends backward from the anchor across the visible order", () => {
    const anchored = replaceSelection("a3", VISIBLE) as ListSelection;

    expect(ids(extendSelection(anchored, "a1", VISIBLE))).toEqual(["a1", "a2", "a3"]);
  });

  it("extends across the pinned, active and archived sections as one visual order", () => {
    const anchored = replaceSelection("p2", VISIBLE) as ListSelection;
    const extended = extendSelection(anchored, "a2", VISIBLE);

    expect(ids(extended)).toEqual(["p2", "a1", "a2"]);
    expect(extended?.anchorId).toBe("p2");
    expect(extended?.leadId).toBe("a2");
  });

  it("keeps the anchor so a second extension re-computes the whole range", () => {
    const anchored = replaceSelection("p1", VISIBLE) as ListSelection;
    const wide = extendSelection(anchored, "a3", VISIBLE) as ListSelection;
    const narrowed = extendSelection(wide, "p2", VISIBLE);

    expect(ids(narrowed)).toEqual(["p1", "p2"]);
  });

  it("falls back to a single-row selection when there is no anchor", () => {
    const extended = extendSelection(EMPTY_LIST_SELECTION, "a2", VISIBLE);

    expect(ids(extended)).toEqual(["a2"]);
    expect(extended?.anchorId).toBe("a2");
  });

  it("falls back to a single-row selection when the anchor row has disappeared", () => {
    const anchored = replaceSelection("z1", VISIBLE) as ListSelection;
    const shrunk = [...PINNED, ...ACTIVE];

    const extended = extendSelection(anchored, "a1", shrunk);
    expect(orderedSelectionIds(extended as ListSelection, shrunk)).toEqual(["a1"]);
    expect(extended?.anchorId).toBe("a1");
  });

  it("rejects every transition for an id outside the visible order", () => {
    const selection = replaceSelection("a1", VISIBLE) as ListSelection;

    expect(replaceSelection("hidden", VISIBLE)).toBeNull();
    expect(toggleSelection(selection, "hidden", VISIBLE)).toBeNull();
    expect(extendSelection(selection, "hidden", VISIBLE)).toBeNull();
    expect(applyListSelectionGesture(selection, "toggle", "hidden", VISIBLE)).toBeNull();
  });

  it("clears to the empty selection", () => {
    expect(selectionCount(clearSelection())).toBe(0);
    expect(clearSelection().anchorId).toBeNull();
    expect(clearSelection().leadId).toBeNull();
  });

  it("routes each gesture to its transition", () => {
    const selection = replaceSelection("a1", VISIBLE) as ListSelection;

    expect(ids(applyListSelectionGesture(selection, "open", "a3", VISIBLE))).toEqual(["a3"]);
    expect(ids(applyListSelectionGesture(selection, "toggle", "a3", VISIBLE))).toEqual([
      "a1",
      "a3",
    ]);
    expect(ids(applyListSelectionGesture(selection, "extend", "a3", VISIBLE))).toEqual([
      "a1",
      "a2",
      "a3",
    ]);
  });

  it("drops ids, the anchor and the lead that left the visible order", () => {
    const anchored = replaceSelection("z1", VISIBLE) as ListSelection;
    const wide = extendSelection(anchored, "a1", VISIBLE) as ListSelection;
    const shrunk = [...PINNED, ...ACTIVE];

    const reconciled = reconcileSelection(wide, shrunk);
    expect(orderedSelectionIds(reconciled, shrunk)).toEqual(["a1", "a2", "a3"]);
    expect(reconciled.anchorId).toBeNull();
    expect(reconciled.leadId).toBe("a1");
  });

  it("reports a mark beyond the active row only when one is really there", () => {
    const single = replaceSelection("a1", VISIBLE) as ListSelection;
    const pair = toggleSelection(single, "a2", VISIBLE) as ListSelection;

    expect(hasSelectionBeyond(EMPTY_LIST_SELECTION, "a1")).toBe(false);
    expect(hasSelectionBeyond(single, "a1")).toBe(false);
    expect(hasSelectionBeyond(single, null)).toBe(true);
    expect(hasSelectionBeyond(pair, "a1")).toBe(true);
  });

  it("returns the same selection when nothing needs reconciling", () => {
    const selection = replaceSelection("a1", VISIBLE) as ListSelection;

    expect(reconcileSelection(selection, VISIBLE)).toBe(selection);
  });
});

describe("list selection gestures", () => {
  it("reads command as the toggle key on mac and control elsewhere", () => {
    const meta = { shiftKey: false, metaKey: true, ctrlKey: false };
    const control = { shiftKey: false, metaKey: false, ctrlKey: true };

    expect(listSelectionGesture(meta, "mac")).toBe("toggle");
    expect(listSelectionGesture(control, "mac")).toBe("open");
    expect(listSelectionGesture(control, "linux")).toBe("toggle");
    expect(listSelectionGesture(control, "windows")).toBe("toggle");
    expect(listSelectionGesture(meta, "windows")).toBe("open");
  });

  it("lets shift win over the toggle key and leaves a plain click as open", () => {
    expect(listSelectionGesture({ shiftKey: true, metaKey: true, ctrlKey: false }, "mac")).toBe(
      "extend",
    );
    expect(listSelectionGesture({ shiftKey: false, metaKey: false, ctrlKey: false }, "mac")).toBe(
      "open",
    );
  });
});

describe("list selection ownership", () => {
  it("gives a fresh generation to every identity change, including a return to a previous key", () => {
    const first = listSelectionOwner(null, "A");
    const second = listSelectionOwner(first, "B");
    const third = listSelectionOwner(second, "A");

    expect(first.generation).toBe(0);
    expect(second.generation).toBe(1);
    expect(third.generation).toBe(2);
    expect(sameListSelectionOwner(first, third)).toBe(false);
    expect(listSelectionOwner(third, "A")).toBe(third);
  });

  it("empties the selection when the owner is replaced and keeps it otherwise", () => {
    const owner = listSelectionOwner(null, "A");
    const held = { owner, selection: replaceSelection("a1", VISIBLE) as ListSelection };

    expect(rebaseOwnedSelection(held, owner)).toBe(held);
    const rebased = rebaseOwnedSelection(held, listSelectionOwner(owner, "B"));
    expect(selectionCount(rebased.selection)).toBe(0);
  });

  it("refuses to commit a selection captured under a different generation", () => {
    const first = listSelectionOwner(null, "A");
    const back = listSelectionOwner(listSelectionOwner(first, "B"), "A");
    const held = { owner: first, selection: replaceSelection("a1", VISIBLE) as ListSelection };

    expect(listSelectionCommit(held, back, VISIBLE)).toEqual({ kind: "ownerChanged" });
  });

  it("commits in visual order and reports ids that left the list", () => {
    const owner = listSelectionOwner(null, "A");
    const anchored = replaceSelection("z1", VISIBLE) as ListSelection;
    const wide = extendSelection(anchored, "a2", VISIBLE) as ListSelection;
    const shrunk = ["p1", "p2", "a1", "a2"];

    expect(listSelectionCommit({ owner, selection: wide }, owner, shrunk)).toEqual({
      kind: "ready",
      owner,
      ids: ["a2"],
      missingIds: ["a3", "z1"],
    });
  });

  it("starts an owned selection empty", () => {
    const owner = listSelectionOwner(null, "A");

    expect(ownedListSelection(owner)).toEqual({ owner, selection: EMPTY_LIST_SELECTION });
  });
});

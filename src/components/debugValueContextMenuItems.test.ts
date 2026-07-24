import { describe, expect, it, vi } from "vitest";
import { debugValueContextMenuItems } from "./debugValueContextMenuItems";

describe("debugValueContextMenuItems", () => {
  it("places the official Add to Watch action after the existing variable actions", () => {
    const onAddToWatch = vi.fn();
    const onCopyEvaluatePath = vi.fn();
    const onCopyValue = vi.fn();
    const onSetValue = vi.fn();
    const items = debugValueContextMenuItems({
      candidate: {
        source: "variables",
        identity: "row",
        rootKey: "scope:0",
        workspaceOwnerKey: "workspace",
        sessionId: 1,
        pauseGeneration: 2,
        frameId: 3,
        generation: 4,
        epoch: 5,
        displayedValue: "1",
        adapterEvaluateName: "count",
      },
      surface: {
        source: "variables",
        workspaceOwnerKey: "workspace",
        generation: 4,
        epoch: 5,
        isOwnerCurrent: () => true,
        canCopyValue: () => true,
        copyValue: async () => true,
        copyValueFromMenu: async () => true,
        canCopyEvaluatePath: () => true,
        copyEvaluatePath: async () => true,
        copyEvaluatePathFromMenu: async () => true,
        onCandidateChange: () => undefined,
      },
      onAddToWatch,
      onCopyEvaluatePath,
      onCopyValue,
      onSetValue,
    });

    expect(items.map(({ id, label }) => [id, label])).toEqual([
      ["copy-value", "Copy Value"],
      ["copy-evaluate-path", "Copy as Expression"],
      ["debug.setVariable", "Set Value"],
      ["debug.addToWatchExpressions", "Add to Watch"],
    ]);
    items[3]?.onSelect();
    expect(onAddToWatch).toHaveBeenCalledOnce();
  });

  it("omits Add to Watch unless a truthful action is supplied", () => {
    expect(
      debugValueContextMenuItems({
        candidate: null,
        onCopyEvaluatePath: vi.fn(),
        onCopyValue: vi.fn(),
      }),
    ).toEqual([]);
  });
});

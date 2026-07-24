import { describe, expect, it, vi } from "vitest";
import type { DebugCopyValueCandidate } from "../application/debugCopyValue";
import type { DebugCopyValueSurface } from "./debugCopyValueSurface";
import { debugWatchValueContextMenuItems } from "./debugWatchValueContextMenuItems";

describe("debugWatchValueContextMenuItems", () => {
  it("uses the official Watch command id and orders Set Value before both copy actions", () => {
    const candidate: DebugCopyValueCandidate = {
      source: "watch",
      identity: "watch:one:1",
      rootKey: "/workspace",
      workspaceOwnerKey: "/workspace",
      sessionId: 1,
      pauseGeneration: 2,
      frameId: 3,
      generation: 4,
      epoch: 5,
      evaluateName: "count",
      adapterEvaluateName: "count",
      displayedValue: "3",
    };
    const surface = {
      source: "watch",
      canCopyEvaluatePath: () => true,
    } as DebugCopyValueSurface;

    expect(
      debugWatchValueContextMenuItems({
        candidate,
        surface,
        onCopyEvaluatePath: vi.fn(),
        onCopyValue: vi.fn(),
        onSetValue: vi.fn(),
      }).map(({ id, label }) => [id, label]),
    ).toEqual([
      ["debug.setWatchExpression", "Set Value"],
      ["copy-value", "Copy Value"],
      ["copy-evaluate-path", "Copy as Expression"],
    ]);
  });

  it("does not require a clipboard candidate to expose Set Value", () => {
    expect(
      debugWatchValueContextMenuItems({
        candidate: null,
        onCopyEvaluatePath: vi.fn(),
        onCopyValue: vi.fn(),
        onSetValue: vi.fn(),
      }).map(({ id }) => id),
    ).toEqual(["debug.setWatchExpression"]);
  });
});

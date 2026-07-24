import { describe, expect, it, vi } from "vitest";
import { createDebugCopyValueCommandBridge } from "./debugCopyValueCommandBridge";
import * as bridgeModule from "./debugCopyValueCommandBridge";
import type { DebugCopyEvaluatePathTarget } from "./useDebugCopyValueComposition";

const target = {
  owner: { rootKey: "/workspace", sessionId: 1, pauseGeneration: 2, frameId: 3 },
  evaluateName: "user.name",
  isCurrent: () => true,
} satisfies DebugCopyEvaluatePathTarget;

function binding(enabled: boolean) {
  return {
    canCopyEvaluatePath: vi.fn(() => enabled),
    canCopyValue: vi.fn(() => enabled),
    copyEvaluatePath: vi.fn(async () => enabled),
    copyEvaluatePathOnce: vi.fn(async () => enabled),
    copyValue: vi.fn(async () => enabled),
  };
}

describe("debug Copy Value command bridge", () => {
  it("exports no registry, resolver, or service-locator API", () => {
    expect(Object.keys(bridgeModule).sort()).toEqual([
      "createDebugCopyValueCommandBridge",
      "unavailableDebugCopyValueCommands",
    ]);
  });
  it("keeps an exact stable public command view and delegates to the current binding", async () => {
    const bridge = createDebugCopyValueCommandBridge();
    const commands = bridge.commands;
    expect(Object.keys(commands).sort()).toEqual([
      "canCopyEvaluatePath",
      "canCopyValue",
      "copyEvaluatePath",
      "copyValue",
    ]);
    expect(Object.isFrozen(commands)).toBe(true);
    expect(commands.canCopyValue()).toBe(false);

    const first = binding(true);
    const releaseFirst = bridge.bind(first);
    expect(bridge.commands).toBe(commands);
    expect(commands.canCopyValue()).toBe(true);
    await expect(commands.copyEvaluatePath()).resolves.toBe(true);
    await expect(bridge.copyEvaluatePathOnce(target)).resolves.toBe(true);
    expect(first.copyEvaluatePathOnce).toHaveBeenCalledExactlyOnceWith(target);

    const second = binding(false);
    const releaseSecond = bridge.bind(second);
    releaseFirst();
    expect(commands.canCopyValue()).toBe(false);
    releaseSecond();
    await expect(commands.copyValue()).resolves.toBe(false);
  });

  it("isolates bindings and cleanup between independent App roots", async () => {
    const firstBridge = createDebugCopyValueCommandBridge();
    const secondBridge = createDebugCopyValueCommandBridge();
    const first = binding(true);
    const second = binding(false);
    const releaseFirst = firstBridge.bind(first);
    const releaseSecond = secondBridge.bind(second);

    await expect(firstBridge.commands.copyValue()).resolves.toBe(true);
    await expect(secondBridge.commands.copyValue()).resolves.toBe(false);
    releaseFirst();
    await expect(firstBridge.commands.copyEvaluatePath()).resolves.toBe(false);
    await expect(secondBridge.copyEvaluatePathOnce(target)).resolves.toBe(false);
    expect(second.copyEvaluatePathOnce).toHaveBeenCalledOnce();
    releaseSecond();
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createDebugAddToWatchCommandBridge,
  unavailableDebugAddToWatchCommands,
} from "./debugAddToWatchCommandBridge";
import * as bridgeModule from "./debugAddToWatchCommandBridge";

function capability(accepted = true) {
  return Object.freeze({
    identity: {},
    isCurrent: vi.fn(() => true),
    canAddToWatch: vi.fn(() => accepted),
    addToWatch: vi.fn(() => accepted),
  });
}

describe("debug Add to Watch command bridge", () => {
  it("gives the coordinator no direct evaluator, gateway, variable mutation or IPC authority", () => {
    const source = readFileSync(
      new URL("./useDebugAddToWatchComposition.ts", import.meta.url),
      "utf8",
    );
    expect(source).not.toContain("evaluateWatch");
    expect(source).not.toContain("DebugGateway");
    expect(source).not.toContain("setVariable");
    expect(source).not.toContain("invoke(");
  });

  it("exports only a frozen safe command view and the unavailable port", () => {
    expect(Object.keys(bridgeModule).sort()).toEqual([
      "createDebugAddToWatchCommandBridge",
      "unavailableDebugAddToWatchCommands",
    ]);
    const bridge = createDebugAddToWatchCommandBridge();
    expect(Object.keys(bridge.commands).sort()).toEqual(["addToWatch", "canAddToWatch"]);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(Object.isFrozen(bridge.commands)).toBe(true);
    expect(bridge.commands.canAddToWatch()).toBe(false);
    expect(bridge.commands.addToWatch()).toBe(false);
  });

  it("consumes one exact publication and calls canAdd then add exactly once", () => {
    const bridge = createDebugAddToWatchCommandBridge();
    const focused = capability();
    bridge.setFocusedCapability(focused);

    expect(bridge.commands.canAddToWatch()).toBe(true);
    focused.canAddToWatch.mockClear();
    expect(bridge.commands.addToWatch()).toBe(true);
    expect(focused.canAddToWatch).toHaveBeenCalledOnce();
    expect(focused.addToWatch).toHaveBeenCalledOnce();
    expect(bridge.commands.addToWatch()).toBe(false);
  });

  it("fails closed on stale, rejected, throwing and reentrant capabilities", () => {
    const bridge = createDebugAddToWatchCommandBridge();
    const stale = capability();
    stale.isCurrent.mockReturnValue(false);
    bridge.setFocusedCapability(stale);
    expect(bridge.commands.addToWatch()).toBe(false);
    expect(stale.canAddToWatch).not.toHaveBeenCalled();

    const rejected = capability(false);
    bridge.setFocusedCapability(rejected);
    expect(bridge.commands.addToWatch()).toBe(false);
    expect(rejected.canAddToWatch).toHaveBeenCalledOnce();
    expect(rejected.addToWatch).not.toHaveBeenCalled();

    const throwing = capability();
    throwing.canAddToWatch.mockImplementation(() => {
      throw new Error("rejected");
    });
    bridge.setFocusedCapability(throwing);
    expect(bridge.commands.addToWatch()).toBe(false);

    const reentrant = capability();
    reentrant.canAddToWatch.mockImplementation(() => bridge.commands.addToWatch());
    bridge.setFocusedCapability(reentrant);
    expect(bridge.commands.addToWatch()).toBe(false);
    expect(reentrant.addToWatch).not.toHaveBeenCalled();
  });

  it("does not let stale cleanup or A-B-A replacement revive an old row", () => {
    const bridge = createDebugAddToWatchCommandBridge();
    const first = capability();
    const second = capability();
    const releaseFirst = bridge.setFocusedCapability(first);
    bridge.setFocusedCapability(second);
    const releaseReplacement = bridge.setFocusedCapability(first);

    releaseFirst();
    expect(bridge.commands.addToWatch()).toBe(true);
    expect(first.addToWatch).toHaveBeenCalledOnce();
    expect(second.addToWatch).not.toHaveBeenCalled();
    releaseReplacement();
    expect(bridge.commands.canAddToWatch()).toBe(false);
  });

  it("keeps null publication and independent App-local bridges isolated", () => {
    const first = createDebugAddToWatchCommandBridge();
    const second = createDebugAddToWatchCommandBridge();
    const focused = capability();
    const release = first.setFocusedCapability(focused);
    first.setFocusedCapability(null)();
    expect(first.commands.canAddToWatch()).toBe(true);
    expect(second.commands.canAddToWatch()).toBe(false);
    release();
    expect(first.commands.canAddToWatch()).toBe(false);
    expect(unavailableDebugAddToWatchCommands.canAddToWatch()).toBe(false);
    expect(unavailableDebugAddToWatchCommands.addToWatch()).toBe(false);
  });
});

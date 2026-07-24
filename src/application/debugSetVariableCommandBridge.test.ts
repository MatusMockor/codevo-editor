import { describe, expect, it, vi } from "vitest";
import {
  createDebugSetVariableCommandBridge,
  unavailableDebugSetVariableCommands,
} from "./debugSetVariableCommandBridge";
import * as bridgeModule from "./debugSetVariableCommandBridge";

function capability(accepted: boolean) {
  return Object.freeze({
    identity: {},
    isCurrent: vi.fn(() => true),
    beginEdit: vi.fn(() => accepted),
  });
}

describe("debug Set Variable command bridge", () => {
  it("exports only the safe bridge factory and unavailable command port", () => {
    expect(Object.keys(bridgeModule).sort()).toEqual([
      "createDebugSetVariableCommandBridge",
      "unavailableDebugSetVariableCommands",
    ]);
  });

  it("exposes a stable frozen begin-edit command view without row metadata", () => {
    const bridge = createDebugSetVariableCommandBridge();
    const commands = bridge.commands;
    expect(Object.keys(commands).sort()).toEqual(["beginEdit", "canBeginEdit"]);
    expect(Object.isFrozen(commands)).toBe(true);
    expect(Object.isFrozen(bridge)).toBe(true);
    expect(commands.canBeginEdit()).toBe(false);
    expect(commands.beginEdit()).toBe(false);

    const focused = capability(true);
    const release = bridge.setFocusedCapability(focused);
    expect(commands.canBeginEdit()).toBe(true);
    expect(commands.beginEdit()).toBe(true);
    expect(focused.beginEdit).toHaveBeenCalledOnce();
    release();
    expect(commands.canBeginEdit()).toBe(false);
  });

  it("does not let stale blur cleanup clear a newer focused capability", () => {
    const bridge = createDebugSetVariableCommandBridge();
    const sharedIdentity = {};
    const first = Object.freeze({
      identity: sharedIdentity,
      isCurrent: vi.fn(() => true),
      beginEdit: vi.fn(() => true),
    });
    const second = capability(false);
    const releaseFirst = bridge.setFocusedCapability(first);
    bridge.setFocusedCapability(second);
    const releaseReplacement = bridge.setFocusedCapability(first);

    releaseFirst();
    expect(bridge.commands.canBeginEdit()).toBe(true);
    expect(bridge.commands.beginEdit()).toBe(true);
    expect(first.beginEdit).toHaveBeenCalledOnce();
    expect(second.beginEdit).not.toHaveBeenCalled();
    releaseReplacement();
    expect(bridge.commands.canBeginEdit()).toBe(false);
  });

  it("treats ownerless null publication as a no-op instead of clearing another tree", () => {
    const bridge = createDebugSetVariableCommandBridge();
    const focused = capability(true);
    const release = bridge.setFocusedCapability(focused);

    bridge.setFocusedCapability(null)();
    expect(bridge.commands.canBeginEdit()).toBe(true);
    expect(bridge.commands.beginEdit()).toBe(true);
    release();
    expect(bridge.commands.canBeginEdit()).toBe(false);
  });

  it("keeps the unavailable port inert", () => {
    expect(unavailableDebugSetVariableCommands.canBeginEdit()).toBe(false);
    expect(unavailableDebugSetVariableCommands.beginEdit()).toBe(false);
  });

  it("isolates focus publications between independent App-local bridges", () => {
    const first = createDebugSetVariableCommandBridge();
    const second = createDebugSetVariableCommandBridge();
    const releaseFirst = first.setFocusedCapability(capability(true));

    expect(first.commands.canBeginEdit()).toBe(true);
    expect(second.commands.canBeginEdit()).toBe(false);
    second.setFocusedCapability(capability(false));
    releaseFirst();
    expect(first.commands.canBeginEdit()).toBe(false);
    expect(second.commands.canBeginEdit()).toBe(true);
  });

  it("fails closed when the published focus capability becomes stale", () => {
    const bridge = createDebugSetVariableCommandBridge();
    let current = true;
    const focused = Object.freeze({
      identity: {},
      isCurrent: vi.fn(() => current),
      beginEdit: vi.fn(() => true),
    });
    bridge.setFocusedCapability(focused);
    current = false;

    expect(bridge.commands.canBeginEdit()).toBe(false);
    expect(bridge.commands.beginEdit()).toBe(false);
    expect(focused.beginEdit).not.toHaveBeenCalled();
  });
});

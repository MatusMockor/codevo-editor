import { describe, expect, it, vi } from "vitest";
import { createPaletteProviderSlot } from "./commandPaletteProvider";

describe("createPaletteProviderSlot", () => {
  it("exposes the most recent publication and restores the previous one on revoke", () => {
    const slot = createPaletteProviderSlot<string>();
    const listener = vi.fn();
    slot.subscribe(listener);
    const revokeA = slot.publish("a");
    const revokeB = slot.publish("b");

    expect(slot.current()).toBe("b");
    revokeB();
    expect(slot.current()).toBe("a");
    revokeB();
    expect(slot.current()).toBe("a");
    revokeA();
    expect(slot.current()).toBeNull();
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it("revokes only its own entry when publications interleave", () => {
    const slot = createPaletteProviderSlot<string>();
    const revokeA = slot.publish("a");
    slot.publish("b");
    revokeA();
    expect(slot.current()).toBe("b");
  });

  it("stops notifying unsubscribed listeners", () => {
    const slot = createPaletteProviderSlot<number>();
    const listener = vi.fn();
    const unsubscribe = slot.subscribe(listener);
    unsubscribe();
    slot.publish(1);
    expect(listener).not.toHaveBeenCalled();
  });
});

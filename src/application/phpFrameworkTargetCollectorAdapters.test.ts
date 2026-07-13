import { describe, expect, it, vi } from "vitest";
import { phpLaravelFrameworkTargetCollectorAdapter } from "./phpLaravelFrameworkTargetAdapter";
import {
  activePhpFrameworkTargetCollectorAdapter,
  phpFrameworkTargetCollectorAdapters,
} from "./phpFrameworkTargetCollectorAdapters";
import { phpNetteFrameworkTargetCollectorAdapter } from "./phpNetteFrameworkTargetAdapter";

describe("phpFrameworkTargetCollectorAdapters", () => {
  it("contains the framework target adapters by default", () => {
    expect(phpFrameworkTargetCollectorAdapters).toContain(
      phpLaravelFrameworkTargetCollectorAdapter,
    );
    expect(phpFrameworkTargetCollectorAdapters).toContain(
      phpNetteFrameworkTargetCollectorAdapter,
    );
  });

  it("selects the first active adapter with a matching provider", () => {
    const first = { providerId: "first" };
    const second = { providerId: "second" };
    const third = { providerId: "third" };
    const hasProvider = vi.fn((providerId: string) =>
      ["second", "third"].includes(providerId),
    );

    expect(
      activePhpFrameworkTargetCollectorAdapter(
        [first, second, third],
        { hasProvider },
      ),
    ).toBe(second);
    expect(hasProvider).toHaveBeenNthCalledWith(1, "first");
    expect(hasProvider).toHaveBeenNthCalledWith(2, "second");
    expect(hasProvider).toHaveBeenCalledTimes(2);
  });

  it("returns null when no adapter provider matches", () => {
    const hasProvider = vi.fn(() => false);

    expect(
      activePhpFrameworkTargetCollectorAdapter(
        [{ providerId: "first" }, { providerId: "second" }],
        { hasProvider },
      ),
    ).toBeNull();
    expect(hasProvider).toHaveBeenCalledTimes(2);
  });
});

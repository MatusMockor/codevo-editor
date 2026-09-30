import { describe, expect, it, vi } from "vitest";
import { createCommandPaletteLaunch } from "./commandPalette/commandPaletteLaunch";
import { commandPaletteNewThreadPicker } from "./agentNewThreadPicker";

describe("commandPaletteNewThreadPicker", () => {
  it("queues the New thread in page and then opens the palette", () => {
    const launch = createCommandPaletteLaunch();
    const seen: Array<unknown> = [];
    const openPalette = vi.fn(() => {
      seen.push(launch.take());
      return true;
    });
    const picker = commandPaletteNewThreadPicker(launch, openPalette);

    expect(picker.open()).toBe(true);
    expect(openPalette).toHaveBeenCalledTimes(1);
    expect(seen).toEqual([{ page: "newThreadIn", query: "" }]);
  });

  it("drops its queued page and reports failure when the palette does not open", () => {
    const launch = createCommandPaletteLaunch();
    const picker = commandPaletteNewThreadPicker(launch, () => false);

    expect(picker.open()).toBe(false);
    expect(launch.take()).toBeNull();
  });

  it("keeps a newer request queued by someone else", () => {
    const launch = createCommandPaletteLaunch();
    const picker = commandPaletteNewThreadPicker(launch, () => {
      launch.request({ page: "shortcuts", query: "" });
      return false;
    });

    expect(picker.open()).toBe(false);
    expect(launch.take()).toEqual({ page: "shortcuts", query: "" });
  });
});

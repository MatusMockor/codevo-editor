import { describe, expect, it, vi } from "vitest";
import { workbenchPaletteCommands } from "./workbenchPaletteCommands";

describe("workbenchPaletteCommands", () => {
  it("opens the root and the shortcuts page through the launch request", () => {
    const openPalette = vi.fn();
    const commands = workbenchPaletteCommands({ shortcut: (id) => `sc:${id}`, openPalette });
    const byId = new Map(commands.map((command) => [command.id, command]));

    void byId.get("palette.open")?.run();
    void byId.get("palette.shortcuts")?.run();

    expect(openPalette.mock.calls).toEqual([
      [{ page: "root", query: "" }],
      [{ page: "shortcuts", query: "" }],
    ]);
    expect(byId.get("palette.open")?.shortcut).toBe("sc:palette.open");
    expect(byId.get("palette.shortcuts")?.title).toBe("Keyboard Shortcuts");
  });
});

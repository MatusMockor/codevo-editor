import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchWindowZoomCommands } from "./workbenchWindowZoomCommands";

describe("workbenchWindowZoomCommands", () => {
  it("exposes whole-window commands to the palette with keymap shortcuts", () => {
    const commands = workbenchWindowZoomCommands((id) => `shortcut:${id}`, {
      zoomIn: vi.fn(),
      zoomOut: vi.fn(),
      zoomReset: vi.fn(),
    });
    expect(
      commands.map(({ id, title, category, shortcut }) => ({ id, title, category, shortcut })),
    ).toEqual([
      {
        id: "workbench.zoomIn",
        title: "Zoom In",
        category: "View",
        shortcut: "shortcut:workbench.zoomIn",
      },
      {
        id: "workbench.zoomOut",
        title: "Zoom Out",
        category: "View",
        shortcut: "shortcut:workbench.zoomOut",
      },
      {
        id: "workbench.zoomReset",
        title: "Reset Zoom",
        category: "View",
        shortcut: "shortcut:workbench.zoomReset",
      },
    ]);
  });

  it.each([false, true])(
    "runs every zoom command with workspace availability %s",
    async (hasWorkspace) => {
      const context: CommandContext = {
        activeDocumentDirty: false,
        hasActiveDocument: false,
        hasWorkspace,
      };
      const actions = {
        zoomIn: vi.fn(),
        zoomOut: vi.fn(),
        zoomReset: vi.fn(),
      };
      const commands = workbenchWindowZoomCommands(() => "", actions);
      for (const command of commands) {
        expect(command.isEnabled(context)).toBe(true);
        await command.run();
      }
      expect(actions.zoomIn).toHaveBeenCalledOnce();
      expect(actions.zoomOut).toHaveBeenCalledOnce();
      expect(actions.zoomReset).toHaveBeenCalledOnce();
    },
  );
});

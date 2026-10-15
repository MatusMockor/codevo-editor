import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchAppearanceCommands } from "./workbenchAppearanceCommands";

const disabledContext: CommandContext = {
  hasWorkspace: false,
};

const enabledContext: CommandContext = {
  hasWorkspace: true,
};

describe("workbenchAppearanceCommands", () => {
  it("returns only the settings commands in registry order with metadata", () => {
    const commands = workbenchAppearanceCommands({
      shortcut: (commandId) => `shortcut:${commandId}`,
      openSettingsPanel: vi.fn(),
      openAppearanceSettingsPanel: vi.fn(),
    });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "workbench.openSettings",
        title: "Open Settings",
        category: "Workbench",
        shortcut: "shortcut:workbench.openSettings",
      },
      {
        id: "workbench.openAppearanceSettings",
        title: "Open Appearance Settings",
        category: "Workbench",
        shortcut: "shortcut:workbench.openAppearanceSettings",
      },
    ]);
  });

  it("keeps every command always enabled", () => {
    const commands = workbenchAppearanceCommands({
      shortcut: () => "",
      openSettingsPanel: vi.fn(),
      openAppearanceSettingsPanel: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual([true, true]);
    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([true, true]);
  });

  it("invokes the matching callbacks", async () => {
    const openSettingsPanel = vi.fn();
    const openAppearanceSettingsPanel = vi.fn();
    const commands = workbenchAppearanceCommands({
      shortcut: () => "",
      openSettingsPanel,
      openAppearanceSettingsPanel,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(openSettingsPanel).toHaveBeenCalledTimes(1);
    expect(openAppearanceSettingsPanel).toHaveBeenCalledTimes(1);
  });
});

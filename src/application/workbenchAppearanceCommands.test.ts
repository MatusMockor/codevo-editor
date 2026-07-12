import { describe, expect, it, vi } from "vitest";
import type { CommandContext } from "./commandRegistry";
import { workbenchAppearanceCommands } from "./workbenchAppearanceCommands";

const disabledContext: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: false,
};

const enabledContext: CommandContext = {
  activeDocumentDirty: true,
  hasActiveDocument: true,
  hasWorkspace: true,
};

describe("workbenchAppearanceCommands", () => {
  it("toggles the persisted minimap setting", async () => {
    const appSettings = { minimapEnabled: false };
    const commands = allCommands(
      workbenchAppearanceCommands({
        shortcut: () => "",
        zoomEditorFontIn: vi.fn(),
        zoomEditorFontOut: vi.fn(),
        resetEditorFontSize: vi.fn(),
        toggleEditorFontLigatures: vi.fn(),
        toggleMinimap: vi.fn(() => {
          appSettings.minimapEnabled = !appSettings.minimapEnabled;
        }),
        openSettingsPanel: vi.fn(),
        openAppearanceSettingsPanel: vi.fn(),
      }),
    );

    await commands.find(({ id }) => id === "workbench.toggleMinimap")?.run();

    expect(appSettings.minimapEnabled).toBe(true);
  });

  it("returns appearance and settings commands in registry order with metadata", () => {
    const commands = allCommands(
      workbenchAppearanceCommands({
        shortcut: (commandId) => `shortcut:${commandId}`,
        zoomEditorFontIn: vi.fn(),
        zoomEditorFontOut: vi.fn(),
        resetEditorFontSize: vi.fn(),
        toggleEditorFontLigatures: vi.fn(),
        openSettingsPanel: vi.fn(),
        openAppearanceSettingsPanel: vi.fn(),
      }),
    );

    expect(commands.map(({ id }) => id)).toEqual([
      "editor.fontZoomIn",
      "editor.fontZoomOut",
      "editor.fontZoomReset",
      "editor.toggleFontLigatures",
      "workbench.toggleMinimap",
      "workbench.openSettings",
      "workbench.openAppearanceSettings",
    ]);
    expect(commands.slice(0, 4).every((command) => command.category === "Editor"))
      .toBe(true);
    expect(commands[4].category).toBe("View");
    expect(
      commands.slice(5).every((command) => command.category === "Workbench"),
    ).toBe(true);
  });

  it("returns commands in registry order with metadata", () => {
    const commands = allCommands(
      workbenchAppearanceCommands({
        shortcut: (commandId) => `shortcut:${commandId}`,
        zoomEditorFontIn: vi.fn(),
        zoomEditorFontOut: vi.fn(),
        resetEditorFontSize: vi.fn(),
        toggleEditorFontLigatures: vi.fn(),
        openSettingsPanel: vi.fn(),
        openAppearanceSettingsPanel: vi.fn(),
      }),
    );

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "editor.fontZoomIn",
        title: "Increase Editor Font Size",
        category: "Editor",
        shortcut: "shortcut:editor.fontZoomIn",
      },
      {
        id: "editor.fontZoomOut",
        title: "Decrease Editor Font Size",
        category: "Editor",
        shortcut: "shortcut:editor.fontZoomOut",
      },
      {
        id: "editor.fontZoomReset",
        title: "Reset Editor Font Size",
        category: "Editor",
        shortcut: "shortcut:editor.fontZoomReset",
      },
      {
        id: "editor.toggleFontLigatures",
        title: "Toggle Editor Font Ligatures",
        category: "Editor",
        shortcut: "shortcut:editor.toggleFontLigatures",
      },
      {
        id: "workbench.toggleMinimap",
        title: "View: Toggle Minimap",
        category: "View",
        shortcut: undefined,
      },
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

  it("passes command ids to the shortcut resolver", () => {
    const shortcut = vi.fn((commandId: string) => `shortcut:${commandId}`);

    workbenchAppearanceCommands({
      shortcut,
      zoomEditorFontIn: vi.fn(),
      zoomEditorFontOut: vi.fn(),
      resetEditorFontSize: vi.fn(),
      toggleEditorFontLigatures: vi.fn(),
      openSettingsPanel: vi.fn(),
      openAppearanceSettingsPanel: vi.fn(),
    });

    expect(shortcut).toHaveBeenCalledTimes(6);
    expect(shortcut.mock.calls.map(([commandId]) => commandId)).toEqual([
      "editor.fontZoomIn",
      "editor.fontZoomOut",
      "editor.fontZoomReset",
      "editor.toggleFontLigatures",
      "workbench.openSettings",
      "workbench.openAppearanceSettings",
    ]);
  });

  it("keeps every command always enabled", () => {
    const commands = allCommands(
      workbenchAppearanceCommands({
        shortcut: () => "",
        zoomEditorFontIn: vi.fn(),
        zoomEditorFontOut: vi.fn(),
        resetEditorFontSize: vi.fn(),
        toggleEditorFontLigatures: vi.fn(),
        openSettingsPanel: vi.fn(),
        openAppearanceSettingsPanel: vi.fn(),
      }),
    );

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [true, true, true, true, true, true, true],
    );
    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("invokes the matching callbacks", async () => {
    const zoomEditorFontIn = vi.fn();
    const zoomEditorFontOut = vi.fn();
    const resetEditorFontSize = vi.fn();
    const toggleEditorFontLigatures = vi.fn();
    const toggleMinimap = vi.fn();
    const openSettingsPanel = vi.fn();
    const openAppearanceSettingsPanel = vi.fn();
    const commands = allCommands(
      workbenchAppearanceCommands({
        shortcut: () => "",
        zoomEditorFontIn,
        zoomEditorFontOut,
        resetEditorFontSize,
        toggleEditorFontLigatures,
        toggleMinimap,
        openSettingsPanel,
        openAppearanceSettingsPanel,
      }),
    );

    for (const command of commands) {
      await command.run();
    }

    expect(zoomEditorFontIn).toHaveBeenCalledTimes(1);
    expect(zoomEditorFontOut).toHaveBeenCalledTimes(1);
    expect(resetEditorFontSize).toHaveBeenCalledTimes(1);
    expect(toggleEditorFontLigatures).toHaveBeenCalledTimes(1);
    expect(toggleMinimap).toHaveBeenCalledTimes(1);
    expect(openSettingsPanel).toHaveBeenCalledTimes(1);
    expect(openAppearanceSettingsPanel).toHaveBeenCalledTimes(1);
  });
});

function allCommands(
  commands: ReturnType<typeof workbenchAppearanceCommands>,
) {
  return [...commands.editorCommands, ...commands.workbenchCommands];
}

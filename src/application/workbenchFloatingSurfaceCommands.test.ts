import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { Command, CommandContext } from "./commandRegistry";
import { workbenchFloatingSurfaceCommands } from "./workbenchFloatingSurfaceCommands";

describe("workbenchFloatingSurfaceCommands", () => {
  it("returns floating surface commands in registry order with metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = createCommands({ shortcut });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({
        id,
        title,
        category,
        shortcut,
      })),
    ).toEqual([
      {
        id: "file.quickOpen",
        title: "Quick Open File",
        category: "File",
        shortcut: "shortcut:file.quickOpen",
      },
      {
        id: "editor.recentFiles",
        title: "Recent Files",
        category: "File",
        shortcut: "shortcut:editor.recentFiles",
      },
      {
        id: "editor.recentLocations",
        title: "Recent Locations",
        category: "File",
        shortcut: "shortcut:editor.recentLocations",
      },
      {
        id: "class.quickOpen",
        title: "Open Class",
        category: "PHP",
        shortcut: "shortcut:class.quickOpen",
      },
      {
        id: "editor.goToSymbol",
        title: "Go to Symbol in Workspace",
        category: "Editor",
        shortcut: "shortcut:editor.goToSymbol",
      },
      {
        id: "workbench.searchEverywhere",
        title: "Search Everywhere",
        category: "Workbench",
        shortcut: "shortcut:workbench.searchEverywhere",
      },
      {
        id: "search.text",
        title: "Search Text",
        category: "Search",
        shortcut: "shortcut:search.text",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "file.quickOpen");
    expect(shortcut).toHaveBeenNthCalledWith(2, "editor.recentFiles");
    expect(shortcut).toHaveBeenNthCalledWith(3, "editor.recentLocations");
    expect(shortcut).toHaveBeenNthCalledWith(4, "class.quickOpen");
    expect(shortcut).toHaveBeenNthCalledWith(5, "editor.goToSymbol");
    expect(shortcut).toHaveBeenNthCalledWith(6, "workbench.searchEverywhere");
    expect(shortcut).toHaveBeenNthCalledWith(7, "search.text");
    expect(shortcut).toHaveBeenCalledTimes(7);
  });

  it("enables workspace commands only with a workspace", () => {
    const commands = createCommands().filter(
      (command) => command.id !== "workbench.searchEverywhere",
    );

    expect(
      commands.map((command) => command.isEnabled(context({ hasWorkspace: false }))),
    ).toEqual([false, false, false, false, false, false]);
    expect(
      commands.map((command) => command.isEnabled(context({ hasWorkspace: true }))),
    ).toEqual([true, true, true, true, true, true]);
  });

  it("always enables search everywhere", () => {
    const command = commandById("workbench.searchEverywhere", createCommands());

    expect(command.isEnabled(context({ hasWorkspace: false }))).toBe(true);
    expect(command.isEnabled(context({ hasWorkspace: true }))).toBe(true);
  });

  it("gates workspace symbols behind symbol search readiness", () => {
    expect(
      commandById(
        "editor.goToSymbol",
        createCommands({ canSearchWorkspaceSymbols: false }),
      ).isEnabled(context({ hasWorkspace: true })),
    ).toBe(false);
    expect(
      commandById(
        "editor.goToSymbol",
        createCommands({ canSearchWorkspaceSymbols: true }),
      ).isEnabled(context({ hasWorkspace: true })),
    ).toBe(true);
  });

  it("invokes the exact injected callbacks and returns their values directly", () => {
    const results = Array.from({ length: 7 }, () => Promise.resolve());
    const callbacks = results.map((result) => vi.fn(() => result));
    const commands = workbenchFloatingSurfaceCommands({
      shortcut: (commandId) => commandId,
      canSearchWorkspaceSymbols: true,
      openQuickOpenFile: callbacks[0],
      openRecentFilesSwitcher: callbacks[1],
      openRecentLocationsPanel: callbacks[2],
      openClassOpen: callbacks[3],
      openWorkspaceSymbols: callbacks[4],
      openSearchEverywhere: callbacks[5],
      openTextSearch: callbacks[6],
    });

    commands.forEach((command, index) => {
      expect(command.run()).toBe(results[index]);
      expect(callbacks[index]).toHaveBeenCalledTimes(1);
    });
  });
});

function createCommands(
  overrides: Partial<Parameters<typeof workbenchFloatingSurfaceCommands>[0]> = {},
): Command[] {
  return workbenchFloatingSurfaceCommands({
    shortcut: (commandId) => commandId,
    canSearchWorkspaceSymbols: true,
    openQuickOpenFile: vi.fn(),
    openRecentFilesSwitcher: vi.fn(),
    openRecentLocationsPanel: vi.fn(),
    openClassOpen: vi.fn(),
    openWorkspaceSymbols: vi.fn(),
    openSearchEverywhere: vi.fn(),
    openTextSearch: vi.fn(),
    ...overrides,
  });
}

function commandById(id: string, commands: Command[]): Command {
  const match = commands.find((command) => command.id === id);

  if (!match) {
    throw new Error(`Missing command: ${id}`);
  }

  return match;
}

function context({
  hasWorkspace,
}: {
  hasWorkspace: boolean;
}): CommandContext {
  return {
    activeDocumentDirty: false,
    hasActiveDocument: false,
    hasWorkspace,
  };
}

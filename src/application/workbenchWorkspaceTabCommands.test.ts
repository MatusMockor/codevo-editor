import { describe, expect, it, vi } from "vitest";
import type { KeymapCommandId } from "../domain/keymap";
import type { CommandContext } from "./commandRegistry";
import {
  nextWorkspaceRoot,
  previousWorkspaceRoot,
  workbenchWorkspaceTabCommands,
} from "./workbenchWorkspaceTabCommands";

describe("workspace tab root navigation", () => {
  it.each([
    { activeRoot: "/one", expected: "/two", tabs: ["/one", "/two", "/three"] },
    { activeRoot: "/three", expected: "/one", tabs: ["/one", "/two", "/three"] },
    { activeRoot: "/missing", expected: "/one", tabs: ["/one", "/two"] },
    { activeRoot: null, expected: "/one", tabs: ["/one", "/two"] },
    { activeRoot: "/one", expected: "/one", tabs: ["/one"] },
    { activeRoot: "/one", expected: null, tabs: [] },
  ])(
    "finds the next root for $tabs from $activeRoot",
    ({ tabs, activeRoot, expected }) => {
      expect(nextWorkspaceRoot(tabs, activeRoot)).toBe(expected);
    },
  );

  it.each([
    { activeRoot: "/three", expected: "/two", tabs: ["/one", "/two", "/three"] },
    { activeRoot: "/one", expected: "/three", tabs: ["/one", "/two", "/three"] },
    { activeRoot: "/missing", expected: "/one", tabs: ["/one", "/two"] },
    { activeRoot: null, expected: "/one", tabs: ["/one", "/two"] },
    { activeRoot: "/one", expected: "/one", tabs: ["/one"] },
    { activeRoot: "/one", expected: null, tabs: [] },
  ])(
    "finds the previous root for $tabs from $activeRoot",
    ({ tabs, activeRoot, expected }) => {
      expect(previousWorkspaceRoot(tabs, activeRoot)).toBe(expected);
    },
  );
});

describe("workbenchWorkspaceTabCommands", () => {
  it("returns both workspace commands with palette metadata and shortcuts", () => {
    const shortcut = vi.fn(
      (commandId: KeymapCommandId) => `shortcut:${commandId}`,
    );
    const commands = workbenchWorkspaceTabCommands({
      activateWorkspaceTab: vi.fn(),
      activeWorkspaceRoot: "/one",
      shortcut,
      workspaceTabs: ["/one", "/two"],
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
        category: "Workspace",
        id: "workspace.nextTab",
        shortcut: "shortcut:workspace.nextTab",
        title: "Next Workspace Tab",
      },
      {
        category: "Workspace",
        id: "workspace.previousTab",
        shortcut: "shortcut:workspace.previousTab",
        title: "Previous Workspace Tab",
      },
    ]);
    expect(shortcut).toHaveBeenNthCalledWith(1, "workspace.nextTab");
    expect(shortcut).toHaveBeenNthCalledWith(2, "workspace.previousTab");
  });

  it.each([0, 1])("disables both commands with %i open tabs", (tabCount) => {
    const commands = createCommands(
      Array.from({ length: tabCount }, (_, index) => `/tab-${index}`),
    );

    expect(commands.map((command) => command.isEnabled(context))).toEqual([
      false,
      false,
    ]);
  });

  it("enables both commands with at least two open tabs", () => {
    const commands = createCommands(["/one", "/two"]);

    expect(commands.map((command) => command.isEnabled(context))).toEqual([
      true,
      true,
    ]);
  });

  it("activates the next and previous roots with wrap-around", () => {
    const activateWorkspaceTab = vi.fn();
    const commands = workbenchWorkspaceTabCommands({
      activateWorkspaceTab,
      activeWorkspaceRoot: "/one",
      shortcut: (commandId) => commandId,
      workspaceTabs: ["/one", "/two", "/three"],
    });

    expect(commands[0].run()).toBeUndefined();
    expect(commands[1].run()).toBeUndefined();
    expect(activateWorkspaceTab).toHaveBeenNthCalledWith(1, "/two");
    expect(activateWorkspaceTab).toHaveBeenNthCalledWith(2, "/three");
  });

  it.each([{ workspaceTabs: [] }, { workspaceTabs: ["/one"] }])(
    "does not activate a tab for $workspaceTabs",
    ({ workspaceTabs }) => {
      const activateWorkspaceTab = vi.fn();
      const commands = workbenchWorkspaceTabCommands({
        activateWorkspaceTab,
        activeWorkspaceRoot: "/one",
        shortcut: (commandId) => commandId,
        workspaceTabs,
      });

      commands.forEach((command) => command.run());

      expect(activateWorkspaceTab).not.toHaveBeenCalled();
    },
  );
});

const context: CommandContext = {
  activeDocumentDirty: false,
  hasActiveDocument: false,
  hasWorkspace: true,
};

function createCommands(workspaceTabs: string[]) {
  return workbenchWorkspaceTabCommands({
    activateWorkspaceTab: vi.fn(),
    activeWorkspaceRoot: workspaceTabs[0] ?? null,
    shortcut: (commandId) => commandId,
    workspaceTabs,
  });
}

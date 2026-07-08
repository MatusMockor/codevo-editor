import { describe, expect, it, vi } from "vitest";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { CommandContext } from "./commandRegistry";
import { workbenchPanelCommands } from "./workbenchPanelCommands";

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

describe("workbenchPanelCommands", () => {
  it("returns panel commands in registry order with metadata", () => {
    const commands = workbenchPanelCommands({
      shortcut: (commandId) => `shortcut:${commandId}`,
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos: vi.fn(),
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
        id: "commands.show",
        title: "Show Commands",
        category: "Workbench",
        shortcut: "shortcut:commands.show",
      },
      {
        id: "panel.showProblems",
        title: "Show Problems",
        category: "Workbench",
        shortcut: undefined,
      },
      {
        id: "panel.showIndex",
        title: "Show Index",
        category: "Index",
        shortcut: undefined,
      },
      {
        id: "panel.toggle",
        title: "Toggle Panel",
        category: "Workbench",
        shortcut: "shortcut:panel.toggle",
      },
      {
        id: "panel.toggleTodo",
        title: "Toggle TODO Panel",
        category: "Workbench",
        shortcut: "shortcut:panel.toggleTodo",
      },
      {
        id: "panel.refreshTodo",
        title: "Refresh TODO Comments",
        category: "Workbench",
        shortcut: undefined,
      },
      {
        id: "terminal.show",
        title: "Show Terminal",
        category: "Terminal",
        shortcut: "shortcut:terminal.show",
      },
      {
        id: "runtime.show",
        title: "Show Runtime Panel",
        category: "Workbench",
        shortcut: "shortcut:runtime.show",
      },
    ]);
  });

  it("passes keymapped command ids to the shortcut resolver", () => {
    const shortcut = vi.fn((commandId: string) => `shortcut:${commandId}`);

    workbenchPanelCommands({
      shortcut,
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos: vi.fn(),
    });

    expect(shortcut).toHaveBeenCalledTimes(5);
    expect(shortcut.mock.calls.map(([commandId]) => commandId)).toEqual([
      "commands.show",
      "panel.toggle",
      "panel.toggleTodo",
      "terminal.show",
      "runtime.show",
    ]);
  });

  it("enables always-available commands without a workspace", () => {
    const commands = workbenchPanelCommands({
      shortcut: () => "",
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      [true, true, true, true, false, false, true, true],
    );
  });

  it("enables workspace commands when a workspace is present", () => {
    const commands = workbenchPanelCommands({
      shortcut: () => "",
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      true,
      true,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("invokes the injected callbacks", async () => {
    const openCommandsPalette = vi.fn();
    const showBottomPanelView = vi.fn();
    const toggleBottomPanel = vi.fn();
    const toggleTodoPanel = vi.fn();
    const refreshWorkspaceTodos = vi.fn();
    const commands = workbenchPanelCommands({
      shortcut: () => "",
      openCommandsPalette,
      showBottomPanelView,
      toggleBottomPanel,
      toggleTodoPanel,
      refreshWorkspaceTodos,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(openCommandsPalette).toHaveBeenCalledTimes(1);
    expect(showBottomPanelView.mock.calls.map(([view]) => view)).toEqual<
      BottomPanelView[]
    >(["problems", "index", "terminal", "runtime"]);
    expect(toggleBottomPanel).toHaveBeenCalledTimes(1);
    expect(toggleTodoPanel).toHaveBeenCalledTimes(1);
    expect(refreshWorkspaceTodos).toHaveBeenCalledTimes(1);
  });

  it("does not await TODO refresh from the command body", () => {
    const refreshWorkspaceTodos = vi.fn(
      () => new Promise<void>(() => undefined),
    );
    const refreshCommand = workbenchPanelCommands({
      shortcut: () => "",
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos,
    }).find((command) => command.id === "panel.refreshTodo");

    expect(refreshCommand?.run()).toBeUndefined();
    expect(refreshWorkspaceTodos).toHaveBeenCalledTimes(1);
  });
});

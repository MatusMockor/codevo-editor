import { describe, expect, it, vi } from "vitest";
import type { BottomPanelView } from "../domain/bottomPanel";
import type { CommandContext } from "./commandRegistry";
import { bottomPanelToggle, workbenchPanelCommands } from "./workbenchPanelCommands";

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
      canShowExpressRoutes: true,
      canShowNette: true,
      canShowSymfony: true,
      openExpressRoutesPanel: vi.fn(),
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
        shortcut: "shortcut:panel.showProblems",
      },
      {
        id: "panel.showIndex",
        title: "Show Index",
        category: "Index",
        shortcut: undefined,
      },
      {
        id: "panel.showExpressRoutes",
        title: "Show Express Routes",
        category: "Workbench",
        shortcut: undefined,
      },
      {
        id: "panel.showNette",
        title: "Show Nette",
        category: "PHP",
        shortcut: undefined,
      },
      {
        id: "panel.showSymfony",
        title: "Show Symfony",
        category: "PHP",
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
      canShowExpressRoutes: true,
      canShowSymfony: true,
      openExpressRoutesPanel: vi.fn(),
      shortcut,
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos: vi.fn(),
    });

    expect(shortcut).toHaveBeenCalledTimes(6);
    expect(shortcut.mock.calls.map(([commandId]) => commandId)).toEqual([
      "commands.show",
      "panel.showProblems",
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

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual([
      true,
      true,
      true,
      false,
      false,
      false,
      true,
      false,
      false,
      true,
      true,
    ]);
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
      false,
      false,
      false,
      true,
      true,
      true,
      true,
      true,
    ]);
  });

  it("opens Express routes for an eligible workspace without an active document", async () => {
    const openExpressRoutesPanel = vi.fn();
    const command = workbenchPanelCommands({
      canShowExpressRoutes: true,
      openExpressRoutesPanel,
      shortcut: () => "",
      openCommandsPalette: vi.fn(),
      showBottomPanelView: vi.fn(),
      toggleBottomPanel: vi.fn(),
      toggleTodoPanel: vi.fn(),
      refreshWorkspaceTodos: vi.fn(),
    }).find((candidate) => candidate.id === "panel.showExpressRoutes");

    const workspaceWithoutDocument = {
      ...enabledContext,
      hasActiveDocument: false,
    };
    expect(command?.isEnabled(disabledContext)).toBe(false);
    expect(command?.isEnabled(workspaceWithoutDocument)).toBe(true);
    await command?.run(workspaceWithoutDocument);
    expect(openExpressRoutesPanel).toHaveBeenCalledOnce();
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
    expect(showBottomPanelView.mock.calls.map(([view]) => view)).toEqual<BottomPanelView[]>([
      "problems",
      "index",
      "nette",
      "symfony",
      "terminal",
      "runtime",
    ]);
    expect(toggleBottomPanel).toHaveBeenCalledTimes(1);
    expect(toggleTodoPanel).toHaveBeenCalledTimes(1);
    expect(refreshWorkspaceTodos).toHaveBeenCalledTimes(1);
  });

  it.each<BottomPanelView>(["terminal", "problems", "runtime", "search"])(
    "panel.toggle closes the visible panel regardless of its view (%s)",
    async (view) => {
      const panel = panelHarness({ agentModeActive: false, view, visible: true });

      await panel.runToggle();

      expect(panel.state()).toEqual({ view, visible: false });
    },
  );

  it.each<BottomPanelView>(["terminal", "problems", "search"])(
    "panel.toggle reopens the last view when hidden (%s)",
    async (view) => {
      const panel = panelHarness({ agentModeActive: false, view, visible: false });

      await panel.runToggle();

      expect(panel.state()).toEqual({ view, visible: true });
    },
  );

  it.each<{ readonly view: BottomPanelView; readonly visible: boolean }>([
    { view: "problems", visible: true },
    { view: "search", visible: true },
    { view: "problems", visible: false },
    { view: "terminal", visible: false },
  ])(
    "panel.toggle in agent mode toggles the terminal, not the drawer ($view, visible=$visible)",
    async ({ view, visible }) => {
      const panel = panelHarness({ agentModeActive: true, view, visible });

      await panel.runToggle();

      expect(panel.state()).toEqual({ view: "terminal", visible: true });
    },
  );

  it("panel.toggle in agent mode closes the visible terminal", async () => {
    const panel = panelHarness({ agentModeActive: true, view: "terminal", visible: true });

    await panel.runToggle();

    expect(panel.state()).toEqual({ view: "terminal", visible: false });
  });

  it.each([false, true])(
    "panel.showProblems opens Problems even while the terminal is visible (agent mode %s)",
    async (agentModeActive) => {
      const panel = panelHarness({ agentModeActive, view: "terminal", visible: true });

      await panel.run("panel.showProblems");

      expect(panel.state()).toEqual({ view: "problems", visible: true });
    },
  );

  it("does not await TODO refresh from the command body", () => {
    const refreshWorkspaceTodos = vi.fn(() => new Promise<void>(() => undefined));
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

interface PanelHarnessInput {
  readonly agentModeActive: boolean;
  readonly view: BottomPanelView;
  readonly visible: boolean;
}

function panelHarness(initial: PanelHarnessInput) {
  let view = initial.view;
  let visible = initial.visible;
  const showBottomPanelView = (next: BottomPanelView) => {
    view = next;
    visible = true;
  };
  const toggleBottomPanel = () => {
    visible = !visible;
  };
  const commands = workbenchPanelCommands({
    shortcut: () => "",
    openCommandsPalette: vi.fn(),
    showBottomPanelView,
    toggleBottomPanel: bottomPanelToggle({
      agentModeActive: initial.agentModeActive,
      showBottomPanelView,
      toggleBottomPanel,
      view,
    }),
    toggleTodoPanel: vi.fn(),
    refreshWorkspaceTodos: vi.fn(),
  });
  const run = async (id: string) => {
    const command = commands.find((candidate) => candidate.id === id);
    expect(command).toBeDefined();
    await command?.run(enabledContext);
  };
  return {
    run,
    runToggle: () => run("panel.toggle"),
    state: () => ({ view, visible }),
  };
}

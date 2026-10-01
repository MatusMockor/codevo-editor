import { describe, expect, it, vi } from "vitest";
import {
  initialAgentWorkbenchLayout,
  type AgentSurfaceKind,
  type AgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../domain/agentWorkbenchLayout";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandHandlers,
} from "./agentViewCommandBridge";
import { CommandRegistry, type CommandContext } from "./commandRegistry";
import type { ShortcutScopedCommand } from "./workbenchShortcutCommandDispatcher";
import {
  workbenchAgentCommands,
  type AgentWorkbenchLayoutCommandPort,
} from "./workbenchAgentCommands";

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

const VIEW_COMMAND_IDS = [
  "agent.newThread",
  "agent.newThreadIn",
  "agent.previousThread",
  "agent.nextThread",
  "agent.jumpToThread.1",
  "agent.jumpToThread.2",
  "agent.jumpToThread.3",
  "agent.jumpToThread.4",
  "agent.jumpToThread.5",
  "agent.jumpToThread.6",
  "agent.jumpToThread.7",
  "agent.jumpToThread.8",
  "agent.jumpToThread.9",
  "agent.searchThreads",
  "agent.findInThread",
  "agent.goToTurn",
  "agent.runPreferredScript",
  "agent.openCommitMenu",
] as const;

const LAYOUT_COMMAND_IDS = [
  "agent.toggleRightPanel",
  "agent.openFilesSurface",
  "agent.openDiffSurface",
  "agent.openTerminalSurface",
] as const;

const SHELL_COMMAND_IDS = ["agent.toggleSidebar", "panel.toggleMaximized"] as const;

const PROJECT_COMMAND_IDS = ["project.add"] as const;

const AGENT_COMMAND_IDS = [...VIEW_COMMAND_IDS, ...LAYOUT_COMMAND_IDS, ...SHELL_COMMAND_IDS];

function handlers(
  threadSelected = true,
  blockedSurfaces: ReadonlyArray<AgentSurfaceKind> = [],
  threadFindFocused = true,
): AgentViewCommandHandlers {
  return {
    surfaceBlocked: (surface) => blockedSurfaces.includes(surface),
    newThread: vi.fn(),
    previousThread: vi.fn(),
    nextThread: vi.fn(),
    jumpToThread: vi.fn(),
    searchThreads: vi.fn(),
    findInThread: vi.fn(),
    threadFindFocused: () => threadFindFocused,
    runPreferredScript: vi.fn(),
    openCommitMenu: vi.fn(),
    threadSelected: () => threadSelected,
  };
}

function recordingLayout(
  layout: AgentWorkbenchLayout = initialAgentWorkbenchLayout,
): AgentWorkbenchLayoutCommandPort & {
  readonly actions: AgentWorkbenchLayoutAction[];
} {
  const actions: AgentWorkbenchLayoutAction[] = [];
  return { actions, layout, dispatch: (action) => actions.push(action) };
}

describe("workbenchAgentCommands", () => {
  it("returns the agent commands with registry metadata", () => {
    const commands = workbenchAgentCommands({
      shortcut: (commandId) => `shortcut:${commandId}`,
    });

    expect(commands.map((command) => command.id)).toEqual([
      ...AGENT_COMMAND_IDS,
      ...PROJECT_COMMAND_IDS,
    ]);
    expect(commands.map((command) => command.category)).toEqual([
      ...AGENT_COMMAND_IDS.map(() => "Agents"),
      "Workbench",
    ]);
    expect(commands.map((command) => command.shortcut)).toEqual(
      [...AGENT_COMMAND_IDS, ...PROJECT_COMMAND_IDS].map((id) => `shortcut:${id}`),
    );
    expect(commands.find((command) => command.id === "agent.jumpToThread.4")?.title).toBe(
      "Jump to Thread 4",
    );
    expect(commands.find((command) => command.id === "agent.findInThread")?.title).toBe(
      "Find in Thread",
    );
  });

  it("disables every agent command without a workspace", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers());
    const commands = workbenchAgentCommands({
      agentLayout: recordingLayout(),
      viewCommands: bridge,
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      commands.map(() => false),
    );
  });

  it("keeps the view commands disabled until an agent view is bound", () => {
    const bridge = createAgentViewCommandBridge();
    const commands = workbenchAgentCommands({ viewCommands: bridge });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      ...VIEW_COMMAND_IDS.map(() => false),
      ...LAYOUT_COMMAND_IDS.map(() => true),
      ...SHELL_COMMAND_IDS.map(() => false),
      false,
    ]);

    const unbind = bridge.bind({ ...handlers(), addProject: vi.fn() });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual(
      commands.map(() => true),
    );

    unbind();

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      ...VIEW_COMMAND_IDS.map(() => false),
      ...LAYOUT_COMMAND_IDS.map(() => true),
      ...SHELL_COMMAND_IDS.map(() => false),
      false,
    ]);
  });

  it("registers project.add without requiring an open workspace", async () => {
    const viewCommands = createAgentViewCommandBridge();
    const command = workbenchAgentCommands({ viewCommands }).find(
      (entry) => entry.id === "project.add",
    );
    expect(command).toMatchObject({ title: "Add Project…", category: "Workbench" });
    expect(command?.isEnabled(disabledContext)).toBe(false);
    const addProject = vi.fn();
    viewCommands.bind({ ...handlers(), addProject });
    expect(command?.isEnabled(disabledContext)).toBe(true);
    await command?.run();
    expect(addProject).toHaveBeenCalledTimes(1);
  });

  it("enables the thread-scoped commands only while a thread is selected", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers(false));
    const commands = workbenchAgentCommands({ viewCommands: bridge });
    const threadScoped = [
      "agent.findInThread",
      "agent.goToTurn",
      "agent.runPreferredScript",
      "agent.openCommitMenu",
    ];
    const enabledFor = (id: string) =>
      commands.find((command) => command.id === id)?.isEnabled(enabledContext);

    expect(enabledFor("agent.searchThreads")).toBe(true);
    threadScoped.forEach((id) => expect(enabledFor(id)).toBe(false));

    bridge.bind(handlers(true));

    threadScoped.forEach((id) => expect(enabledFor(id)).toBe(true));
  });

  it("keeps thread find globally available while scoping its shortcut to thread focus", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers(true, [], false));
    const commands = workbenchAgentCommands({ viewCommands: bridge });
    const find = commands.find(
      (command) => command.id === "agent.findInThread",
    ) as ShortcutScopedCommand;

    expect(find.isEnabled(enabledContext)).toBe(true);
    expect(find.isShortcutEnabled(enabledContext)).toBe(false);

    bridge.bind(handlers(true, [], true));

    expect(find.isEnabled(enabledContext)).toBe(true);
    expect(find.isShortcutEnabled(enabledContext)).toBe(true);
  });

  it("routes every view command to the bound handlers exactly once", async () => {
    const bound = handlers();
    const bridge = createAgentViewCommandBridge();
    bridge.bind(bound);
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ viewCommands: bridge })) {
      registry.register(command);
    }

    for (const id of VIEW_COMMAND_IDS) {
      await registry.get(id)?.run();
    }

    expect(bound.newThread).toHaveBeenCalledTimes(1);
    expect(bound.previousThread).toHaveBeenCalledTimes(1);
    expect(bound.nextThread).toHaveBeenCalledTimes(1);
    expect(bound.searchThreads).toHaveBeenCalledTimes(1);
    expect(bound.findInThread).toHaveBeenCalledTimes(1);
    expect(bound.runPreferredScript).toHaveBeenCalledTimes(1);
    expect(bound.openCommitMenu).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bound.jumpToThread).mock.calls.map(([slot]) => slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("routes every layout command to the layout port", async () => {
    const agentLayout = recordingLayout();
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers());
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ agentLayout, viewCommands: bridge })) {
      registry.register(command);
    }

    for (const id of LAYOUT_COMMAND_IDS) {
      await registry.get(id)?.run();
    }

    expect(agentLayout.actions).toEqual([
      { kind: "toggleRightPanel" },
      { kind: "openSurface", surface: "files" },
      { kind: "openSurface", surface: "diff" },
      { kind: "openSurface", surface: "terminal" },
    ]);
  });

  it("dispatches the plain layout actions whatever the surface policy says", async () => {
    const openDiff: AgentWorkbenchLayout = {
      ...initialAgentWorkbenchLayout,
      rightPanel: "open",
      openSurfaces: ["diff"],
      activeSurface: "diff",
    };

    expect(await toggleRightPanel(initialAgentWorkbenchLayout, [])).toEqual([
      { kind: "toggleRightPanel" },
    ]);
    expect(await toggleRightPanel(openDiff, ["diff"])).toEqual([{ kind: "toggleRightPanel" }]);
  });

  it("toggles the panel while no agent view answers for the surfaces", async () => {
    const agentLayout = recordingLayout(initialAgentWorkbenchLayout);
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ agentLayout })) {
      registry.register(command);
    }

    await registry.get("agent.toggleRightPanel")?.run();

    expect(agentLayout.actions).toEqual([{ kind: "toggleRightPanel" }]);
  });

  async function toggleRightPanel(
    layout: AgentWorkbenchLayout,
    blockedSurfaces: ReadonlyArray<AgentSurfaceKind>,
  ): Promise<ReadonlyArray<AgentWorkbenchLayoutAction>> {
    return runLayoutCommand("agent.toggleRightPanel", layout, blockedSurfaces);
  }

  async function runLayoutCommand(
    commandId: string,
    layout: AgentWorkbenchLayout,
    blockedSurfaces: ReadonlyArray<AgentSurfaceKind>,
  ): Promise<ReadonlyArray<AgentWorkbenchLayoutAction>> {
    const agentLayout = recordingLayout(layout);
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers(true, blockedSurfaces));
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ agentLayout, viewCommands: bridge })) {
      registry.register(command);
    }

    await registry.get(commandId)?.run();

    return agentLayout.actions;
  }

  it("toggles the sidebar only in agent mode and yields the shortcut to a focused editor", async () => {
    let editorFocused = false;
    const bridge = createAgentViewCommandBridge();
    const agentLayout = recordingLayout();
    const commands = workbenchAgentCommands({ agentLayout, viewCommands: bridge });
    const toggle = commands.find(
      (command) => command.id === "agent.toggleSidebar",
    ) as ShortcutScopedCommand;

    expect(toggle.isEnabled(enabledContext)).toBe(false);
    expect(toggle.isShortcutEnabled(enabledContext)).toBe(false);

    bridge.bind({ ...handlers(), editorTextFocused: () => editorFocused });

    expect(toggle.isEnabled(enabledContext)).toBe(true);
    expect(toggle.isShortcutEnabled(enabledContext)).toBe(true);
    expect(toggle.isEnabled(disabledContext)).toBe(false);

    editorFocused = true;

    expect(toggle.isEnabled(enabledContext)).toBe(true);
    expect(toggle.isShortcutEnabled(enabledContext)).toBe(false);

    await toggle.run();

    expect(agentLayout.actions).toEqual([{ kind: "toggleRail" }]);
  });

  it("routes Toggle Maximized Panel to the agent view's responsive panel toggle", async () => {
    const toggleMaximizedPanel = vi.fn();
    const bridge = createAgentViewCommandBridge();
    const agentLayout = recordingLayout();
    const commands = workbenchAgentCommands({ agentLayout, viewCommands: bridge });
    const maximize = commands.find((command) => command.id === "panel.toggleMaximized");

    expect(maximize?.title).toBe("Toggle Maximized Panel");
    expect(maximize?.isEnabled(enabledContext)).toBe(false);

    bridge.bind({ ...handlers(), toggleMaximizedPanel });
    await maximize?.run();

    expect(maximize?.isEnabled(enabledContext)).toBe(true);
    expect(toggleMaximizedPanel).toHaveBeenCalledTimes(1);
    expect(agentLayout.actions).toEqual([]);
  });

  it("stays inert when no agent view or layout port is bound", async () => {
    const commands = workbenchAgentCommands({});

    for (const command of commands) {
      await command.run();
    }

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      ...VIEW_COMMAND_IDS.map(() => false),
      ...LAYOUT_COMMAND_IDS.map(() => true),
      ...SHELL_COMMAND_IDS.map(() => false),
      false,
    ]);
  });

  it("ignores handlers that a view does not implement", async () => {
    const bridge = createAgentViewCommandBridge();
    const partial: AgentViewCommandHandlers = {
      ...handlers(),
      runPreferredScript: undefined,
      openCommitMenu: undefined,
    };
    bridge.bind(partial);
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ viewCommands: bridge })) {
      registry.register(command);
    }

    expect(() => registry.get("agent.runPreferredScript")?.run()).not.toThrow();
    expect(() => registry.get("agent.openCommitMenu")?.run()).not.toThrow();
    expect(partial.newThread).not.toHaveBeenCalled();
  });

  it("ignores a stale unbind after the view was replaced", () => {
    const bridge = createAgentViewCommandBridge();
    const first = handlers();
    const second = handlers();
    const unbindFirst = bridge.bind(first);
    bridge.bind(second);

    unbindFirst();
    bridge.run("agent.newThread");

    expect(bridge.bound()).toBe(true);
    expect(first.newThread).not.toHaveBeenCalled();
    expect(second.newThread).toHaveBeenCalledTimes(1);
  });
});

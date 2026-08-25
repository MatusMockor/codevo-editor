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
  "agent.runPreferredScript",
  "agent.openCommitMenu",
] as const;

const LAYOUT_COMMAND_IDS = [
  "agent.toggleRightPanel",
  "agent.openFilesSurface",
  "agent.openDiffSurface",
  "agent.openTerminalSurface",
  "agent.toggleEditorExpanded",
] as const;

function handlers(
  threadSelected = true,
  blockedSurfaces: ReadonlyArray<AgentSurfaceKind> = [],
): AgentViewCommandHandlers {
  return {
    surfaceBlocked: (surface) => blockedSurfaces.includes(surface),
    newThread: vi.fn(),
    previousThread: vi.fn(),
    nextThread: vi.fn(),
    jumpToThread: vi.fn(),
    searchThreads: vi.fn(),
    findInThread: vi.fn(),
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
      ...VIEW_COMMAND_IDS,
      ...LAYOUT_COMMAND_IDS,
    ]);
    expect(commands.map((command) => command.category)).toEqual(commands.map(() => "Agents"));
    expect(commands.map((command) => command.shortcut)).toEqual(
      [...VIEW_COMMAND_IDS, ...LAYOUT_COMMAND_IDS].map((id) => `shortcut:${id}`),
    );
    expect(commands.find((command) => command.id === "agent.jumpToThread.4")?.title).toBe(
      "Jump to Thread 4",
    );
    expect(commands.find((command) => command.id === "agent.findInThread")?.title).toBe(
      "Find in Thread",
    );
    expect(commands.find((command) => command.id === "agent.toggleEditorExpanded")?.title).toBe(
      "Expand or Collapse Editor",
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
    ]);

    const unbind = bridge.bind(handlers());

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual(
      commands.map(() => true),
    );

    unbind();

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      ...VIEW_COMMAND_IDS.map(() => false),
      ...LAYOUT_COMMAND_IDS.map(() => true),
    ]);
  });

  it("enables the thread-scoped commands only while a thread is selected", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers(false));
    const commands = workbenchAgentCommands({ viewCommands: bridge });
    const threadScoped = ["agent.findInThread", "agent.runPreferredScript", "agent.openCommitMenu"];
    const enabledFor = (id: string) =>
      commands.find((command) => command.id === id)?.isEnabled(enabledContext);

    expect(enabledFor("agent.searchThreads")).toBe(true);
    threadScoped.forEach((id) => expect(enabledFor(id)).toBe(false));

    bridge.bind(handlers(true));

    threadScoped.forEach((id) => expect(enabledFor(id)).toBe(true));
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
      { kind: "showRightPanel" },
      { kind: "openSurface", surface: "files" },
      { kind: "openSurface", surface: "diff" },
      { kind: "openSurface", surface: "terminal" },
      { kind: "expandEditor" },
    ]);
  });

  it("restores the remembered surface only when it is not blocked", async () => {
    const closedWithDiff: AgentWorkbenchLayout = {
      ...initialAgentWorkbenchLayout,
      lastSurface: "diff",
    };

    expect(await toggleRightPanel(initialAgentWorkbenchLayout, [])).toEqual([
      { kind: "showRightPanel" },
    ]);
    expect(await toggleRightPanel(closedWithDiff, [])).toEqual([{ kind: "toggleRightPanel" }]);
    expect(await toggleRightPanel(closedWithDiff, ["diff"])).toEqual([{ kind: "showRightPanel" }]);
    expect(
      await toggleRightPanel({ ...closedWithDiff, rightPanel: "open", rightSurface: "diff" }, []),
    ).toEqual([{ kind: "closeSurface" }]);
  });

  it("collapses the expanded editor onto an empty panel when the remembered surface is blocked", async () => {
    const expanded: AgentWorkbenchLayout = {
      ...initialAgentWorkbenchLayout,
      layout: "editor-expanded",
      lastSurface: "terminal",
    };

    expect(await toggleRightPanel(expanded, ["terminal"])).toEqual([{ kind: "showRightPanel" }]);
    expect(await toggleRightPanel(expanded, [])).toEqual([{ kind: "collapseEditor" }]);
    expect(await toggleEditorExpanded(expanded, ["terminal"])).toEqual([
      { kind: "showRightPanel" },
    ]);
    expect(await toggleEditorExpanded(expanded, [])).toEqual([{ kind: "collapseEditor" }]);
  });

  it("keeps the panel empty while no agent view answers for the surfaces", async () => {
    const agentLayout = recordingLayout({ ...initialAgentWorkbenchLayout, lastSurface: "diff" });
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ agentLayout })) {
      registry.register(command);
    }

    await registry.get("agent.toggleRightPanel")?.run();

    expect(agentLayout.actions).toEqual([{ kind: "showRightPanel" }]);
  });

  async function toggleRightPanel(
    layout: AgentWorkbenchLayout,
    blockedSurfaces: ReadonlyArray<AgentSurfaceKind>,
  ): Promise<ReadonlyArray<AgentWorkbenchLayoutAction>> {
    return runLayoutCommand("agent.toggleRightPanel", layout, blockedSurfaces);
  }

  async function toggleEditorExpanded(
    layout: AgentWorkbenchLayout,
    blockedSurfaces: ReadonlyArray<AgentSurfaceKind>,
  ): Promise<ReadonlyArray<AgentWorkbenchLayoutAction>> {
    return runLayoutCommand("agent.toggleEditorExpanded", layout, blockedSurfaces);
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

  it("stays inert when no agent view or layout port is bound", async () => {
    const commands = workbenchAgentCommands({});

    for (const command of commands) {
      await command.run();
    }

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      ...VIEW_COMMAND_IDS.map(() => false),
      ...LAYOUT_COMMAND_IDS.map(() => true),
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

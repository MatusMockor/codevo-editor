import { describe, expect, it, vi } from "vitest";
import {
  createAgentViewCommandBridge,
  type AgentViewCommandHandlers,
} from "./agentViewCommandBridge";
import { CommandRegistry, type CommandContext } from "./commandRegistry";
import { workbenchAgentCommands } from "./workbenchAgentCommands";

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
] as const;

function handlers(threadSelected = true): AgentViewCommandHandlers {
  return {
    newThread: vi.fn(),
    previousThread: vi.fn(),
    nextThread: vi.fn(),
    jumpToThread: vi.fn(),
    searchThreads: vi.fn(),
    findInThread: vi.fn(),
    threadSelected: () => threadSelected,
  };
}

describe("workbenchAgentCommands", () => {
  it("returns the agent commands with registry metadata", () => {
    const commands = workbenchAgentCommands({
      toggleAgentMode: vi.fn(),
      shortcut: (commandId) => `shortcut:${commandId}`,
    });

    expect(commands.map((command) => command.id)).toEqual([
      "panel.showAgents",
      ...VIEW_COMMAND_IDS,
    ]);
    expect(commands.map((command) => command.category)).toEqual(commands.map(() => "Agents"));
    expect(commands[0]?.shortcut).toBeUndefined();
    expect(commands.slice(1).map((command) => command.shortcut)).toEqual(
      VIEW_COMMAND_IDS.map((id) => `shortcut:${id}`),
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
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn(), viewCommands: bridge });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual(
      commands.map(() => false),
    );
  });

  it("keeps the view commands disabled until an agent view is bound", () => {
    const bridge = createAgentViewCommandBridge();
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn(), viewCommands: bridge });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      ...VIEW_COMMAND_IDS.map(() => false),
    ]);

    const unbind = bridge.bind(handlers());

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual(
      commands.map(() => true),
    );

    unbind();

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      ...VIEW_COMMAND_IDS.map(() => false),
    ]);
  });

  it("enables find in thread only while a thread is selected", () => {
    const bridge = createAgentViewCommandBridge();
    bridge.bind(handlers(false));
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn(), viewCommands: bridge });
    const find = commands.find((command) => command.id === "agent.findInThread");
    const search = commands.find((command) => command.id === "agent.searchThreads");

    expect(search?.isEnabled(enabledContext)).toBe(true);
    expect(find?.isEnabled(enabledContext)).toBe(false);

    bridge.bind(handlers(true));

    expect(find?.isEnabled(enabledContext)).toBe(true);
  });

  it("routes every command to the bound handlers exactly once", async () => {
    const toggleAgentMode = vi.fn();
    const bound = handlers();
    const bridge = createAgentViewCommandBridge();
    bridge.bind(bound);
    const registry = new CommandRegistry();
    for (const command of workbenchAgentCommands({ toggleAgentMode, viewCommands: bridge })) {
      registry.register(command);
    }

    await registry.get("panel.showAgents")?.run();
    for (const id of VIEW_COMMAND_IDS) {
      await registry.get(id)?.run();
    }

    expect(toggleAgentMode).toHaveBeenCalledTimes(1);
    expect(bound.newThread).toHaveBeenCalledTimes(1);
    expect(bound.previousThread).toHaveBeenCalledTimes(1);
    expect(bound.nextThread).toHaveBeenCalledTimes(1);
    expect(bound.searchThreads).toHaveBeenCalledTimes(1);
    expect(bound.findInThread).toHaveBeenCalledTimes(1);
    expect(vi.mocked(bound.jumpToThread).mock.calls.map(([slot]) => slot)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
  });

  it("stays inert when no agent view is bound", async () => {
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn() });

    for (const command of commands) {
      await command.run();
    }

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([
      true,
      ...VIEW_COMMAND_IDS.map(() => false),
    ]);
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

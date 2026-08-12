import { describe, expect, it, vi } from "vitest";
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

describe("workbenchAgentCommands", () => {
  it("returns the agents panel command with registry metadata", () => {
    const commands = workbenchAgentCommands({ showAgentsPanel: vi.fn() });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({ id, title, category, shortcut })),
    ).toEqual([
      {
        id: "panel.showAgents",
        title: "Show Agents",
        category: "Agents",
        shortcut: undefined,
      },
    ]);
  });

  it("disables the command without a workspace", () => {
    const commands = workbenchAgentCommands({ showAgentsPanel: vi.fn() });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual([false]);
  });

  it("enables the command with a workspace", () => {
    const commands = workbenchAgentCommands({ showAgentsPanel: vi.fn() });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([true]);
  });

  it("invokes the injected callback exactly once per run", async () => {
    const showAgentsPanel = vi.fn();
    const commands = workbenchAgentCommands({ showAgentsPanel });

    for (const command of commands) {
      await command.run();
    }

    expect(showAgentsPanel).toHaveBeenCalledTimes(1);
  });

  it("registers into the command registry and runs through it", async () => {
    const showAgentsPanel = vi.fn();
    const registry = new CommandRegistry();

    for (const command of workbenchAgentCommands({ showAgentsPanel })) {
      registry.register(command);
    }

    expect(registry.get("panel.showAgents")?.title).toBe("Show Agents");

    await registry.get("panel.showAgents")?.run();

    expect(showAgentsPanel).toHaveBeenCalledTimes(1);
  });
});

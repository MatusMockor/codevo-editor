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
  it("returns the agent mode command with registry metadata", () => {
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn() });

    expect(
      commands.map(({ id, title, category, shortcut }) => ({ id, title, category, shortcut })),
    ).toEqual([
      {
        id: "panel.showAgents",
        title: "Toggle Agent Mode",
        category: "Agents",
        shortcut: undefined,
      },
    ]);
  });

  it("disables the command without a workspace", () => {
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn() });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual([false]);
  });

  it("enables the command with a workspace", () => {
    const commands = workbenchAgentCommands({ toggleAgentMode: vi.fn() });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([true]);
  });

  it("invokes the injected callback exactly once per run", async () => {
    const toggleAgentMode = vi.fn();
    const commands = workbenchAgentCommands({ toggleAgentMode });

    for (const command of commands) {
      await command.run();
    }

    expect(toggleAgentMode).toHaveBeenCalledTimes(1);
  });

  it("registers into the command registry and runs through it", async () => {
    const toggleAgentMode = vi.fn();
    const registry = new CommandRegistry();

    for (const command of workbenchAgentCommands({ toggleAgentMode })) {
      registry.register(command);
    }

    expect(registry.get("panel.showAgents")?.title).toBe("Toggle Agent Mode");

    await registry.get("panel.showAgents")?.run();

    expect(toggleAgentMode).toHaveBeenCalledTimes(1);
  });
});

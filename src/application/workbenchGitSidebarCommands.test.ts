import { describe, expect, it, vi } from "vitest";
import {
  initialAgentWorkbenchLayout,
  type AgentWorkbenchLayoutAction,
} from "../domain/agentWorkbenchLayout";
import type { CommandContext } from "./commandRegistry";
import type { AgentWorkbenchLayoutCommandPort } from "./workbenchAgentCommands";
import { workbenchGitSidebarCommands } from "./workbenchGitSidebarCommands";

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

describe("workbenchGitSidebarCommands", () => {
  it("returns git sidebar commands in registry order with metadata", () => {
    const commands = workbenchGitSidebarCommands({
      agentLayout: recordingLayout(),
      refreshGitStatus: vi.fn(),
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
        id: "git.show",
        title: "Show Git Changes",
        category: "Git",
        shortcut: undefined,
      },
      {
        id: "git.refresh",
        title: "Refresh Git Changes",
        category: "Git",
        shortcut: undefined,
      },
    ]);
  });

  it("disables commands without a workspace", () => {
    const commands = workbenchGitSidebarCommands({
      agentLayout: recordingLayout(),
      refreshGitStatus: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(disabledContext))).toEqual([false, false]);
  });

  it("enables commands with a workspace", () => {
    const commands = workbenchGitSidebarCommands({
      agentLayout: recordingLayout(),
      refreshGitStatus: vi.fn(),
    });

    expect(commands.map((command) => command.isEnabled(enabledContext))).toEqual([true, true]);
  });

  it("invokes the injected callbacks", async () => {
    const agentLayout = recordingLayout();
    const refreshGitStatus = vi.fn();
    const commands = workbenchGitSidebarCommands({
      agentLayout,
      refreshGitStatus,
    });

    for (const command of commands) {
      await command.run();
    }

    expect(agentLayout.actions).toHaveLength(1);
    expect(refreshGitStatus).toHaveBeenCalledTimes(1);
  });

  it("opens the Git surface in the right panel", () => {
    const agentLayout = recordingLayout();
    const show = workbenchGitSidebarCommands({ agentLayout, refreshGitStatus: vi.fn() }).find(
      (command) => command.id === "git.show",
    );

    show?.run(enabledContext);

    expect(agentLayout.actions).toEqual([{ kind: "openSurface", surface: "git" }]);
  });
});

function recordingLayout(): AgentWorkbenchLayoutCommandPort & {
  readonly actions: AgentWorkbenchLayoutAction[];
} {
  const actions: AgentWorkbenchLayoutAction[] = [];
  return {
    actions,
    layout: initialAgentWorkbenchLayout,
    dispatch: (action) => {
      actions.push(action);
    },
  };
}

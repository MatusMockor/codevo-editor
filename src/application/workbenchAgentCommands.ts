import type { KeymapCommandId } from "../domain/keymap";
import {
  AGENT_JUMP_SLOTS,
  agentJumpCommandId,
  createAgentViewCommandBridge,
  type AgentViewCommandBridge,
  type AgentViewCommandId,
} from "./agentViewCommandBridge";
import type { Command, CommandContext } from "./commandRegistry";

export interface WorkbenchAgentCommandsOptions {
  toggleAgentMode: Command["run"];
  viewCommands?: AgentViewCommandBridge;
  shortcut?: (commandId: KeymapCommandId) => string;
}

export function workbenchAgentCommands({
  shortcut,
  toggleAgentMode,
  viewCommands = createAgentViewCommandBridge(),
}: WorkbenchAgentCommandsOptions): Command[] {
  const inAgentMode = (context: CommandContext): boolean =>
    context.hasWorkspace && viewCommands.bound();
  const viewCommand = (
    id: AgentViewCommandId,
    title: string,
    isEnabled: (context: CommandContext) => boolean = inAgentMode,
  ): Command => ({
    id,
    title,
    category: "Agents",
    shortcut: shortcut?.(id),
    isEnabled,
    run: () => viewCommands.run(id),
  });

  return [
    {
      id: "panel.showAgents",
      title: "Toggle Agent Mode",
      category: "Agents",
      isEnabled: (context) => context.hasWorkspace,
      run: toggleAgentMode,
    },
    viewCommand("agent.newThread", "New Thread"),
    viewCommand("agent.previousThread", "Previous Thread"),
    viewCommand("agent.nextThread", "Next Thread"),
    ...AGENT_JUMP_SLOTS.map((slot) =>
      viewCommand(agentJumpCommandId(slot), `Jump to Thread ${slot}`),
    ),
    viewCommand("agent.searchThreads", "Search Threads"),
    viewCommand(
      "agent.findInThread",
      "Find in Thread",
      (context) => inAgentMode(context) && viewCommands.threadSelected(),
    ),
  ];
}

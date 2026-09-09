import type { AgentCliKind } from "./agentTask";

export type AgentComposerCommandId =
  "model" | "permissions" | "reasoning" | "plan" | "new" | "settings" | "compact";

export interface AgentComposerCommand {
  readonly id: AgentComposerCommandId;
  readonly label: string;
  readonly description: string;
}

const COMMANDS: ReadonlyArray<AgentComposerCommand> = [
  { id: "model", label: "Model", description: "Choose the model for your next message." },
  {
    id: "permissions",
    label: "Permissions",
    description: "Choose what the agent is allowed to do.",
  },
  { id: "reasoning", label: "Reasoning", description: "Adjust model effort and capabilities." },
  { id: "plan", label: "Plan mode", description: "Plan changes before making edits." },
  { id: "new", label: "New thread", description: "Start a fresh conversation in this project." },
  { id: "settings", label: "Provider settings", description: "Manage your agent providers." },
  {
    id: "compact",
    label: "Compact context",
    description: "Summarize this Claude conversation to free up context.",
  },
];

export function agentComposerCommands(
  provider: AgentCliKind,
  followUp: boolean,
): ReadonlyArray<AgentComposerCommand> {
  return COMMANDS.filter((command) => {
    switch (command.id) {
      case "reasoning":
      case "plan":
        return provider === "claudeCode";
      case "compact":
        return provider === "claudeCode" && followUp;
      case "model":
      case "permissions":
      case "new":
      case "settings":
        return true;
    }
  });
}

export function agentComposerCommandQuery(prompt: string): string | null {
  if (prompt.length > 34) return null;
  const match = /^\/([a-z-]{0,32})[ \t]?$/i.exec(prompt);
  if (match === null || match[0] !== prompt) return null;
  return match[1]?.toLowerCase() ?? null;
}

export function filterAgentComposerCommands(
  commands: ReadonlyArray<AgentComposerCommand>,
  query: string,
): ReadonlyArray<AgentComposerCommand> {
  if (query.length > 32) return [];
  const normalized = query.toLowerCase();
  return commands.filter(
    (command) =>
      command.id.includes(normalized) || command.label.toLowerCase().includes(normalized),
  );
}

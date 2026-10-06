import { AGENT_COMMAND_CATALOG_LIMITS, type AgentCommandCatalogEntry } from "./agentCommandCatalog";
import type { AgentCliKind } from "./agentTask";

export type AgentComposerCommandId =
  "model" | "permissions" | "reasoning" | "plan" | "new" | "settings" | "usage" | "compact";

export interface AgentComposerCommand {
  readonly kind: "builtin";
  readonly id: AgentComposerCommandId;
  readonly label: string;
  readonly description: string;
}

export type AgentComposerProviderEntry = AgentCommandCatalogEntry;

export type AgentComposerMenuItem = AgentComposerCommand | AgentComposerProviderEntry;

export interface AgentComposerCommandToken {
  readonly query: string;
  readonly terminated: boolean;
}

const MAX_QUERY_LENGTH = AGENT_COMMAND_CATALOG_LIMITS.maxNameBytes;
const TOKEN_PATTERN = /^\/([A-Za-z0-9:_.-]*)([ \t]?)$/;

const COMMANDS: ReadonlyArray<AgentComposerCommand> = [
  builtin("model", "Model", "Choose the model for your next message."),
  builtin("permissions", "Permissions", "Choose what the agent is allowed to do."),
  builtin("reasoning", "Reasoning", "Adjust model effort and capabilities."),
  builtin("plan", "Plan mode", "Plan changes before making edits."),
  builtin("new", "New thread", "Start a fresh conversation in this project."),
  builtin("settings", "Provider settings", "Manage your agent providers."),
  builtin("usage", "Usage limits", "Show plan limits for Claude Code and Codex."),
  builtin("compact", "Compact context", "Summarize this Claude conversation to free up context."),
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
      case "usage":
        return true;
      default: {
        const unreachable: never = command.id;
        return unreachable;
      }
    }
  });
}

export function agentComposerCommandToken(prompt: string): AgentComposerCommandToken | null {
  if (prompt.length > MAX_QUERY_LENGTH + 2) return null;
  const match = TOKEN_PATTERN.exec(prompt);
  if (match === null) return null;
  const query = match[1] ?? "";
  if (query.length > MAX_QUERY_LENGTH) return null;
  return { query: query.toLowerCase(), terminated: match[2] !== "" };
}

export function agentComposerCommandQuery(prompt: string): string | null {
  return agentComposerCommandToken(prompt)?.query ?? null;
}

export function agentComposerMenuItemKey(item: AgentComposerMenuItem): string {
  if (item.kind === "builtin") return item.id;
  return `${item.kind}:${item.name}`;
}

export function agentComposerInvocation(item: AgentComposerMenuItem): string {
  switch (item.kind) {
    case "builtin":
      return `/${item.id}`;
    case "command":
      return `/${item.name}`;
    case "skill":
      return `$${item.name}`;
    default: {
      const unreachable: never = item;
      return unreachable;
    }
  }
}

export function agentComposerInsertion(entry: AgentComposerProviderEntry): string {
  return `${agentComposerInvocation(entry)} `;
}

function builtin(
  id: AgentComposerCommandId,
  label: string,
  description: string,
): AgentComposerCommand {
  return Object.freeze({ kind: "builtin", id, label, description });
}

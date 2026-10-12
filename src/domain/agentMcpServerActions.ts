import type { AgentMcpServer, AgentMcpServerScope } from "./agentMcpServers";
import {
  agentMcpServerConfigNameIssue,
  type AgentMcpServerConfigScope,
} from "./agentMcpServerManagement";
import type { AgentCliKind } from "./agentTask";

export interface AgentMcpServerActions {
  readonly signIn: boolean;
  readonly signInAgain: boolean;
  readonly signOut: boolean;
  readonly removeFrom: AgentMcpServerConfigScope | null;
}

type ActionServer = Pick<AgentMcpServer, "name" | "status" | "scope" | "transport">;

export const NO_AGENT_MCP_SERVER_ACTIONS: AgentMcpServerActions = Object.freeze({
  signIn: false,
  signInAgain: false,
  signOut: false,
  removeFrom: null,
});

export function agentMcpServerActions(
  provider: AgentCliKind,
  server: ActionServer,
): AgentMcpServerActions {
  if (!isChangeableScope(server.scope)) return NO_AGENT_MCP_SERVER_ACTIONS;
  const remote = signsInRemotely(server);
  const settled = server.status === "connected" || server.status === "failed";
  return Object.freeze({
    signIn: remote && server.status === "needsAuth",
    signInAgain: remote && settled,
    signOut: remote && settled && server.scope !== "account",
    removeFrom: removalScope(provider, server),
  });
}

export function agentMcpServerOffersMenu(actions: AgentMcpServerActions): boolean {
  return actions.signInAgain || actions.signOut || actions.removeFrom !== null;
}

function isChangeableScope(scope: AgentMcpServerScope): boolean {
  switch (scope) {
    case "user":
    case "project":
    case "local":
    case "account":
      return true;
    case "plugin":
    case "managed":
    case "unknown":
      return false;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

function signsInRemotely(server: ActionServer): boolean {
  if (server.scope === "account") return true;
  return server.transport === "http" || server.transport === "sse";
}

function removalScope(
  provider: AgentCliKind,
  server: ActionServer,
): AgentMcpServerConfigScope | null {
  if (agentMcpServerConfigNameIssue(server.name) !== null) return null;
  switch (server.scope) {
    case "user":
      return "user";
    case "project":
    case "local":
      return provider === "codex" ? null : server.scope;
    case "account":
    case "plugin":
    case "managed":
    case "unknown":
      return null;
    default: {
      const unreachable: never = server.scope;
      return unreachable;
    }
  }
}

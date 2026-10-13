import type {
  AgentMcpServer,
  AgentMcpServerScope,
  AgentMcpServerTransport,
} from "./agentMcpServers";
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
  const session = signInSession(server);
  const settled = server.status === "connected" || server.status === "failed";
  return Object.freeze({
    signIn: session !== "none" && server.status === "needsAuth",
    signInAgain: session !== "none" && settled,
    signOut: session === "revocable" && settled,
    removeFrom: removalScope(provider, server),
  });
}

export function agentMcpServerOffersMenu(actions: AgentMcpServerActions): boolean {
  return actions.signInAgain || actions.signOut || actions.removeFrom !== null;
}

type SignInSession = "none" | "kept" | "revocable";

function signInSession(server: ActionServer): SignInSession {
  switch (server.scope) {
    case "account":
      return "kept";
    case "user":
    case "project":
    case "local":
    case "plugin":
    case "unknown":
      return signsInRemotely(server.transport) ? "revocable" : "none";
    case "managed":
      return "none";
    default: {
      const unreachable: never = server.scope;
      return unreachable;
    }
  }
}

function signsInRemotely(transport: AgentMcpServerTransport): boolean {
  switch (transport) {
    case "http":
    case "sse":
      return true;
    case "stdio":
    case "unknown":
      return false;
    default: {
      const unreachable: never = transport;
      return unreachable;
    }
  }
}

function removalScope(
  provider: AgentCliKind,
  server: ActionServer,
): AgentMcpServerConfigScope | null {
  if (agentMcpServerConfigNameIssue(server.name) !== null) return null;
  switch (provider) {
    case "claudeCode":
      return claudeRemovalScope(server.scope);
    case "codex":
      return codexRemovalScope(server.scope);
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

function claudeRemovalScope(scope: AgentMcpServerScope): AgentMcpServerConfigScope | null {
  switch (scope) {
    case "user":
    case "project":
    case "local":
      return scope;
    case "account":
    case "plugin":
    case "managed":
    case "unknown":
      return null;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

function codexRemovalScope(scope: AgentMcpServerScope): AgentMcpServerConfigScope | null {
  switch (scope) {
    case "user":
    case "unknown":
      return "user";
    case "project":
    case "local":
    case "account":
    case "plugin":
    case "managed":
      return null;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

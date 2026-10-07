import type {
  AgentMcpServersSnapshot,
  AgentMcpServersState,
} from "../../../application/agentMcpServersStore";
import {
  agentMcpProviderProgram,
  type AgentMcpServer,
  type AgentMcpServerScope,
  type AgentMcpServerStatus,
  type AgentMcpServerTransport,
  type AgentMcpServersErrorKind,
} from "../../../domain/agentMcpServers";
import type { AgentMcpServersProject } from "../../../domain/agentMcpServersTarget";
import type { AgentCliKind } from "../../../domain/agentTask";
import { agentProviderLabel } from "../../agentMode/agentSidebarPresentation";
import { elapsedLabel } from "../../usage/usagePresentation";

export const MCP_PROVIDERS: ReadonlyArray<AgentCliKind> = ["claudeCode", "codex"];
export const MCP_NO_PROJECT_NOTICE = "Open a project to see its MCP servers.";
export const MCP_UNAVAILABLE_NOTICE = "MCP server status is not available in this window.";
export const MCP_TRUNCATED_NOTICE = "Some servers are not shown.";
export const MCP_REFRESH_LABEL = "Check MCP servers";

export type McpProjectPlace = AgentMcpServersProject["kind"];
export type McpServerStatusTone = "ok" | "pending" | "attention" | "danger" | "muted";
export type McpProviderSummaryTone = "neutral" | "problem";

export interface McpProviderSummary {
  readonly text: string;
  readonly tone: McpProviderSummaryTone;
  readonly hintCommand: string | null;
}

const STATUS_RANK: Readonly<Record<AgentMcpServerStatus, number>> = {
  failed: 0,
  needsAuth: 1,
  connecting: 2,
  connected: 3,
  disabled: 4,
  unknown: 5,
};

export function mcpCheckNotice(place: McpProjectPlace): string {
  switch (place) {
    case "local":
      return "Checking starts each configured server once, the same way an agent session does.";
    case "server":
      return "Checking starts each configured server once on the server, the same way an agent session does.";
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

export function mcpSignInLead(place: McpProjectPlace): string {
  switch (place) {
    case "local":
      return "To sign in, run";
    case "server":
      return "On the server, run";
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

export function mcpAddServerLead(place: McpProjectPlace): string {
  switch (place) {
    case "local":
      return "Add one with";
    case "server":
      return "On the server, add one with";
    default: {
      const unreachable: never = place;
      return unreachable;
    }
  }
}

export function orderedMcpServers(
  servers: ReadonlyArray<AgentMcpServer>,
): ReadonlyArray<AgentMcpServer> {
  return [...servers].sort(
    (left, right) =>
      STATUS_RANK[left.status] - STATUS_RANK[right.status] || compareNames(left.name, right.name),
  );
}

export function mcpServerNeedsAttention(status: AgentMcpServerStatus): boolean {
  return status === "failed" || status === "needsAuth";
}

export function mcpServerStatusLabel(status: AgentMcpServerStatus): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "connecting":
      return "Connecting";
    case "needsAuth":
      return "Needs sign-in";
    case "failed":
      return "Failed";
    case "disabled":
      return "Disabled";
    case "unknown":
      return "Status unknown";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function mcpServerStatusTone(status: AgentMcpServerStatus): McpServerStatusTone {
  switch (status) {
    case "connected":
      return "ok";
    case "connecting":
      return "pending";
    case "needsAuth":
      return "attention";
    case "failed":
      return "danger";
    case "disabled":
    case "unknown":
      return "muted";
    default: {
      const unreachable: never = status;
      return unreachable;
    }
  }
}

export function mcpServerSecondaryText(server: AgentMcpServer): string | null {
  const parts = [
    scopeLabel(server.scope),
    transportLabel(server.transport),
    server.endpointOrigin,
    toolCountLabel(server.toolCount),
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  return parts.join(" · ");
}

export function mcpErrorMessage(error: AgentMcpServersErrorKind, provider: AgentCliKind): string {
  const label = agentProviderLabel(provider);
  switch (error) {
    case "unknownWorkspace":
      return "This project is not open in Codevo. Open it, then check again.";
    case "untrustedWorkspace":
      return "This project is not trusted. Trust it to check its MCP servers.";
    case "providerDisabled":
      return `${label} is turned off in Providers settings.`;
    case "busy":
      return "A check is already running for this project. Try again in a moment.";
    case "timedOut":
      return `${label} did not answer in time. Check again.`;
    case "unavailable":
      return `Could not read MCP servers from ${label}.`;
    case "unsupportedRunner":
      return "This server's runner does not support MCP checks yet. Update the runner on the server.";
    case "serverUnavailable":
      return "Could not reach the server. Check the connection, then check again.";
    default: {
      const unreachable: never = error;
      return unreachable;
    }
  }
}

export function mcpProviderSummary(
  state: AgentMcpServersState,
  provider: AgentCliKind,
): McpProviderSummary {
  switch (state.kind) {
    case "idle":
      return neutral("Not checked yet.");
    case "loading":
      return neutral("Checking MCP servers…");
    case "loaded":
      return loadedSummary(state.snapshot, provider);
    case "failed":
      return { text: mcpErrorMessage(state.error, provider), tone: "problem", hintCommand: null };
    default: {
      const unreachable: never = state;
      return unreachable;
    }
  }
}

export function mcpCheckedLabel(checkedAtMs: number, nowMs: number): string {
  return `Checked ${elapsedLabel(checkedAtMs, nowMs)}`;
}

export function mcpCopySignInLabel(serverName: string): string {
  return `Copy sign-in command for ${serverName}`;
}

function compareNames(left: string, right: string): number {
  const folded = compareText(left.toLowerCase(), right.toLowerCase());
  if (folded !== 0) return folded;
  return compareText(left, right);
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function scopeLabel(scope: AgentMcpServerScope): string | null {
  switch (scope) {
    case "user":
      return "User";
    case "project":
      return "Project";
    case "local":
      return "Local";
    case "account":
      return "Account";
    case "plugin":
      return "Plugin";
    case "managed":
      return "Managed";
    case "unknown":
      return null;
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

function transportLabel(transport: AgentMcpServerTransport): string | null {
  switch (transport) {
    case "stdio":
      return "stdio";
    case "http":
      return "HTTP";
    case "sse":
      return "SSE";
    case "unknown":
      return null;
    default: {
      const unreachable: never = transport;
      return unreachable;
    }
  }
}

function toolCountLabel(toolCount: number | null): string | null {
  if (toolCount === null) return null;
  if (toolCount === 1) return "1 tool";
  return `${toolCount} tools`;
}

function loadedSummary(
  snapshot: AgentMcpServersSnapshot,
  provider: AgentCliKind,
): McpProviderSummary {
  const servers = snapshot.result.servers;
  if (servers.length === 0)
    return {
      text: `No MCP servers are configured for ${agentProviderLabel(provider)} in this project.`,
      tone: "neutral",
      hintCommand: `${agentMcpProviderProgram(provider)} mcp add`,
    };
  const attention = servers.filter((server) => mcpServerNeedsAttention(server.status)).length;
  const total = servers.length === 1 ? "1 server" : `${servers.length} servers`;
  if (attention === 0) return neutral(total);
  return neutral(`${total}, ${attention} ${attention === 1 ? "needs" : "need"} attention`);
}

function neutral(text: string): McpProviderSummary {
  return { text, tone: "neutral", hintCommand: null };
}

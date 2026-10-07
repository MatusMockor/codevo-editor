import type { AgentCliKind } from "./agentTask";

export const AGENT_MCP_SERVER_STATUSES = [
  "connected",
  "connecting",
  "needsAuth",
  "failed",
  "disabled",
  "unknown",
] as const;
export const AGENT_MCP_SERVER_SCOPES = [
  "user",
  "project",
  "local",
  "account",
  "plugin",
  "managed",
  "unknown",
] as const;
export const AGENT_MCP_SERVER_TRANSPORTS = ["stdio", "http", "sse", "unknown"] as const;
export const AGENT_MCP_SERVERS_ERROR_KINDS = [
  "unknownWorkspace",
  "untrustedWorkspace",
  "providerDisabled",
  "busy",
  "timedOut",
  "unavailable",
  "unsupportedRunner",
  "serverUnavailable",
] as const;

export type AgentMcpServerStatus = (typeof AGENT_MCP_SERVER_STATUSES)[number];
export type AgentMcpServerScope = (typeof AGENT_MCP_SERVER_SCOPES)[number];
export type AgentMcpServerTransport = (typeof AGENT_MCP_SERVER_TRANSPORTS)[number];
export type AgentMcpServersErrorKind = (typeof AGENT_MCP_SERVERS_ERROR_KINDS)[number];

export interface AgentMcpServer {
  readonly name: string;
  readonly status: AgentMcpServerStatus;
  readonly scope: AgentMcpServerScope;
  readonly transport: AgentMcpServerTransport;
  readonly endpointOrigin: string | null;
  readonly toolCount: number | null;
  readonly detail: string | null;
}

export interface AgentMcpServers {
  readonly version: 1;
  readonly provider: AgentCliKind;
  readonly truncated: boolean;
  readonly servers: ReadonlyArray<AgentMcpServer>;
}

export interface AgentMcpServersRequest {
  readonly repositoryRoot: string;
  readonly provider: AgentCliKind;
}

export const AGENT_MCP_SERVERS_LIMITS = Object.freeze({
  maxServers: 128,
  maxNameBytes: 128,
  maxEndpointOriginBytes: 256,
  maxDetailBytes: 256,
  maxToolCount: 4096,
  maxRepositoryRootBytes: 4096,
});
export const AGENT_MCP_SERVER_ENDPOINT_ORIGIN_PATTERN = /^https?:\/\/[^/?#@\s]+$/;
export const AGENT_MCP_SERVERS_ERRORS: Readonly<Record<AgentMcpServersErrorKind, string>> =
  Object.freeze({
    unknownWorkspace:
      "Agent MCP server status workspace is not registered or its identity changed.",
    untrustedWorkspace: "Agent MCP server status requires a trusted repository.",
    providerDisabled: "Agent MCP server status provider is disabled.",
    busy: "Agent MCP server status check is already running.",
    timedOut: "Agent MCP server status check timed out.",
    unavailable: "Agent MCP server status is unavailable.",
    unsupportedRunner:
      "The server runner does not support MCP server status. Update the runner on the server.",
    serverUnavailable:
      "Server MCP server status could not be loaded. Check the connection and try again.",
  });

const PROVIDERS = ["claudeCode", "codex"] as const satisfies ReadonlyArray<AgentCliKind>;
const REQUEST_KEYS = ["repositoryRoot", "provider"] as const;
const ENVELOPE_KEYS = ["version", "provider", "truncated", "servers"] as const;
const SERVER_KEYS = [
  "name",
  "status",
  "scope",
  "transport",
  "endpointOrigin",
  "toolCount",
  "detail",
] as const;
const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|\\\\)/;
const CONTROL_CHARACTER = /\p{Cc}/u;
const UTF8_ENCODER = new TextEncoder();

export function agentMcpServersRequest(
  repositoryRoot: string | null,
  provider: AgentCliKind,
): AgentMcpServersRequest | null {
  if (repositoryRoot === null || !isAgentMcpRepositoryRoot(repositoryRoot)) return null;
  return Object.freeze({ repositoryRoot, provider });
}

export function isAgentMcpRepositoryRoot(value: string): boolean {
  if (value.length === 0 || value.length > AGENT_MCP_SERVERS_LIMITS.maxRepositoryRootBytes)
    return false;
  if (!value.startsWith("/") && !WINDOWS_ROOT.test(value)) return false;
  if (CONTROL_CHARACTER.test(value)) return false;
  return UTF8_ENCODER.encode(value).byteLength <= AGENT_MCP_SERVERS_LIMITS.maxRepositoryRootBytes;
}

export function parseAgentMcpServersRequest(
  value: unknown,
  path = "agentMcpServersRequest",
): AgentMcpServersRequest {
  const request = record(value, path);
  exactKeys(request, REQUEST_KEYS, path);
  const provider = member(request.provider, PROVIDERS, `${path}.provider`);
  const repositoryRoot = request.repositoryRoot;
  if (typeof repositoryRoot !== "string" || !isAgentMcpRepositoryRoot(repositoryRoot))
    invalid(`${path}.repositoryRoot`);
  return Object.freeze({ repositoryRoot, provider });
}

export function parseAgentMcpServers(value: unknown, path = "agentMcpServers"): AgentMcpServers {
  const envelope = record(value, path);
  exactKeys(envelope, ENVELOPE_KEYS, path);
  if (envelope.version !== 1) invalid(`${path}.version`);
  const provider = member(envelope.provider, PROVIDERS, `${path}.provider`);
  const truncated = envelope.truncated;
  if (typeof truncated !== "boolean") invalid(`${path}.truncated`);
  const raw = envelope.servers;
  if (!Array.isArray(raw) || raw.length > AGENT_MCP_SERVERS_LIMITS.maxServers)
    invalid(`${path}.servers`);
  const names = new Set<string>();
  const servers = raw.map((server, index) => {
    const serverPath = `${path}.servers[${index}]`;
    const parsed = parseServer(server, serverPath);
    if (names.has(parsed.name)) invalid(`${serverPath}.name`);
    names.add(parsed.name);
    return parsed;
  });
  return Object.freeze({ version: 1, provider, truncated, servers: Object.freeze(servers) });
}

export function agentMcpServersErrorKind(error: unknown): AgentMcpServersErrorKind {
  const text = errorText(error);
  if (text === null) return "unavailable";
  const known = AGENT_MCP_SERVERS_ERROR_KINDS.find(
    (kind) => AGENT_MCP_SERVERS_ERRORS[kind] === text,
  );
  return known ?? "unavailable";
}

export function agentMcpProviderProgram(provider: AgentCliKind): string {
  switch (provider) {
    case "claudeCode":
      return "claude";
    case "codex":
      return "codex";
    default: {
      const unreachable: never = provider;
      return unreachable;
    }
  }
}

export function agentMcpServerSignInCommand(
  provider: AgentCliKind,
  server: Pick<AgentMcpServer, "name" | "status">,
): string | null {
  if (server.status !== "needsAuth") return null;
  return `${agentMcpProviderProgram(provider)} mcp login -- ${posixSingleQuoted(server.name)}`;
}

function posixSingleQuoted(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function errorText(error: unknown): string | null {
  if (typeof error === "string") return error.trim();
  if (error instanceof Error) return error.message.trim();
  return null;
}

function parseServer(value: unknown, path: string): AgentMcpServer {
  const server = record(value, path);
  exactKeys(server, SERVER_KEYS, path);
  const status = member(server.status, AGENT_MCP_SERVER_STATUSES, `${path}.status`);
  const transport = member(server.transport, AGENT_MCP_SERVER_TRANSPORTS, `${path}.transport`);
  return Object.freeze({
    name: serverName(server.name, `${path}.name`),
    status,
    scope: member(server.scope, AGENT_MCP_SERVER_SCOPES, `${path}.scope`),
    transport,
    endpointOrigin: endpointOrigin(server.endpointOrigin, transport, `${path}.endpointOrigin`),
    toolCount: toolCount(server.toolCount, `${path}.toolCount`),
    detail: failureDetail(server.detail, status, `${path}.detail`),
  });
}

function serverName(value: unknown, path: string): string {
  if (!isBoundedText(value, AGENT_MCP_SERVERS_LIMITS.maxNameBytes)) invalid(path);
  if (value !== value.trim()) invalid(path);
  return value;
}

function endpointOrigin(
  value: unknown,
  transport: AgentMcpServerTransport,
  path: string,
): string | null {
  if (value === null) return null;
  if (transport === "stdio") invalid(path);
  if (!isBoundedText(value, AGENT_MCP_SERVERS_LIMITS.maxEndpointOriginBytes)) invalid(path);
  if (!AGENT_MCP_SERVER_ENDPOINT_ORIGIN_PATTERN.test(value)) invalid(path);
  return value;
}

function toolCount(value: unknown, path: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isInteger(value)) invalid(path);
  if (value < 0 || value > AGENT_MCP_SERVERS_LIMITS.maxToolCount) invalid(path);
  return value;
}

function failureDetail(value: unknown, status: AgentMcpServerStatus, path: string): string | null {
  if (value === null) return null;
  if (status !== "failed") invalid(path);
  if (!isBoundedText(value, AGENT_MCP_SERVERS_LIMITS.maxDetailBytes)) invalid(path);
  return value;
}

function isBoundedText(value: unknown, maxBytes: number): value is string {
  if (typeof value !== "string" || value.length === 0 || value.length > maxBytes) return false;
  if (CONTROL_CHARACTER.test(value)) return false;
  return UTF8_ENCODER.encode(value).byteLength <= maxBytes;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(path);
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  keys: ReadonlyArray<string>,
  path: string,
): void {
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) invalid(path);
}

function member<T extends string>(value: unknown, choices: ReadonlyArray<T>, path: string): T {
  if (typeof value !== "string" || !choices.includes(value as T)) invalid(path);
  return value as T;
}

function invalid(path: string): never {
  throw new TypeError(`Invalid agent MCP servers at ${path}.`);
}

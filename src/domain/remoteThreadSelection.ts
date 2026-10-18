import { parseRemoteAgentThreadIdentity } from "./remoteAgentIdentity";

export type RemoteServerListState = "loading" | "ready" | "unavailable";

export type RemoteServerConnectionsStatus = "loading" | "ready" | "busy" | "error";

export interface RemoteThreadServerEntry {
  readonly id: string;
  readonly name: string;
  readonly connected: boolean;
}

export interface RemoteThreadSelectionFacts {
  readonly selectedThreadId: string | null;
  readonly threadResolved: boolean;
  readonly serverList: RemoteServerListState;
  readonly servers: readonly RemoteThreadServerEntry[];
  readonly threadListSettled: boolean;
  readonly waitExpired: boolean;
}

export type RemoteThreadSelection =
  | { readonly kind: "none" }
  | { readonly kind: "resolving" }
  | { readonly kind: "disconnected"; readonly serverId: string; readonly serverName: string }
  | { readonly kind: "unavailable"; readonly serverName: string | null }
  | { readonly kind: "missing" };

const REMOTE_THREAD_PREFIX = "remote-thread:";
const NONE: RemoteThreadSelection = { kind: "none" };
const RESOLVING: RemoteThreadSelection = { kind: "resolving" };
const MISSING: RemoteThreadSelection = { kind: "missing" };
const UNAVAILABLE: RemoteThreadSelection = { kind: "unavailable", serverName: null };

export function isRemoteThreadSelectionId(threadId: string | null): threadId is string {
  return threadId !== null && threadId.startsWith(REMOTE_THREAD_PREFIX);
}

export function remoteThreadSelection(facts: RemoteThreadSelectionFacts): RemoteThreadSelection {
  if (!isRemoteThreadSelectionId(facts.selectedThreadId) || facts.threadResolved) return NONE;
  const identity = parseRemoteAgentThreadIdentity(facts.selectedThreadId);
  if (identity === null) return UNAVAILABLE;
  const server = facts.servers.find((entry) => entry.id === identity.serverId);
  if (server === undefined) return unregisteredServerSelection(facts);
  if (!server.connected)
    return { kind: "disconnected", serverId: server.id, serverName: server.name };
  if (facts.threadListSettled) return MISSING;
  if (facts.waitExpired) return { kind: "unavailable", serverName: server.name };
  return RESOLVING;
}

export function remoteThreadSelectionBlocksComposer(selection: RemoteThreadSelection): boolean {
  return selection.kind !== "none";
}

export interface RemoteServerListAuthority {
  readonly status: RemoteServerConnectionsStatus;
  readonly listed: boolean;
}

export function initialRemoteServerListAuthority(
  status: RemoteServerConnectionsStatus,
): RemoteServerListAuthority {
  return { status, listed: false };
}

export function observeRemoteServerListStatus(
  previous: RemoteServerListAuthority,
  status: RemoteServerConnectionsStatus,
): RemoteServerListAuthority {
  if (previous.status === status) return previous;
  return {
    status,
    listed: previous.listed || (previous.status === "loading" && status === "ready"),
  };
}

export function remoteServerListState(
  authority: RemoteServerListAuthority | null,
): RemoteServerListState {
  if (authority === null) return "unavailable";
  if (authority.listed) return "ready";
  switch (authority.status) {
    case "error":
      return "unavailable";
    case "loading":
    case "busy":
    case "ready":
      return "loading";
    default:
      return unsupportedConnectionsStatus(authority.status);
  }
}

export function retainedRemoteServerSelection(
  serverId: string | null,
  serverList: RemoteServerListState,
  servers: readonly Pick<RemoteThreadServerEntry, "id">[],
): string | null {
  if (serverId === null || serverList !== "ready") return serverId;
  return servers.some((server) => server.id === serverId) ? serverId : null;
}

function unregisteredServerSelection(facts: RemoteThreadSelectionFacts): RemoteThreadSelection {
  switch (facts.serverList) {
    case "ready":
      return MISSING;
    case "loading":
      return facts.waitExpired ? UNAVAILABLE : RESOLVING;
    case "unavailable":
      return UNAVAILABLE;
    default:
      return unsupportedServerList(facts.serverList);
  }
}

function unsupportedServerList(state: never): never {
  throw new TypeError(`Unsupported remote server list state: ${String(state)}.`);
}

function unsupportedConnectionsStatus(status: never): never {
  throw new TypeError(`Unsupported remote connections status: ${String(status)}.`);
}

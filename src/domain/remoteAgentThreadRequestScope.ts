export const REMOTE_AGENT_PROJECT_KEY_PREFIX = "remote:";
export const REMOTE_AGENT_THREAD_KEY_PREFIX = "remote-thread:";
export const MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_CHARS = 128;
export const MAX_REMOTE_AGENT_THREAD_REQUEST_PROJECT_ID_CHARS = 512;

export interface AgentThreadRequestScopeIdentity {
  readonly rootKey: string;
  readonly ownerId: string;
  readonly threadId: string;
  readonly workspaceId: string | null;
}

export interface RemoteAgentThreadRequestScope extends AgentThreadRequestScopeIdentity {
  readonly workspaceId: string;
}

export interface RemoteAgentThreadRequestIdentity {
  readonly serverId: string;
  readonly runnerId: string;
  readonly projectId: string;
  readonly conversationId: string;
}

export type AgentThreadRequestScopeRoute = "local" | "remote";

const WIRE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const CONTROL_PATTERN = /\p{Cc}/u;
const PROJECT_KEY_PARTS = 4;

export function isRemoteAgentThreadRequestWireId(value: unknown): value is string {
  return typeof value === "string" && WIRE_ID_PATTERN.test(value);
}

export function agentThreadRequestScopeRoute(
  scope: AgentThreadRequestScopeIdentity,
): AgentThreadRequestScopeRoute {
  if (scope.ownerId.startsWith(REMOTE_AGENT_PROJECT_KEY_PREFIX)) return "remote";
  if (scope.rootKey.startsWith(REMOTE_AGENT_PROJECT_KEY_PREFIX)) return "remote";
  if (scope.threadId.startsWith(REMOTE_AGENT_THREAD_KEY_PREFIX)) return "remote";
  return "local";
}

export function remoteAgentThreadRequestScope(
  identity: RemoteAgentThreadRequestIdentity,
): RemoteAgentThreadRequestScope | null {
  if (!isIdentity(identity)) return null;
  const projectKey = projectKeyOf(identity);
  return {
    rootKey: projectKey,
    ownerId: projectKey,
    threadId: identity.conversationId,
    workspaceId: identity.serverId,
  };
}

export function remoteAgentThreadRequestIdentity(
  scope: AgentThreadRequestScopeIdentity,
): RemoteAgentThreadRequestIdentity | null {
  if (scope.ownerId !== scope.rootKey || scope.workspaceId === null) return null;
  const parts = scope.rootKey.split(":");
  if (parts.length !== PROJECT_KEY_PARTS) return null;
  const decoded = decodedParts(parts.slice(1));
  if (decoded === null) return null;
  const [serverId, runnerId, projectId] = decoded;
  if (serverId === undefined || runnerId === undefined || projectId === undefined) return null;
  const identity = { serverId, runnerId, projectId, conversationId: scope.threadId };
  if (!isIdentity(identity) || serverId !== scope.workspaceId) return null;
  if (projectKeyOf(identity) !== scope.rootKey) return null;
  return identity;
}

function projectKeyOf(
  identity: Pick<RemoteAgentThreadRequestIdentity, "serverId" | "runnerId" | "projectId">,
): string {
  const { serverId, runnerId, projectId } = identity;
  return `${REMOTE_AGENT_PROJECT_KEY_PREFIX}${encodeURIComponent(serverId)}:${encodeURIComponent(runnerId)}:${encodeURIComponent(projectId)}`;
}

function isIdentity(identity: RemoteAgentThreadRequestIdentity): boolean {
  if (!isRemoteAgentThreadRequestWireId(identity.serverId)) return false;
  if (!isRemoteAgentThreadRequestWireId(identity.conversationId)) return false;
  if (!isBoundedText(identity.runnerId, MAX_REMOTE_AGENT_THREAD_REQUEST_RUNNER_ID_CHARS))
    return false;
  if (identity.runnerId === "") return false;
  return isBoundedText(identity.projectId, MAX_REMOTE_AGENT_THREAD_REQUEST_PROJECT_ID_CHARS);
}

function isBoundedText(value: unknown, maxChars: number): value is string {
  if (typeof value !== "string" || value.length > maxChars) return false;
  return !CONTROL_PATTERN.test(value) && isWellFormed(value);
}

function isWellFormed(value: string): boolean {
  try {
    encodeURIComponent(value);
    return true;
  } catch {
    return false;
  }
}

function decodedParts(parts: readonly string[]): readonly string[] | null {
  try {
    return parts.map(decodeURIComponent);
  } catch {
    return null;
  }
}

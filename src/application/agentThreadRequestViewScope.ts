import { agentRootOwnerId } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import { remoteAgentThreadRequestScope } from "../domain/remoteAgentThreadRequestScope";
import type { AgentThreadRequestScope } from "./agentThreadRequestPorts";
import type { AgentThreadView } from "./agentThreadPorts";

export interface LocalAgentThreadRequestIdentity {
  readonly rootKey: string;
  readonly workspaceId: string;
  readonly threadId: string;
}

export function localAgentThreadRequestScope(
  identity: LocalAgentThreadRequestIdentity,
): AgentThreadRequestScope {
  return {
    rootKey: identity.rootKey,
    ownerId: agentRootOwnerId(identity.rootKey),
    threadId: identity.threadId,
    workspaceId: identity.workspaceId,
  };
}

export function localAgentThreadRequestIdentity(
  thread: AgentThread,
): LocalAgentThreadRequestIdentity {
  return {
    rootKey: thread.owner.rootKey,
    workspaceId: thread.owner.ownerId,
    threadId: thread.threadId,
  };
}

export function agentThreadRequestViewScope(
  view: AgentThreadView | null,
): AgentThreadRequestScope | null {
  if (view === null) return null;
  const execution = view.execution;
  if (execution === undefined)
    return localAgentThreadRequestScope(localAgentThreadRequestIdentity(view.thread));
  const { serverId, runnerId, projectId, conversationId } = execution;
  return remoteAgentThreadRequestScope({ serverId, runnerId, projectId, conversationId });
}

export function agentThreadRequestScopeKey(scope: AgentThreadRequestScope | null): string | null {
  if (scope === null) return null;
  return JSON.stringify([scope.rootKey, scope.ownerId, scope.threadId, scope.workspaceId]);
}

export function agentThreadRequestScopeOfKey(key: string | null): AgentThreadRequestScope | null {
  if (key === null) return null;
  const parsed: unknown = JSON.parse(key);
  if (!Array.isArray(parsed) || parsed.length !== 4) return null;
  const [rootKey, ownerId, threadId, workspaceId] = parsed as readonly unknown[];
  if (typeof rootKey !== "string" || typeof ownerId !== "string") return null;
  if (typeof threadId !== "string") return null;
  if (typeof workspaceId !== "string" && workspaceId !== null) return null;
  return { rootKey, ownerId, threadId, workspaceId };
}

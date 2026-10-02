import { useMemo } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import {
  agentLocalFileLinkScope,
  type AgentLocalFileLinkPort,
  type AgentLocalFileLinkScope,
} from "./agentMarkdownLinks";
import { agentRemoteFileLinkScope, type AgentRemoteFileLinkPort } from "./agentRemoteFileLinks";

export function useAgentThreadFileLinkScope(
  localPort: AgentLocalFileLinkPort | null,
  remotePort: AgentRemoteFileLinkPort | null,
  thread: AgentThreadView,
): AgentLocalFileLinkScope | null {
  const { owner, target } = thread.thread;
  const execution = thread.execution;
  const serverId = execution?.serverId ?? null;
  const runnerId = execution?.runnerId ?? "";
  const projectId = execution?.projectId ?? "";
  const conversationId = execution?.conversationId ?? "";
  const latestTaskId = execution?.latestTaskId ?? "";
  const repositoryLabel = thread.repositoryLabel;
  return useMemo(() => {
    if (serverId === null) {
      return agentLocalFileLinkScope(localPort, {
        repositoryRoot: owner.repositoryRoot,
        worktreePath: target.worktreePath,
      });
    }
    return agentRemoteFileLinkScope(remotePort, {
      execution: { serverId, runnerId, projectId, conversationId, latestTaskId },
      isolation: target.isolation,
      repositoryLabel,
    });
  }, [
    conversationId,
    latestTaskId,
    localPort,
    owner.repositoryRoot,
    projectId,
    remotePort,
    repositoryLabel,
    runnerId,
    serverId,
    target.isolation,
    target.worktreePath,
  ]);
}

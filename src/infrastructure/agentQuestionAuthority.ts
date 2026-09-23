import type { AgentQuestionOwner } from "../application/agentQuestionPorts";

export function agentQuestionIdentifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new Error("Invalid question owner.");
}
export function agentQuestionAuthority(owner: AgentQuestionOwner) {
  agentQuestionIdentifier(owner.taskId);
  if (owner.kind === "remote") {
    agentQuestionIdentifier(owner.serverId);
    agentQuestionIdentifier(owner.runnerId);
    return { serverId: owner.serverId, runnerId: owner.runnerId, taskId: owner.taskId };
  }
  agentQuestionIdentifier(owner.workspaceId);
  if (
    typeof owner.repositoryRoot !== "string" ||
    owner.repositoryRoot.length === 0 ||
    owner.repositoryRoot.length > 8192 ||
    new TextEncoder().encode(owner.repositoryRoot).length > 8192 ||
    /[\0\r\n]/.test(owner.repositoryRoot)
  )
    throw new Error("Invalid question owner.");
  return {
    workspaceId: owner.workspaceId,
    repositoryRoot: owner.repositoryRoot,
    taskId: owner.taskId,
  };
}

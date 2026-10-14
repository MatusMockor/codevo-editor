import type { AgentLocalQuestionOwner } from "../application/agentQuestionPorts";

export interface AgentLocalInteractionAuthority {
  readonly workspaceId: string;
  readonly taskId: string;
}

export function agentQuestionIdentifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new Error("Invalid question owner.");
}

export function agentLocalQuestionAuthority(
  owner: AgentLocalQuestionOwner,
): AgentLocalInteractionAuthority {
  if (owner === null || typeof owner !== "object" || owner.kind !== "local")
    throw new Error("Invalid question owner.");
  agentQuestionIdentifier(owner.workspaceId);
  agentQuestionIdentifier(owner.taskId);
  return { workspaceId: owner.workspaceId, taskId: owner.taskId };
}

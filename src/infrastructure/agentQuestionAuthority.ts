import type { AgentInteractionOwner } from "../application/agentInteractionPorts";
import type {
  AgentQuestionOwner,
  AgentRemoteQuestionOwner,
} from "../application/agentQuestionPorts";

export interface AgentLocalInteractionAuthority {
  readonly workspaceId: string;
  readonly taskId: string;
}

export interface AgentRemoteQuestionAuthority {
  readonly serverId: string;
  readonly runnerId: string;
  readonly taskId: string;
}

export function agentQuestionIdentifier(value: string): void {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value))
    throw new Error("Invalid question owner.");
}

export function agentInteractionAuthority(
  owner: AgentInteractionOwner,
): AgentLocalInteractionAuthority {
  if (owner === null || typeof owner !== "object") throw new Error("Invalid question owner.");
  agentQuestionIdentifier(owner.workspaceId);
  agentQuestionIdentifier(owner.taskId);
  return { workspaceId: owner.workspaceId, taskId: owner.taskId };
}

export function agentRemoteQuestionAuthority(
  owner: AgentRemoteQuestionOwner,
): AgentRemoteQuestionAuthority {
  if (owner === null || typeof owner !== "object" || owner.kind !== "remote")
    throw new Error("Invalid question owner.");
  agentQuestionIdentifier(owner.serverId);
  agentQuestionIdentifier(owner.runnerId);
  agentQuestionIdentifier(owner.taskId);
  return { serverId: owner.serverId, runnerId: owner.runnerId, taskId: owner.taskId };
}

export function agentLocalQuestionAuthority(
  owner: AgentQuestionOwner,
): AgentLocalInteractionAuthority {
  if (owner === null || typeof owner !== "object" || owner.kind !== "local")
    throw new Error("Invalid question owner.");
  return agentInteractionAuthority(owner);
}

export function agentQuestionAuthority(
  owner: AgentQuestionOwner,
): AgentLocalInteractionAuthority | AgentRemoteQuestionAuthority {
  if (owner !== null && typeof owner === "object" && owner.kind === "remote")
    return agentRemoteQuestionAuthority(owner);
  return agentLocalQuestionAuthority(owner);
}

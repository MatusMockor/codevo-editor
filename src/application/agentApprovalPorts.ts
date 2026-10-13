import type { AgentApprovalDecision, AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentQuestionOwner } from "./agentQuestionPorts";

export type AgentApprovalOwner = AgentQuestionOwner;

export interface AgentApprovalGateway {
  answerApproval(
    owner: AgentApprovalOwner,
    requestId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalRequest>;
}

export function isAgentApprovalGateway(value: unknown): value is AgentApprovalGateway {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AgentApprovalGateway>;
  return typeof candidate.answerApproval === "function";
}

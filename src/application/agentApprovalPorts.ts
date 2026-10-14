import type { AgentApprovalDecision, AgentApprovalRequest } from "../domain/agentApproval";
import type { AgentLocalQuestionOwner, AgentQuestionGateway } from "./agentQuestionPorts";

export type AgentApprovalOwner = AgentLocalQuestionOwner;

export interface AgentApprovalGateway {
  answerApproval(
    owner: AgentApprovalOwner,
    requestId: string,
    decision: AgentApprovalDecision,
  ): Promise<AgentApprovalRequest>;
}

export type AgentQuestionApprovalGateway = AgentQuestionGateway & AgentApprovalGateway;

export function isAgentApprovalGateway(value: unknown): value is AgentApprovalGateway {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as Partial<AgentApprovalGateway>;
  return typeof candidate.answerApproval === "function";
}

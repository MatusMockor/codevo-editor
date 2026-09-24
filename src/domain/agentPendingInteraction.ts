import type { AgentApprovalRequest } from "./agentApproval";
import type { AgentQuestionRequest } from "./agentQuestion";

export type AgentPendingInteraction = "approval" | "input";

export function agentPendingInteraction(
  approvals: ReadonlyArray<AgentApprovalRequest>,
  questions: ReadonlyArray<AgentQuestionRequest>,
): AgentPendingInteraction | null {
  if (approvals.some((request) => request.status === "pending")) return "approval";
  if (questions.some((request) => request.status === "pending")) return "input";
  return null;
}

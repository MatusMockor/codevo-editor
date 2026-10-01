import type { AgentApprovalRequest } from "./agentApproval";
import type { AgentQuestionRequest } from "./agentQuestion";

export type AgentPendingInteraction = "approval" | "input";

export interface AgentPendingInteractionIdentity {
  readonly kind: AgentPendingInteraction;
  readonly id: string;
}

export function agentPendingInteraction(
  approvals: ReadonlyArray<AgentApprovalRequest>,
  questions: ReadonlyArray<AgentQuestionRequest>,
): AgentPendingInteraction | null {
  return agentPendingInteractionIdentity(approvals, questions)?.kind ?? null;
}

export function agentPendingInteractionIdentity(
  approvals: ReadonlyArray<AgentApprovalRequest>,
  questions: ReadonlyArray<AgentQuestionRequest>,
): AgentPendingInteractionIdentity | null {
  const approval = approvals.find((request) => request.status === "pending");
  if (approval !== undefined) return { kind: "approval", id: approval.id };
  const question = questions.find((request) => request.status === "pending");
  if (question !== undefined) return { kind: "input", id: question.id };
  return null;
}

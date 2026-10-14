import type { AgentApprovalRequest } from "./agentApproval";
import type { AgentQuestionRequest } from "./agentQuestion";
import type { PendingAgentRuntimeRequest } from "./agentRuntimeRequest";

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

export function agentPendingRuntimeRequestIdentity(
  requests: readonly PendingAgentRuntimeRequest[],
  turnId: string,
): AgentPendingInteractionIdentity | null {
  const ofTurn = requests.filter((request) => request.turnId === turnId);
  const approval = ofTurn.find((request) => request.body.kind === "approval");
  if (approval !== undefined) return { kind: "approval", id: approval.id };
  const question = ofTurn.find((request) => request.body.kind === "question");
  if (question !== undefined) return { kind: "input", id: question.id };
  return null;
}

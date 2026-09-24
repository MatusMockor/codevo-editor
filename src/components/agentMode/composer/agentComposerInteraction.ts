import type { AgentApprovalDecision, AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest, AgentQuestionResponse } from "../../../domain/agentQuestion";
import {
  presentAgentApproval,
  visibleAgentApprovals,
  type AgentApprovalView,
} from "../agentApprovalPresenter";

export type AgentComposerInteraction =
  | {
      readonly kind: "approval";
      readonly key: string;
      readonly view: AgentApprovalView;
      readonly pendingCount: number;
      readonly sending: boolean;
      readonly error: string | null;
      decide(decision: AgentApprovalDecision): Promise<void>;
    }
  | {
      readonly kind: "question";
      readonly key: string;
      readonly request: AgentQuestionRequest;
      readonly sending: boolean;
      readonly error: string | null;
      answer(response: AgentQuestionResponse): Promise<void>;
    }
  | { readonly kind: "notice"; readonly key: string; readonly text: string };

export interface AgentComposerInteractionInputs {
  readonly approvals: {
    readonly requests: ReadonlyArray<AgentApprovalRequest>;
    readonly answering: string | null;
    readonly error: string | null;
    answer(requestId: string, decision: AgentApprovalDecision): Promise<void>;
  };
  readonly questions: {
    readonly requests: ReadonlyArray<AgentQuestionRequest>;
    readonly answering: string | null;
    readonly error: string | null;
    answer(requestId: string, response: AgentQuestionResponse): Promise<void>;
  };
  readonly running: boolean;
}

export function pickAgentComposerInteraction(
  inputs: AgentComposerInteractionInputs,
): AgentComposerInteraction | null {
  const visible = visibleAgentApprovals(inputs.approvals.requests);
  const pending = visible.filter((request) => request.status === "pending");
  const approval = pending[0];
  if (approval !== undefined) {
    return {
      kind: "approval",
      key: `approval:${approval.taskId}:${approval.id}`,
      view: presentAgentApproval(approval),
      pendingCount: pending.length,
      sending: inputs.approvals.answering === approval.id,
      error: inputs.approvals.error,
      decide: (decision) => inputs.approvals.answer(approval.id, decision),
    };
  }
  const question = inputs.questions.requests.find((request) => request.status === "pending");
  if (question !== undefined) {
    return {
      kind: "question",
      key: `question:${question.taskId}:${question.id}`,
      request: question,
      sending: inputs.questions.answering === question.id,
      error: inputs.questions.error,
      answer: (response) => inputs.questions.answer(question.id, response),
    };
  }
  const settled = visible[0];
  if (settled !== undefined) {
    return {
      kind: "notice",
      key: `approval-notice:${settled.id}:${settled.status}`,
      text: `${settled.title} · ${presentAgentApproval(settled).statusText}`,
    };
  }
  if (inputs.questions.error !== null && inputs.running) {
    return { kind: "notice", key: "question-error", text: inputs.questions.error };
  }
  return null;
}

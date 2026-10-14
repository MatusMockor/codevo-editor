import type { AgentThreadRequestReply } from "../../../application/agentThreadRequestResponders";
import type {
  AgentThreadPendingRequest,
  AgentThreadPendingRequestState,
} from "../../../application/useAgentThreadPendingRequests";
import type { AgentApprovalDecision, AgentApprovalRequest } from "../../../domain/agentApproval";
import type { AgentQuestionRequest, AgentQuestionResponse } from "../../../domain/agentQuestion";
import type {
  AgentRuntimeApprovalBody,
  AgentRuntimeQuestionBody,
  AgentRuntimeRequest,
} from "../../../domain/agentRuntimeRequest";
import {
  presentAgentApproval,
  type AgentApprovalGrantScope,
  type AgentApprovalView,
} from "../agentApprovalPresenter";

export const AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE =
  "Attachments can't be added to this answer. Describe the image in text instead.";
export const AGENT_QUESTION_REMOTE_ATTACHMENTS_UNAVAILABLE =
  "Attachments aren't supported for answers on a remote server. Describe the image in text instead.";
export const AGENT_REQUEST_CHECKING = "Checking whether your answer arrived…";

export type AgentComposerQuestionAttachmentTarget =
  | { readonly kind: "thread"; readonly threadId: string }
  | { readonly kind: "unavailable"; readonly reason: string };

export type AgentComposerInteraction =
  | {
      readonly kind: "approval";
      readonly key: string;
      readonly view: AgentApprovalView;
      readonly pendingCount: number;
      readonly sending: boolean;
      readonly disabled?: boolean;
      readonly note?: string | null;
      readonly error: string | null;
      decide(decision: AgentApprovalDecision): Promise<void>;
    }
  | {
      readonly kind: "question";
      readonly key: string;
      readonly request: AgentQuestionRequest;
      readonly attachments: AgentComposerQuestionAttachmentTarget;
      readonly sending: boolean;
      readonly disabled?: boolean;
      readonly note?: string | null;
      readonly pendingLabel?: string | null;
      readonly error: string | null;
      answer(response: AgentQuestionResponse): Promise<void>;
    };

export interface AgentComposerInteractionInputs {
  readonly requests: readonly AgentThreadPendingRequest[];
  readonly attachments: AgentComposerQuestionAttachmentTarget;
  readonly grant: AgentApprovalGrantScope;
  respond(key: string, reply: AgentThreadRequestReply): Promise<void>;
}

interface Controls {
  readonly sending: boolean;
  readonly disabled: boolean;
  readonly note: string | null;
  readonly pendingLabel: string | null;
}

type ApprovalItem = AgentThreadPendingRequest & {
  readonly request: AgentRuntimeRequest & { readonly body: AgentRuntimeApprovalBody };
};
type QuestionItem = AgentThreadPendingRequest & {
  readonly request: AgentRuntimeRequest & { readonly body: AgentRuntimeQuestionBody };
};

export function pickAgentComposerInteraction(
  inputs: AgentComposerInteractionInputs,
): AgentComposerInteraction | null {
  const actionable = inputs.requests.filter(isActionable);
  return (
    pickFrom(actionable, inputs) ??
    pickFrom(
      inputs.requests.filter((item) => !isActionable(item)),
      inputs,
    )
  );
}

function pickFrom(
  requests: readonly AgentThreadPendingRequest[],
  inputs: AgentComposerInteractionInputs,
): AgentComposerInteraction | null {
  const approvals = requests.filter(isApproval);
  const approval = approvals[0];
  if (approval !== undefined) return approvalInteraction(approval, approvals.length, inputs);
  const question = requests.find(isQuestion);
  if (question !== undefined) return questionInteraction(question, inputs);
  return null;
}

function isActionable(item: AgentThreadPendingRequest): boolean {
  return item.state.kind !== "readOnly";
}

function approvalInteraction(
  item: ApprovalItem,
  pendingCount: number,
  inputs: AgentComposerInteractionInputs,
): AgentComposerInteraction {
  const { request } = item;
  const controls = controlsOf(item.state);
  const view = presentAgentApproval(approvalRequestOf(request), inputs.grant);
  return {
    kind: "approval",
    key: `approval:${request.turnId}:${request.id}`,
    view: controls.note === null ? view : { ...view, actions: [] },
    pendingCount,
    sending: controls.sending,
    disabled: controls.disabled,
    note: controls.note,
    error: item.error,
    decide: (decision) => inputs.respond(item.key, { kind: "approval", decision }),
  };
}

function questionInteraction(
  item: QuestionItem,
  inputs: AgentComposerInteractionInputs,
): AgentComposerInteraction {
  const { request } = item;
  const controls = controlsOf(item.state);
  return {
    kind: "question",
    key: `question:${request.turnId}:${request.id}`,
    request: questionRequestOf(request),
    attachments: inputs.attachments,
    sending: controls.sending,
    disabled: controls.disabled,
    note: controls.note,
    pendingLabel: controls.pendingLabel,
    error: item.error,
    answer: (response) => inputs.respond(item.key, { kind: "question", answers: response.answers }),
  };
}

function controlsOf(state: AgentThreadPendingRequestState): Controls {
  switch (state.kind) {
    case "answerable":
      return { sending: false, disabled: false, note: null, pendingLabel: null };
    case "sending":
      return { sending: true, disabled: false, note: null, pendingLabel: null };
    case "checking":
      return { sending: true, disabled: false, note: null, pendingLabel: AGENT_REQUEST_CHECKING };
    case "disabled":
      return { sending: false, disabled: true, note: null, pendingLabel: null };
    case "readOnly":
      return { sending: false, disabled: true, note: state.reason, pendingLabel: null };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

function isApproval(item: AgentThreadPendingRequest): item is ApprovalItem {
  return item.request.body.kind === "approval";
}

function isQuestion(item: AgentThreadPendingRequest): item is QuestionItem {
  return item.request.body.kind === "question";
}

function approvalRequestOf(
  request: AgentRuntimeRequest & { readonly body: AgentRuntimeApprovalBody },
): AgentApprovalRequest {
  const { body } = request;
  return {
    id: request.id,
    taskId: request.turnId,
    provider: request.provider,
    kind: body.approvalKind,
    title: body.title,
    detail: body.detail,
    detailTruncated: body.detailTruncated,
    facts: body.facts,
    decisions: body.decisions,
    status: "pending",
  };
}

function questionRequestOf(
  request: AgentRuntimeRequest & { readonly body: AgentRuntimeQuestionBody },
): AgentQuestionRequest {
  return {
    id: request.id,
    taskId: request.turnId,
    provider: request.provider,
    questions: request.body.questions,
    status: "pending",
  };
}

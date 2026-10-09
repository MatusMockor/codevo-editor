import { useLayoutEffect, useMemo, useState } from "react";
import { isAgentApprovalGateway } from "../../../application/agentApprovalPorts";
import type { AgentPendingRequestAvailability } from "../../../application/agentPendingRequestPolling";
import type {
  AgentQuestionGateway,
  AgentQuestionOwner,
} from "../../../application/agentQuestionPorts";
import { useAgentApprovals } from "../../../application/useAgentApprovals";
import { useAgentQuestions } from "../../../application/useAgentQuestions";
import {
  AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE,
  pickAgentComposerInteraction,
  type AgentComposerInteraction,
  type AgentComposerQuestionAttachmentTarget,
} from "./agentComposerInteraction";

export interface AgentComposerInteractionSourceProps {
  readonly gateway: AgentQuestionGateway | null;
  readonly owner: AgentQuestionOwner | null;
  readonly running: boolean;
  readonly availability?: AgentPendingRequestAvailability;
  readonly questionAttachments?: AgentComposerQuestionAttachmentTarget;
  onChange(interaction: AgentComposerInteraction | null): void;
}

const NO_QUESTION_ATTACHMENTS: AgentComposerQuestionAttachmentTarget = {
  kind: "unavailable",
  reason: AGENT_QUESTION_ATTACHMENTS_UNAVAILABLE,
};

export function AgentComposerInteractionSource({
  gateway,
  onChange,
  owner,
  running,
  availability = "available",
  questionAttachments = NO_QUESTION_ATTACHMENTS,
}: AgentComposerInteractionSourceProps) {
  const [ownerLease] = useState(owner);
  const {
    requests: approvalRequests,
    answering: approvalAnswering,
    error: approvalError,
    answer: answerApproval,
  } = useAgentApprovals(
    isAgentApprovalGateway(gateway) ? gateway : null,
    ownerLease,
    running,
    availability,
  );
  const {
    requests: questionRequests,
    answering: questionAnswering,
    error: questionError,
    answer: answerQuestion,
  } = useAgentQuestions(gateway, ownerLease, running, availability);
  const attachmentKind = questionAttachments.kind;
  const attachmentSubject = questionAttachmentSubject(questionAttachments);
  const attachments = useMemo(
    () => questionAttachmentTarget(attachmentKind, attachmentSubject),
    [attachmentKind, attachmentSubject],
  );
  const interaction = useMemo(
    () =>
      pickAgentComposerInteraction({
        approvals: {
          requests: approvalRequests,
          answering: approvalAnswering,
          error: approvalError,
          answer: answerApproval,
        },
        questions: {
          requests: questionRequests,
          attachments,
          answering: questionAnswering,
          error: questionError,
          answer: async (requestId, response) => {
            await answerQuestion(requestId, response);
          },
        },
        running,
      }),
    [
      approvalRequests,
      approvalAnswering,
      approvalError,
      answerApproval,
      questionRequests,
      questionAnswering,
      questionError,
      answerQuestion,
      attachments,
      running,
    ],
  );
  useLayoutEffect(() => {
    onChange(interaction);
  }, [interaction, onChange]);
  useLayoutEffect(() => () => onChange(null), [onChange]);
  return null;
}

function questionAttachmentSubject(target: AgentComposerQuestionAttachmentTarget): string {
  switch (target.kind) {
    case "thread":
      return target.threadId;
    case "unavailable":
      return target.reason;
    default: {
      const exhaustive: never = target;
      return exhaustive;
    }
  }
}

function questionAttachmentTarget(
  kind: AgentComposerQuestionAttachmentTarget["kind"],
  subject: string,
): AgentComposerQuestionAttachmentTarget {
  switch (kind) {
    case "thread":
      return { kind, threadId: subject };
    case "unavailable":
      return { kind, reason: subject };
    default: {
      const exhaustive: never = kind;
      return exhaustive;
    }
  }
}

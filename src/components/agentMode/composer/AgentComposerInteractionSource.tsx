import { useLayoutEffect, useMemo, useState } from "react";
import { isAgentApprovalGateway } from "../../../application/agentApprovalPorts";
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
  questionAttachments = NO_QUESTION_ATTACHMENTS,
}: AgentComposerInteractionSourceProps) {
  const [ownerLease] = useState(owner);
  const {
    requests: approvalRequests,
    answering: approvalAnswering,
    error: approvalError,
    answer: answerApproval,
  } = useAgentApprovals(isAgentApprovalGateway(gateway) ? gateway : null, ownerLease, running);
  const {
    requests: questionRequests,
    answering: questionAnswering,
    error: questionError,
    answer: answerQuestion,
  } = useAgentQuestions(gateway, ownerLease, running);
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
          attachments: questionAttachments,
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
      questionAttachments,
      running,
    ],
  );
  useLayoutEffect(() => {
    onChange(interaction);
  }, [interaction, onChange]);
  useLayoutEffect(() => () => onChange(null), [onChange]);
  return null;
}

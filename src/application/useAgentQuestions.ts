import { useMemo } from "react";
import { isAgentInteractionFeed } from "./agentInteractionPorts";
import { agentInteractionStore } from "./agentInteractionStore";
import {
  sameAgentPendingRequestItems,
  type AgentPendingRequestAvailability,
} from "./agentPendingRequestPolling";
import {
  polledAgentPendingRequestSource,
  pushedAgentPendingRequestSource,
  type AgentPendingRequestSource,
} from "./agentPendingRequestSource";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import {
  useAgentPendingRequests,
  type AgentPendingRequestBinding,
} from "./useAgentPendingRequests";
import {
  parseAgentQuestionResponse,
  type AgentQuestion,
  type AgentQuestionAnswer,
  type AgentQuestionOption,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../domain/agentQuestion";

type QuestionBinding = AgentPendingRequestBinding<AgentQuestionRequest, AgentQuestionResponse>;

const NO_QUESTION_ANSWERS: readonly AgentQuestionAnswer[] = Object.freeze([]);
const QUESTIONS_UNAVAILABLE_NOTICE = "Questions from this agent can't be shown right now.";
const QUESTIONS_RECONNECTING_NOTICE = "Questions could not be refreshed. Reconnecting…";
const ANSWER_FAILURE_NOTICE =
  "The answer could not be confirmed. Retry to safely check or send it.";

export function useAgentQuestions(
  gateway: AgentQuestionGateway | null,
  owner: AgentQuestionOwner | null,
  running: boolean,
  availability: AgentPendingRequestAvailability = "available",
) {
  const polledWhileRunning = owner?.kind === "remote" && running;
  const binding = useMemo(
    () => questionBinding(gateway, owner, polledWhileRunning),
    [gateway, owner, polledWhileRunning],
  );
  return useAgentPendingRequests(binding, availability);
}

function questionBinding(
  gateway: AgentQuestionGateway | null,
  owner: AgentQuestionOwner | null,
  polledWhileRunning: boolean,
): QuestionBinding | null {
  if (!gateway || !owner) return null;
  const source = questionSource(gateway, owner, polledWhileRunning);
  if (!source) return null;
  return {
    source,
    answerFailureNotice: ANSWER_FAILURE_NOTICE,
    sameRequest: sameQuestionRequest,
    admit: (request, response) => parseAgentQuestionResponse(response, request),
    send: (requestId, response) => gateway.answer(owner, requestId, response),
  };
}

function questionSource(
  gateway: AgentQuestionGateway,
  owner: AgentQuestionOwner,
  polledWhileRunning: boolean,
): AgentPendingRequestSource<AgentQuestionRequest> | null {
  switch (owner.kind) {
    case "local":
      if (!isAgentInteractionFeed(gateway)) return null;
      return pushedAgentPendingRequestSource({
        store: agentInteractionStore(gateway),
        owner: { workspaceId: owner.workspaceId, taskId: owner.taskId },
        unreachableNotice: QUESTIONS_UNAVAILABLE_NOTICE,
        select: (snapshot) => snapshot.questions,
      });
    case "remote":
      return polledAgentPendingRequestSource({
        cadence: polledWhileRunning ? "repeating" : "once",
        unreachableNotice: QUESTIONS_RECONNECTING_NOTICE,
        list: () => gateway.list(owner),
      });
    default: {
      const exhaustive: never = owner;
      return exhaustive;
    }
  }
}

function sameQuestionRequest(left: AgentQuestionRequest, right: AgentQuestionRequest): boolean {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.taskId === right.taskId &&
    left.provider === right.provider &&
    sameAgentPendingRequestItems(left.questions, right.questions, sameQuestion) &&
    sameAgentPendingRequestItems(questionAnswers(left), questionAnswers(right), sameQuestionAnswer)
  );
}

function questionAnswers(request: AgentQuestionRequest): readonly AgentQuestionAnswer[] {
  if (request.status !== "answered") return NO_QUESTION_ANSWERS;
  return request.answers;
}

function sameQuestion(left: AgentQuestion, right: AgentQuestion): boolean {
  return (
    left.id === right.id &&
    left.multiple === right.multiple &&
    left.allowCustom === right.allowCustom &&
    left.header === right.header &&
    left.prompt === right.prompt &&
    sameAgentPendingRequestItems(left.options, right.options, sameQuestionOption)
  );
}

function sameQuestionOption(left: AgentQuestionOption, right: AgentQuestionOption): boolean {
  return (
    left.id === right.id && left.label === right.label && left.description === right.description
  );
}

function sameQuestionAnswer(left: AgentQuestionAnswer, right: AgentQuestionAnswer): boolean {
  return (
    left.questionId === right.questionId &&
    left.text === right.text &&
    sameAgentPendingRequestItems(left.optionIds, right.optionIds, Object.is)
  );
}

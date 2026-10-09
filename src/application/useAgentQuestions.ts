import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  agentPendingRequestSnapshotAfterPoll,
  agentPendingRequestSnapshotWhileSuspended,
  emptyAgentPendingRequestSnapshot,
  sameAgentPendingRequestItems,
  startAgentPendingRequestPolling,
  type AgentPendingRequestAvailability,
  type AgentPendingRequestSnapshot,
  type AgentPendingRequestSnapshotPolicy,
} from "./agentPendingRequestPolling";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import {
  parseAgentQuestionResponse,
  type AgentQuestion,
  type AgentQuestionAnswer,
  type AgentQuestionOption,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../domain/agentQuestion";

type Snapshot = AgentPendingRequestSnapshot<AgentQuestionRequest>;

const NO_QUESTION_REQUESTS: readonly AgentQuestionRequest[] = Object.freeze([]);
const NO_QUESTION_ANSWERS: readonly AgentQuestionAnswer[] = Object.freeze([]);
const QUESTION_SNAPSHOTS: AgentPendingRequestSnapshotPolicy<AgentQuestionRequest> = {
  unreachableNotice: "Questions could not be refreshed. Reconnecting…",
  sameRequest: sameQuestionRequest,
};

/** Serial polling survives reconnects, while each selection owns a fresh generation. */
export function useAgentQuestions(
  gateway: AgentQuestionGateway | null,
  owner: AgentQuestionOwner | null,
  running: boolean,
  availability: AgentPendingRequestAvailability = "available",
) {
  const active = useRef<{
    lease: object;
    owner: AgentQuestionOwner;
    busy: boolean;
    revision: number;
  } | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  useLayoutEffect(() => {
    if (!gateway || !owner) {
      active.current = null;
      setSnapshot(null);
      return;
    }
    const scope = { lease: {}, owner, busy: false, revision: 0 };
    active.current = scope;
    setSnapshot(emptyAgentPendingRequestSnapshot(scope.lease));
    return () => {
      if (active.current === scope) active.current = null;
    };
  }, [gateway, owner, running]);

  useLayoutEffect(() => {
    const scope = active.current;
    if (!gateway || !owner || !scope) return;
    if (availability !== "available") {
      setSnapshot((previous) =>
        agentPendingRequestSnapshotWhileSuspended(previous, scope.lease, QUESTION_SNAPSHOTS),
      );
      return;
    }
    return startAgentPendingRequestPolling<AgentQuestionRequest>({
      cadence: running ? "repeating" : "once",
      isCurrent: () => active.current === scope,
      revision: () => scope.revision,
      list: () => gateway.list(owner),
      publish: (outcome) =>
        setSnapshot((previous) =>
          agentPendingRequestSnapshotAfterPoll(previous, scope.lease, outcome, QUESTION_SNAPSHOTS),
        ),
    });
  }, [availability, gateway, owner, running]);

  const answer = useCallback(
    async (requestId: string, response: AgentQuestionResponse) => {
      const scope = active.current;
      if (!gateway || !scope || scope.busy || snapshot?.lease !== scope.lease) return;
      const request = snapshot.requests.find(
        (item) => item.id === requestId && item.status === "pending",
      );
      if (!request) return;
      const validated = parseAgentQuestionResponse(response, request);
      scope.busy = true;
      scope.revision += 1;
      setSnapshot((previous) =>
        previous?.lease === scope.lease
          ? { ...previous, answering: requestId, error: null }
          : previous,
      );
      try {
        const result = await gateway.answer(scope.owner, requestId, validated);
        if (active.current !== scope) return;
        scope.revision += 1;
        setSnapshot((previous) =>
          previous?.lease === scope.lease
            ? {
                ...previous,
                requests: previous.requests.map((item) => (item.id === requestId ? result : item)),
                answering: null,
                error: null,
              }
            : previous,
        );
      } catch (error) {
        if (active.current !== scope) return;
        setSnapshot((previous) =>
          previous?.lease === scope.lease
            ? {
                ...previous,
                answering: null,
                error: "The answer could not be confirmed. Retry to safely check or send it.",
              }
            : previous,
        );
        throw error;
      } finally {
        scope.busy = false;
      }
    },
    [gateway, snapshot],
  );
  const visible = snapshot?.lease === active.current?.lease ? snapshot : null;
  return {
    requests: visible?.requests ?? NO_QUESTION_REQUESTS,
    answering: visible?.answering ?? null,
    error: visible?.error ?? null,
    answer,
  };
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

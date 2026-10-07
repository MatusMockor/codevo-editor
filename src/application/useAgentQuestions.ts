import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  agentPendingRequestSnapshotAfterPoll,
  emptyAgentPendingRequestSnapshot,
  startAgentPendingRequestPolling,
  type AgentPendingRequestSnapshot,
} from "./agentPendingRequestPolling";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import {
  parseAgentQuestionResponse,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../domain/agentQuestion";

type Snapshot = AgentPendingRequestSnapshot<AgentQuestionRequest>;

const QUESTIONS_UNREACHABLE_NOTICE = "Questions could not be refreshed. Reconnecting…";

/** Serial polling survives reconnects, while each selection owns a fresh generation. */
export function useAgentQuestions(
  gateway: AgentQuestionGateway | null,
  owner: AgentQuestionOwner | null,
  running: boolean,
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
    const stopPolling = startAgentPendingRequestPolling<AgentQuestionRequest>({
      cadence: running ? "repeating" : "once",
      isCurrent: () => active.current === scope,
      revision: () => scope.revision,
      list: () => gateway.list(owner),
      publish: (outcome) =>
        setSnapshot((previous) =>
          agentPendingRequestSnapshotAfterPoll(
            previous,
            scope.lease,
            outcome,
            QUESTIONS_UNREACHABLE_NOTICE,
          ),
        ),
    });
    return () => {
      if (active.current === scope) active.current = null;
      stopPolling();
    };
  }, [gateway, owner, running]);

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
    requests: visible?.requests ?? [],
    answering: visible?.answering ?? null,
    error: visible?.error ?? null,
    answer,
  };
}

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import {
  parseAgentQuestionResponse,
  type AgentQuestionRequest,
  type AgentQuestionResponse,
} from "../domain/agentQuestion";

interface Snapshot {
  readonly lease: object;
  readonly requests: readonly AgentQuestionRequest[];
  readonly answering: string | null;
  readonly error: string | null;
}

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
    setSnapshot({ lease: scope.lease, requests: [], answering: null, error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      const revision = scope.revision;
      try {
        const requests = await gateway.list(owner);
        if (active.current !== scope || revision !== scope.revision) return;
        setSnapshot((previous) => ({
          lease: scope.lease,
          requests,
          answering: previous?.answering ?? null,
          error: null,
        }));
      } catch {
        if (active.current !== scope || revision !== scope.revision) return;
        setSnapshot((previous) => ({
          lease: scope.lease,
          requests: previous?.requests ?? [],
          answering: previous?.answering ?? null,
          error: "Questions could not be refreshed. Reconnecting…",
        }));
      } finally {
        if (active.current === scope && running)
          timer = setTimeout(() => {
            void poll();
          }, 1000);
      }
    };
    void poll();
    return () => {
      if (active.current === scope) active.current = null;
      clearTimeout(timer);
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

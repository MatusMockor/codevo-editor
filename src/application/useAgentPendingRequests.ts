import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  agentPendingRequestSnapshotAfterPoll,
  agentPendingRequestSnapshotWhileSuspended,
  emptyAgentPendingRequestSnapshot,
  type AgentPendingRequestAvailability,
  type AgentPendingRequestSnapshot,
  type AgentPendingRequestSnapshotPolicy,
} from "./agentPendingRequestPolling";
import type {
  AgentPendingRequestConfirmations,
  AgentPendingRequestItem,
  AgentPendingRequestSource,
} from "./agentPendingRequestSource";

export interface AgentPendingRequestBinding<Request, Answer> {
  readonly source: AgentPendingRequestSource<Request>;
  readonly answerFailureNotice: string;
  sameRequest(left: Request, right: Request): boolean;
  admit(request: Request, answer: Answer): Answer | null;
  send(requestId: string, answer: Answer): Promise<Request>;
}

export interface AgentPendingRequestsSurface<Request, Answer> {
  readonly requests: readonly Request[];
  readonly answering: string | null;
  readonly error: string | null;
  answer(requestId: string, answer: Answer): Promise<void>;
}

interface Scope<Request> {
  readonly lease: object;
  readonly confirmations: AgentPendingRequestConfirmations<Request>;
  busy: boolean;
  revision: number;
}

const NO_REQUESTS: readonly never[] = Object.freeze([]);

export function useAgentPendingRequests<Request extends AgentPendingRequestItem, Answer>(
  binding: AgentPendingRequestBinding<Request, Answer> | null,
  availability: AgentPendingRequestAvailability,
): AgentPendingRequestsSurface<Request, Answer> {
  const active = useRef<Scope<Request> | null>(null);
  const [snapshot, setSnapshot] = useState<AgentPendingRequestSnapshot<Request> | null>(null);

  useLayoutEffect(() => {
    if (!binding) {
      active.current = null;
      setSnapshot(null);
      return;
    }
    const scope: Scope<Request> = {
      lease: {},
      confirmations: binding.source.confirmations(),
      busy: false,
      revision: 0,
    };
    active.current = scope;
    setSnapshot(emptyAgentPendingRequestSnapshot(scope.lease));
    return () => {
      if (active.current === scope) active.current = null;
    };
  }, [binding]);

  useLayoutEffect(() => {
    const scope = active.current;
    if (!binding || !scope) return;
    const policy: AgentPendingRequestSnapshotPolicy<Request> = {
      unreachableNotice: binding.source.unreachableNotice,
      sameRequest: binding.sameRequest,
    };
    if (availability !== "available") {
      setSnapshot((previous) =>
        agentPendingRequestSnapshotWhileSuspended(previous, scope.lease, policy),
      );
      return;
    }
    return binding.source.start({
      isCurrent: () => active.current === scope,
      revision: () => scope.revision,
      reconcile: (listed) => scope.confirmations.reconcile(listed),
      publish: (outcome) =>
        setSnapshot((previous) =>
          agentPendingRequestSnapshotAfterPoll(previous, scope.lease, outcome, policy),
        ),
    });
  }, [availability, binding]);

  const answer = useCallback(
    async (requestId: string, input: Answer) => {
      const scope = active.current;
      if (!binding || !scope || scope.busy || snapshot?.lease !== scope.lease) return;
      const request = snapshot.requests.find(
        (item) => item.id === requestId && item.status === "pending",
      );
      if (!request) return;
      const admitted = binding.admit(request, input);
      if (admitted === null) return;
      scope.busy = true;
      scope.revision += 1;
      setSnapshot((previous) => withAnswering(previous, scope.lease, requestId));
      try {
        const result = await binding.send(requestId, admitted);
        if (active.current !== scope) return;
        scope.revision += 1;
        scope.confirmations.confirm(requestId, result);
        setSnapshot((previous) => withConfirmedAnswer(previous, scope, requestId, result));
      } catch (error) {
        if (active.current !== scope) return;
        setSnapshot((previous) =>
          withAnswerFailure(previous, scope.lease, binding.answerFailureNotice),
        );
        throw error;
      } finally {
        scope.busy = false;
      }
    },
    [binding, snapshot],
  );

  const visible = snapshot !== null && snapshot.lease === active.current?.lease ? snapshot : null;
  return {
    requests: visible?.requests ?? NO_REQUESTS,
    answering: visible?.answering ?? null,
    error: visible?.error ?? null,
    answer,
  };
}

function withAnswering<Request>(
  previous: AgentPendingRequestSnapshot<Request> | null,
  lease: object,
  requestId: string,
): AgentPendingRequestSnapshot<Request> | null {
  if (previous?.lease !== lease) return previous;
  return { ...previous, answering: requestId, error: null };
}

function withConfirmedAnswer<Request extends AgentPendingRequestItem>(
  previous: AgentPendingRequestSnapshot<Request> | null,
  scope: Scope<Request>,
  requestId: string,
  result: Request,
): AgentPendingRequestSnapshot<Request> | null {
  if (previous?.lease !== scope.lease) return previous;
  return {
    ...previous,
    requests: scope.confirmations.settled(previous.requests, requestId, result),
    answering: null,
    error: null,
  };
}

function withAnswerFailure<Request>(
  previous: AgentPendingRequestSnapshot<Request> | null,
  lease: object,
  notice: string,
): AgentPendingRequestSnapshot<Request> | null {
  if (previous?.lease !== lease) return previous;
  return { ...previous, answering: null, error: notice };
}

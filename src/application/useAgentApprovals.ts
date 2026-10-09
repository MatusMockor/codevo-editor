import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentApprovalGateway, AgentApprovalOwner } from "./agentApprovalPorts";
import {
  AGENT_PENDING_REQUEST_POLL_MS,
  agentPendingRequestSnapshotAfterPoll,
  agentPendingRequestSnapshotWhileSuspended,
  emptyAgentPendingRequestSnapshot,
  sameAgentPendingRequestItems,
  startAgentPendingRequestPolling,
  type AgentPendingRequestAvailability,
  type AgentPendingRequestSnapshot,
  type AgentPendingRequestSnapshotPolicy,
} from "./agentPendingRequestPolling";
import type {
  AgentApprovalDecision,
  AgentApprovalFact,
  AgentApprovalRequest,
} from "../domain/agentApproval";

export const AGENT_APPROVAL_POLL_MS = AGENT_PENDING_REQUEST_POLL_MS;

const NO_APPROVAL_REQUESTS: readonly AgentApprovalRequest[] = Object.freeze([]);
const APPROVAL_SNAPSHOTS: AgentPendingRequestSnapshotPolicy<AgentApprovalRequest> = {
  unreachableNotice: "Approvals could not be refreshed. Reconnecting…",
  sameRequest: sameApprovalRequest,
};

interface Scope {
  readonly lease: object;
  readonly owner: AgentApprovalOwner;
  busy: boolean;
  revision: number;
}

type Snapshot = AgentPendingRequestSnapshot<AgentApprovalRequest>;

export interface AgentApprovalsSurface {
  readonly requests: readonly AgentApprovalRequest[];
  readonly answering: string | null;
  readonly error: string | null;
  answer(requestId: string, decision: AgentApprovalDecision): Promise<void>;
}

export function useAgentApprovals(
  gateway: AgentApprovalGateway | null,
  owner: AgentApprovalOwner | null,
  running: boolean,
  availability: AgentPendingRequestAvailability = "available",
): AgentApprovalsSurface {
  const active = useRef<Scope | null>(null);
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);

  useLayoutEffect(() => {
    if (!gateway || !owner || owner.kind === "remote") {
      active.current = null;
      setSnapshot(null);
      return;
    }
    const scope: Scope = { lease: {}, owner, busy: false, revision: 0 };
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
        agentPendingRequestSnapshotWhileSuspended(previous, scope.lease, APPROVAL_SNAPSHOTS),
      );
      return;
    }
    return startAgentPendingRequestPolling<AgentApprovalRequest>({
      cadence: running ? "repeating" : "once",
      isCurrent: () => active.current === scope,
      revision: () => scope.revision,
      list: () => gateway.listApprovals(owner),
      publish: (outcome) =>
        setSnapshot((previous) =>
          agentPendingRequestSnapshotAfterPoll(previous, scope.lease, outcome, APPROVAL_SNAPSHOTS),
        ),
    });
  }, [availability, gateway, owner, running]);

  const answer = useCallback(
    async (requestId: string, decision: AgentApprovalDecision) => {
      const scope = active.current;
      if (!gateway || !scope || scope.busy || snapshot?.lease !== scope.lease) return;
      const request = snapshot.requests.find(
        (item) => item.id === requestId && item.status === "pending",
      );
      if (!request || !request.decisions.includes(decision)) return;
      scope.busy = true;
      scope.revision += 1;
      setSnapshot((previous) =>
        previous?.lease === scope.lease
          ? { ...previous, answering: requestId, error: null }
          : previous,
      );
      try {
        const result = await gateway.answerApproval(scope.owner, requestId, decision);
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
                error: "The decision could not be confirmed. It may have expired; retry to check.",
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

  const visible = snapshot !== null && snapshot.lease === active.current?.lease ? snapshot : null;
  return {
    requests: visible?.requests ?? NO_APPROVAL_REQUESTS,
    answering: visible?.answering ?? null,
    error: visible?.error ?? null,
    answer,
  };
}

function sameApprovalRequest(left: AgentApprovalRequest, right: AgentApprovalRequest): boolean {
  return (
    left.id === right.id &&
    left.status === right.status &&
    left.taskId === right.taskId &&
    left.provider === right.provider &&
    left.kind === right.kind &&
    approvalDecision(left) === approvalDecision(right) &&
    left.detailTruncated === right.detailTruncated &&
    left.title === right.title &&
    left.detail === right.detail &&
    sameAgentPendingRequestItems(left.decisions, right.decisions, Object.is) &&
    sameAgentPendingRequestItems(left.facts, right.facts, sameApprovalFact)
  );
}

function approvalDecision(request: AgentApprovalRequest): AgentApprovalDecision | null {
  if (request.status !== "approved" && request.status !== "denied") return null;
  return request.decision;
}

function sameApprovalFact(left: AgentApprovalFact, right: AgentApprovalFact): boolean {
  return left.label === right.label && left.value === right.value;
}

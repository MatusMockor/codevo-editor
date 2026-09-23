import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentApprovalGateway, AgentApprovalOwner } from "./agentApprovalPorts";
import type { AgentApprovalDecision, AgentApprovalRequest } from "../domain/agentApproval";

export const AGENT_APPROVAL_POLL_MS = 1000;

interface Scope {
  readonly lease: object;
  readonly owner: AgentApprovalOwner;
  busy: boolean;
  revision: number;
}

interface Snapshot {
  readonly lease: object;
  readonly requests: readonly AgentApprovalRequest[];
  readonly answering: string | null;
  readonly error: string | null;
}

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
    setSnapshot({ lease: scope.lease, requests: [], answering: null, error: null });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const current = () => active.current === scope;
    const poll = async () => {
      const revision = scope.revision;
      try {
        const requests = await gateway.listApprovals(owner);
        if (!current() || revision !== scope.revision) return;
        setSnapshot((previous) => ({
          lease: scope.lease,
          requests,
          answering: previous?.lease === scope.lease ? previous.answering : null,
          error: null,
        }));
      } catch {
        if (!current() || revision !== scope.revision) return;
        setSnapshot((previous) => ({
          lease: scope.lease,
          requests: previous?.lease === scope.lease ? previous.requests : [],
          answering: previous?.lease === scope.lease ? previous.answering : null,
          error: "Approvals could not be refreshed. Reconnecting…",
        }));
      } finally {
        if (current() && running)
          timer = setTimeout(() => {
            void poll();
          }, AGENT_APPROVAL_POLL_MS);
      }
    };
    void poll();
    return () => {
      if (active.current === scope) active.current = null;
      clearTimeout(timer);
    };
  }, [gateway, owner, running]);

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
    requests: visible?.requests ?? [],
    answering: visible?.answering ?? null,
    error: visible?.error ?? null,
    answer,
  };
}

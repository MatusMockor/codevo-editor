import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentPendingInteraction,
  type AgentPendingInteraction,
} from "../domain/agentPendingInteraction";
import { runningTurn } from "../domain/agentThread";
import { isAgentApprovalGateway, type AgentApprovalGateway } from "./agentApprovalPorts";
import { agentQuestionOwner } from "./agentQuestionOwner";
import type { AgentQuestionGateway, AgentQuestionOwner } from "./agentQuestionPorts";
import type { AgentThreadView } from "./agentThreadPorts";

export const AGENT_PENDING_INTERACTION_POLL_MS = 2_000;
export const MAX_AGENT_PENDING_INTERACTION_THREADS = 8;

export interface AgentPendingInteractionTarget {
  readonly threadId: string;
  readonly owner: AgentQuestionOwner;
  readonly key: string;
}

interface PendingObservation {
  readonly key: string;
  readonly pending: AgentPendingInteraction | null;
}

const NONE: ReadonlyMap<string, AgentPendingInteraction> = new Map();
const TARGET_SEPARATOR = "\u0001";
const LIST_SEPARATOR = "\u0002";
const SETTLED: Promise<void> = Promise.resolve();

export function agentPendingInteractionTargets(
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): ReadonlyArray<AgentPendingInteractionTarget> {
  return views
    .filter(
      (view) =>
        view.lifecycle === "running" &&
        view.execution?.kind !== "remote" &&
        runningTurn(view.thread) !== null,
    )
    .flatMap((view) => {
      const owner = agentQuestionOwner(view);
      if (owner === null || owner.kind !== "local") return [];
      const target = { threadId: view.thread.threadId, owner, key: JSON.stringify(owner) };
      return [{ view, target }];
    })
    .sort((left, right) => {
      const pinned =
        Number(right.view.thread.threadId === pinnedThreadId) -
        Number(left.view.thread.threadId === pinnedThreadId);
      if (pinned !== 0) return pinned;
      return right.view.thread.updatedAtEpochMs - left.view.thread.updatedAtEpochMs;
    })
    .slice(0, MAX_AGENT_PENDING_INTERACTION_THREADS)
    .map(({ target }) => target);
}

export function useAgentPendingInteractions(
  gateway: AgentQuestionGateway | null,
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): ReadonlyMap<string, AgentPendingInteraction> {
  const targets = useMemo(
    () => agentPendingInteractionTargets(views, pinnedThreadId),
    [pinnedThreadId, views],
  );
  const signature = targets
    .map((target) => `${target.threadId}${TARGET_SEPARATOR}${target.key}`)
    .sort()
    .join(LIST_SEPARATOR);
  const targetsRef = useRef(targets);
  useLayoutEffect(() => {
    targetsRef.current = targets;
  }, [targets]);
  const inFlightRef = useRef<Promise<void>>(SETTLED);
  const [observed, setObserved] = useState<ReadonlyMap<string, PendingObservation>>(
    () => new Map(),
  );

  useEffect(() => {
    if (gateway === null || signature === "") return;
    const captured = targetsRef.current;
    const approvals = isAgentApprovalGateway(gateway) ? gateway : null;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const request = async <T>(call: () => Promise<T>): Promise<T | null> => {
      await inFlightRef.current;
      if (!alive) return null;
      const pending = call();
      inFlightRef.current = pending.then(
        () => undefined,
        () => undefined,
      );
      return pending;
    };
    const observe = async (target: AgentPendingInteractionTarget) => {
      const approvalRequests = await listApprovals(approvals, target.owner, request);
      if (approvalRequests === null) return null;
      const questionRequests = await request(() => gateway.list(target.owner));
      if (questionRequests === null) return null;
      return agentPendingInteraction(approvalRequests, questionRequests);
    };
    const poll = async (): Promise<void> => {
      const next = new Map<string, PendingObservation>();
      for (const target of captured) {
        try {
          const pending = await observe(target);
          if (!alive) return;
          next.set(target.threadId, { key: target.key, pending });
        } catch {
          if (!alive) return;
        }
      }
      if (!alive) return;
      setObserved((previous) => (sameObservations(previous, next) ? previous : next));
      timer = setTimeout(() => {
        void poll();
      }, AGENT_PENDING_INTERACTION_POLL_MS);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [gateway, signature]);

  const resultSignature = targets
    .flatMap((target) => {
      const seen = observed.get(target.threadId);
      if (seen?.key !== target.key || seen.pending === null) return [];
      return [`${target.threadId}${TARGET_SEPARATOR}${seen.pending}`];
    })
    .join(LIST_SEPARATOR);
  return useMemo(() => pendingInteractionsFromSignature(resultSignature), [resultSignature]);
}

function pendingInteractionsFromSignature(
  signature: string,
): ReadonlyMap<string, AgentPendingInteraction> {
  if (signature === "") return NONE;
  const result = new Map<string, AgentPendingInteraction>();
  for (const entry of signature.split(LIST_SEPARATOR)) {
    const separator = entry.lastIndexOf(TARGET_SEPARATOR);
    const pending = entry.slice(separator + 1);
    if (pending === "approval" || pending === "input")
      result.set(entry.slice(0, separator), pending);
  }
  return result;
}

function sameObservations(
  left: ReadonlyMap<string, PendingObservation>,
  right: ReadonlyMap<string, PendingObservation>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [threadId, observation] of right) {
    const previous = left.get(threadId);
    if (previous?.key !== observation.key || previous.pending !== observation.pending) return false;
  }
  return true;
}

async function listApprovals(
  approvals: AgentApprovalGateway | null,
  owner: AgentQuestionOwner,
  request: <T>(call: () => Promise<T>) => Promise<T | null>,
) {
  if (approvals === null) return [];
  return request(() => approvals.listApprovals(owner));
}

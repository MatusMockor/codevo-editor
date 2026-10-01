import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentPendingInteractionIdentity,
  type AgentPendingInteraction,
  type AgentPendingInteractionIdentity,
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
  readonly pending: AgentPendingInteractionIdentity | null;
}

export interface AgentPendingInteractionObservations {
  readonly pending: ReadonlyMap<string, AgentPendingInteraction>;
  readonly observed: ReadonlyMap<string, AgentPendingInteractionIdentity | null>;
}

const NO_OBSERVATIONS: AgentPendingInteractionObservations = {
  pending: new Map(),
  observed: new Map(),
};
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
  return useAgentPendingInteractionObservations(gateway, views, pinnedThreadId).pending;
}

export function useAgentPendingInteractionObservations(
  gateway: AgentQuestionGateway | null,
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): AgentPendingInteractionObservations {
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
      return agentPendingInteractionIdentity(approvalRequests, questionRequests);
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

  const resultSignature = JSON.stringify(
    targets.flatMap((target) => {
      const seen = observed.get(target.threadId);
      if (seen?.key !== target.key) return [];
      return [[target.threadId, seen.pending?.kind ?? null, seen.pending?.id ?? ""]];
    }),
  );
  return useMemo(() => observationsFromSignature(resultSignature), [resultSignature]);
}

function observationsFromSignature(signature: string): AgentPendingInteractionObservations {
  const entries = JSON.parse(signature) as ReadonlyArray<
    readonly [string, AgentPendingInteraction | null, string]
  >;
  if (entries.length === 0) return NO_OBSERVATIONS;
  const pending = new Map<string, AgentPendingInteraction>();
  const observed = new Map<string, AgentPendingInteractionIdentity | null>();
  for (const [threadId, kind, id] of entries) {
    if (kind === null) {
      observed.set(threadId, null);
      continue;
    }
    pending.set(threadId, kind);
    observed.set(threadId, { kind, id });
  }
  return { pending, observed };
}

function sameObservations(
  left: ReadonlyMap<string, PendingObservation>,
  right: ReadonlyMap<string, PendingObservation>,
): boolean {
  if (left.size !== right.size) return false;
  for (const [threadId, observation] of right) {
    const previous = left.get(threadId);
    if (previous?.key !== observation.key) return false;
    if (previous.pending?.kind !== observation.pending?.kind) return false;
    if (previous.pending?.id !== observation.pending?.id) return false;
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

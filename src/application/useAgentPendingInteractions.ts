import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentPendingInteractionIdentity,
  type AgentPendingInteraction,
  type AgentPendingInteractionIdentity,
} from "../domain/agentPendingInteraction";
import { runningTurn } from "../domain/agentThread";
import { isAgentInteractionFeed } from "./agentInteractionPorts";
import {
  agentInteractionStore,
  type AgentInteractionObservation,
  type AgentInteractionStore,
} from "./agentInteractionStore";
import { agentQuestionOwner } from "./agentQuestionOwner";
import type { AgentLocalQuestionOwner, AgentQuestionGateway } from "./agentQuestionPorts";
import type { AgentThreadView } from "./agentThreadPorts";

export const MAX_AGENT_PENDING_INTERACTION_THREADS = 8;

export interface AgentPendingInteractionTarget {
  readonly threadId: string;
  readonly owner: AgentLocalQuestionOwner;
  readonly key: string;
}

interface PendingObservation {
  readonly key: string;
  readonly pending: AgentPendingInteractionIdentity | null;
}

type ObservedThreads = ReadonlyMap<string, PendingObservation>;

type PublishObservation = (
  target: AgentPendingInteractionTarget,
  observation: AgentInteractionObservation | null,
) => void;

export interface AgentPendingInteractionObservations {
  readonly pending: ReadonlyMap<string, AgentPendingInteraction>;
  readonly observed: ReadonlyMap<string, AgentPendingInteractionIdentity | null>;
}

const NO_OBSERVATIONS: AgentPendingInteractionObservations = {
  pending: new Map(),
  observed: new Map(),
};
const NO_OBSERVED_THREADS: ObservedThreads = new Map();
const TARGET_SEPARATOR = "\u0001";
const LIST_SEPARATOR = "\u0002";

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
  const signature = targets.map(watchKey).sort().join(LIST_SEPARATOR);
  const targetsRef = useRef(targets);
  useLayoutEffect(() => {
    targetsRef.current = targets;
  }, [targets]);
  const store = useMemo(() => interactionStoreOf(gateway), [gateway]);
  const watchesRef = useRef<AgentPendingInteractionWatches | null>(null);
  const [observed, setObserved] = useState<ObservedThreads>(NO_OBSERVED_THREADS);

  useEffect(() => {
    if (store === null) return;
    const watches = new AgentPendingInteractionWatches(store, (target, observation) =>
      setObserved((previous) => withObservation(previous, target, observation)),
    );
    watchesRef.current = watches;
    return () => {
      watchesRef.current = null;
      watches.release();
    };
  }, [store]);

  useEffect(() => {
    watchesRef.current?.follow(targetsRef.current);
  }, [signature, store]);

  const resultSignature = JSON.stringify(
    [...targets].sort(byThreadId).flatMap((target) => {
      const seen = observed.get(target.threadId);
      if (seen?.key !== target.key) return [];
      return [[target.threadId, seen.pending?.kind ?? null, seen.pending?.id ?? ""]];
    }),
  );
  return useMemo(() => observationsFromSignature(resultSignature), [resultSignature]);
}

class AgentPendingInteractionWatches {
  private readonly releases = new Map<string, () => void>();

  constructor(
    private readonly store: AgentInteractionStore,
    private readonly publish: PublishObservation,
  ) {}

  follow(targets: ReadonlyArray<AgentPendingInteractionTarget>): void {
    const wanted = new Map(targets.map((target) => [watchKey(target), target]));
    for (const [key, release] of [...this.releases]) {
      if (wanted.has(key)) continue;
      this.releases.delete(key);
      release();
    }
    for (const [key, target] of wanted) {
      if (this.releases.has(key)) continue;
      this.releases.set(key, this.watch(target));
    }
  }

  release(): void {
    this.follow([]);
  }

  private watch(target: AgentPendingInteractionTarget): () => void {
    const { workspaceId, taskId } = target.owner;
    const unwatch = this.store.watch({ workspaceId, taskId }, (observation) =>
      this.publish(target, observation),
    );
    return () => {
      unwatch();
      this.publish(target, null);
    };
  }
}

function interactionStoreOf(gateway: AgentQuestionGateway | null): AgentInteractionStore | null {
  if (gateway === null || !isAgentInteractionFeed(gateway)) return null;
  return agentInteractionStore(gateway);
}

function watchKey(target: AgentPendingInteractionTarget): string {
  return `${target.threadId}${TARGET_SEPARATOR}${target.key}`;
}

function byThreadId(
  left: AgentPendingInteractionTarget,
  right: AgentPendingInteractionTarget,
): number {
  if (left.threadId < right.threadId) return -1;
  if (left.threadId > right.threadId) return 1;
  return 0;
}

function withObservation(
  previous: ObservedThreads,
  target: AgentPendingInteractionTarget,
  observation: AgentInteractionObservation | null,
): ObservedThreads {
  const seen = previous.get(target.threadId);
  if (observation?.kind !== "observed") {
    if (seen?.key !== target.key) return previous;
    const next = new Map(previous);
    next.delete(target.threadId);
    return next;
  }
  const { approvals, questions } = observation.snapshot;
  const pending = agentPendingInteractionIdentity(approvals, questions);
  if (seen?.key === target.key && sameIdentity(seen.pending, pending)) return previous;
  return new Map(previous).set(target.threadId, { key: target.key, pending });
}

function sameIdentity(
  left: AgentPendingInteractionIdentity | null,
  right: AgentPendingInteractionIdentity | null,
): boolean {
  return left?.kind === right?.kind && left?.id === right?.id;
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

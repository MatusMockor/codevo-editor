import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  agentPendingRuntimeRequestIdentity,
  type AgentPendingInteraction,
  type AgentPendingInteractionIdentity,
} from "../domain/agentPendingInteraction";
import { pendingAgentRuntimeRequests } from "../domain/agentRuntimeRequest";
import {
  agentPendingInteractionTargets,
  type AgentPendingInteractionTarget,
} from "./agentPendingInteractionTargets";
import type { AgentThreadRequestFeed } from "./agentThreadRequestPorts";
import {
  agentThreadRequestStore,
  type AgentThreadRequestObservation,
  type AgentThreadRequestStore,
} from "./agentThreadRequestStore";
import type { AgentThreadView } from "./agentThreadPorts";
import { remoteAgentThreadRequestControl } from "./unifiedAgentThreadRequestFeed";
import { useAgentPendingInteractionDescriptions } from "./useAgentPendingInteractionDescriptions";

export {
  MAX_AGENT_PENDING_INTERACTION_DESCRIBED_LEGACY_THREADS,
  MAX_AGENT_PENDING_INTERACTION_DESCRIBED_REMOTE_THREADS,
  MAX_AGENT_PENDING_INTERACTION_THREADS,
  agentPendingInteractionTargets,
  type AgentPendingInteractionTarget,
} from "./agentPendingInteractionTargets";

interface PendingObservation {
  readonly key: string;
  readonly pending: AgentPendingInteractionIdentity | null;
}

type ObservedThreads = ReadonlyMap<string, PendingObservation>;

type PublishObservation = (
  target: AgentPendingInteractionTarget,
  observation: AgentThreadRequestObservation | null,
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

export function useAgentPendingInteractions(
  feed: AgentThreadRequestFeed | null,
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): ReadonlyMap<string, AgentPendingInteraction> {
  return useAgentPendingInteractionObservations(feed, views, pinnedThreadId).pending;
}

export function useAgentPendingInteractionObservations(
  feed: AgentThreadRequestFeed | null,
  views: ReadonlyArray<AgentThreadView>,
  pinnedThreadId: string | null = null,
): AgentPendingInteractionObservations {
  const describer = remoteAgentThreadRequestControl(feed);
  const targets = useMemo(
    () => agentPendingInteractionTargets(watchableViews(views, describer !== null), pinnedThreadId),
    [describer, pinnedThreadId, views],
  );
  useAgentPendingInteractionDescriptions(describer, targets);
  const signature = targets.map(watchKey).sort().join(LIST_SEPARATOR);
  const targetsRef = useRef(targets);
  useLayoutEffect(() => {
    targetsRef.current = targets;
  }, [targets]);
  const store = useMemo(() => (feed === null ? null : agentThreadRequestStore(feed)), [feed]);
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
    private readonly store: AgentThreadRequestStore,
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
    let live = true;
    const unwatch = this.store.watch(target.scope, [target.turnId], (observation) => {
      if (live) this.publish(target, observation);
    });
    return () => {
      live = false;
      unwatch();
      this.publish(target, null);
    };
  }
}

function watchableViews(
  views: ReadonlyArray<AgentThreadView>,
  describable: boolean,
): ReadonlyArray<AgentThreadView> {
  if (describable) return views;
  return views.filter((view) => view.execution?.kind !== "remote");
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
  observation: AgentThreadRequestObservation | null,
): ObservedThreads {
  const seen = previous.get(target.threadId);
  if (observation?.kind !== "observed") {
    if (seen?.key !== target.key) return previous;
    const next = new Map(previous);
    next.delete(target.threadId);
    return next;
  }
  if (observation.pendingTurnIds.includes(target.turnId)) return previous;
  const pending = agentPendingRuntimeRequestIdentity(
    pendingAgentRuntimeRequests(observation.state),
    target.turnId,
  );
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

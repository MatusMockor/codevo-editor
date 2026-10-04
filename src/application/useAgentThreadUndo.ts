import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { AGENT_THREAD_BULK_CONCURRENCY } from "../domain/agentThreadBulkAction";
import {
  AGENT_THREAD_UNDO_CONFIRM_MS,
  AGENT_THREAD_UNDO_LIMIT,
  AGENT_THREAD_UNDO_VISIBLE_MS,
  agentThreadUndoEntry,
  agentThreadUndoFailureMessage,
  agentThreadUndoItemApplied,
  agentThreadUndoMessage,
  agentThreadUndoObservation,
  agentThreadUndoOfferValid,
  agentThreadUndoReduce,
  idleAgentThreadUndoState,
  agentThreadUndoUnrestoredIds,
  sameAgentThreadUndoPlacement,
  type AgentThreadUndoAction,
  type AgentThreadUndoEvent,
  type AgentThreadUndoExecution,
  type AgentThreadUndoInverse,
  type AgentThreadUndoLookup,
  type AgentThreadUndoOffer,
  type AgentThreadUndoPlacement,
  type AgentThreadUndoState,
  type AgentThreadUndoSubject,
} from "../domain/agentThreadUndo";
import { settleAgentThreadMutation } from "./agentThreadMutationOutcome";
import type {
  AgentTasksNotice,
  AgentThreadMutationResult,
  AgentThreadsSurface,
  AgentThreadView,
} from "./agentThreadPorts";
import { mapWithBoundedConcurrency } from "./boundedConcurrency";

export type AgentThreadUndoPorts = Pick<
  AgentThreadsSurface,
  "togglePin" | "updateThreadOrganization" | "unarchive" | "batchThreadMutations"
>;

export interface AgentThreadUndoOptions {
  readonly ownerKey: string | null;
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly ports: AgentThreadUndoPorts;
  readonly selectedThreadId: string | null;
  selectThread(threadId: string): void;
  reportNotice(notice: AgentTasksNotice): void;
}

export interface AgentThreadUndoCapture {
  readonly blocked: boolean;
  readonly generation: number;
  readonly selectedThreadId: string | null;
  readonly subjects: ReadonlyArray<AgentThreadUndoSubject>;
}

export interface AgentThreadUndoRecorder {
  capture(threadIds: ReadonlyArray<string>): AgentThreadUndoCapture;
  offer(
    action: AgentThreadUndoAction,
    capture: AgentThreadUndoCapture,
    appliedThreadIds?: ReadonlyArray<string>,
  ): boolean;
}

export interface AgentThreadUndoNotification {
  readonly id: number;
  readonly message: string;
  readonly busy: boolean;
}

export interface AgentThreadUndoSurface {
  readonly recorder: AgentThreadUndoRecorder;
  readonly notification: AgentThreadUndoNotification | null;
  undo(): void;
  dismiss(): void;
  setPaused(paused: boolean): void;
}

type RestoreOutcome = "confirmed" | "refused" | "unconfirmed";

interface RestoreProgress {
  readonly id: number;
  readonly confirmed: ReadonlySet<string>;
}

interface StaleRestore {
  readonly placement: AgentThreadUndoPlacement;
  readonly expiresAt: number;
}

const MAX_DETACHED_RESTORES = 8;

type Latest = Pick<
  AgentThreadUndoOptions,
  "threads" | "ports" | "selectedThreadId" | "selectThread" | "reportNotice"
>;

export function useAgentThreadUndo(options: AgentThreadUndoOptions): AgentThreadUndoSurface {
  const { ownerKey, ports, reportNotice, selectThread, selectedThreadId, threads } = options;
  const [state, setState] = useState<AgentThreadUndoState>(() =>
    idleAgentThreadUndoState(ownerKey),
  );
  const [pauseRequested, setPauseRequested] = useState(false);
  const progress = useRef<RestoreProgress | null>(null);
  const detached = useRef(new Set<number>());
  const stale = useRef(new Map<string, StaleRestore>());
  const stateRef = useRef(state);
  const sequence = useRef(0);
  const mounted = useRef(true);
  const latest = useRef<Latest>({ threads, ports, selectedThreadId, selectThread, reportNotice });

  const transition = useCallback((event: AgentThreadUndoEvent) => {
    const next = agentThreadUndoReduce(stateRef.current, event);
    if (next === stateRef.current) return;
    stateRef.current = next;
    if (mounted.current) setState(next);
  }, []);

  useLayoutEffect(() => {
    latest.current = { threads, ports, selectedThreadId, selectThread, reportNotice };
  });

  useLayoutEffect(() => {
    detached.current.clear();
    stale.current.clear();
    progress.current = null;
    transition({ kind: "ownerChanged", ownerKey });
  }, [ownerKey, transition]);

  useEffect(() => {
    if (stale.current.size === 0) return;
    const lookup = agentThreadUndoLookup(threads);
    for (const threadId of [...stale.current.keys()]) {
      const subject = lookup(threadId);
      if (subject === null) stale.current.delete(threadId);
      if (subject !== null) staleRestore(stale.current, subject);
    }
  }, [threads]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const restoringCurrent = useCallback((offer: AgentThreadUndoOffer): boolean => {
    if (!mounted.current) return false;
    const current = stateRef.current;
    if (offer.entry.generation !== current.generation) return false;
    return current.restoring?.entry.id === offer.entry.id;
  }, []);

  const detachedLive = useCallback((offer: AgentThreadUndoOffer): boolean => {
    if (!mounted.current) return false;
    if (offer.entry.generation !== stateRef.current.generation) return false;
    return detached.current.has(offer.entry.id);
  }, []);

  const settleRestoring = useCallback(
    (offer: AgentThreadUndoOffer, unrestored: ReadonlyArray<string>) => {
      const current = restoringCurrent(offer);
      if (!current && !detachedLive(offer)) return;
      detached.current.delete(offer.entry.id);
      if (progress.current?.id === offer.entry.id) progress.current = null;
      transition({ kind: "restored", id: offer.entry.id });
      rememberStaleRestores(stale.current, offer, unrestored, latest.current.threads);
      if (unrestored.length > 0) {
        latest.current.reportNotice({
          kind: "warning",
          message: agentThreadUndoFailureMessage(unrestored.length, offer.entry.items.length),
          action: null,
        });
      }
      if (!current) return;
      const reselect = offer.entry.reselectThreadId;
      if (reselect === null || unrestored.includes(reselect)) return;
      if (latest.current.selectedThreadId === reselect) return;
      latest.current.selectThread(reselect);
    },
    [detachedLive, restoringCurrent, transition],
  );

  const unconfirmedRestores = useCallback(
    (offer: AgentThreadUndoOffer, confirmed: ReadonlySet<string>): ReadonlyArray<string> =>
      agentThreadUndoUnrestoredIds(
        offer.entry,
        agentThreadUndoLookup(latest.current.threads),
      ).filter((threadId) => !confirmed.has(threadId)),
    [],
  );

  const restore = useCallback(
    async (offer: AgentThreadUndoOffer): Promise<void> => {
      const items = offer.entry.items;
      const run = () =>
        mapWithBoundedConcurrency(
          items.map((_item, index) => index),
          AGENT_THREAD_BULK_CONCURRENCY,
          async (index): Promise<RestoreOutcome> => {
            if (!restoringCurrent(offer)) return "refused";
            const lookup = agentThreadUndoLookup(latest.current.threads);
            if (!agentThreadUndoItemApplied(offer, index, lookup)) return "refused";
            const item = items[index];
            if (item === undefined) return "refused";
            return applyAgentThreadUndoInverse(latest.current.ports, item.inverse);
          },
        );
      const outcomes = await settleRestore(latest.current.ports, run, items.length);
      if (!restoringCurrent(offer) && !detachedLive(offer)) return;
      const threadIds = (outcome: RestoreOutcome): ReadonlyArray<string> =>
        items
          .filter((_item, index) => (outcomes[index] ?? "refused") === outcome)
          .map((item) => item.before.identity.threadId);
      const refused = threadIds("refused");
      if (refused.length > 0) {
        settleRestoring(offer, refused);
        return;
      }
      const confirmed = new Set(threadIds("confirmed"));
      if (confirmed.size === items.length) {
        settleRestoring(offer, []);
        return;
      }
      if (!restoringCurrent(offer)) {
        settleRestoring(offer, unconfirmedRestores(offer, confirmed));
        return;
      }
      progress.current = { id: offer.entry.id, confirmed };
    },
    [detachedLive, restoringCurrent, settleRestoring, unconfirmedRestores],
  );

  const capture = useCallback((threadIds: ReadonlyArray<string>): AgentThreadUndoCapture => {
    const subjects = agentThreadUndoSubjects(latest.current.threads, threadIds);
    return {
      blocked: subjects.some((subject) => staleRestore(stale.current, subject)),
      generation: stateRef.current.generation,
      selectedThreadId: latest.current.selectedThreadId,
      subjects,
    };
  }, []);

  const offer = useCallback(
    (
      action: AgentThreadUndoAction,
      captured: AgentThreadUndoCapture,
      appliedThreadIds?: ReadonlyArray<string>,
    ): boolean => {
      if (!mounted.current) return false;
      if (captured.blocked) return false;
      if (captured.generation !== stateRef.current.generation) return false;
      if (!agentThreadUndoSupported(action, latest.current.ports)) return false;
      const entry = agentThreadUndoEntry({
        id: sequence.current + 1,
        generation: captured.generation,
        action,
        subjects: appliedSubjects(captured.subjects, appliedThreadIds),
        selectedThreadId: captured.selectedThreadId,
      });
      if (entry === null) return false;
      sequence.current = entry.id;
      transition({ kind: "recorded", entry });
      return true;
    },
    [transition],
  );

  const undo = useCallback(() => {
    const current = stateRef.current;
    const offered = current.offered;
    if (offered === null || current.restoring !== null) return;
    if (!mounted.current) return;
    const id = offered.entry.id;
    if (offered.entry.generation !== current.generation) {
      transition({ kind: "dropped", id });
      return;
    }
    if (!agentThreadUndoOfferValid(offered, agentThreadUndoLookup(latest.current.threads))) {
      transition({ kind: "dropped", id });
      return;
    }
    transition({ kind: "undone", id });
    if (stateRef.current.restoring !== offered) return;
    progress.current = null;
    void restore(offered);
  }, [restore, transition]);

  const dismiss = useCallback(() => {
    const offered = stateRef.current.offered;
    if (offered === null) return;
    transition({ kind: "dropped", id: offered.entry.id });
  }, [transition]);

  const setPaused = useCallback((paused: boolean) => {
    if (!mounted.current) return;
    setPauseRequested(paused);
  }, []);

  useEffect(() => {
    const { awaiting, offered, restoring } = state;
    if (awaiting === null && offered === null && restoring === null) return;
    const lookup = agentThreadUndoLookup(threads);
    if (restoring !== null && agentThreadUndoUnrestoredIds(restoring.entry, lookup).length === 0) {
      settleRestoring(restoring, []);
    }
    if (offered !== null && !agentThreadUndoOfferValid(offered, lookup)) {
      transition({ kind: "dropped", id: offered.entry.id });
    }
    if (awaiting === null) return;
    const observation = agentThreadUndoObservation(awaiting, lookup);
    if (observation.kind === "pending") return;
    if (observation.kind === "diverged") {
      transition({ kind: "dropped", id: awaiting.id });
      return;
    }
    transition({ kind: "landed", id: awaiting.id, applied: observation.applied });
  }, [settleRestoring, state, threads, transition]);

  const awaitingId = state.awaiting?.id ?? null;
  useEffect(() => {
    if (awaitingId === null) return;
    const timer = setTimeout(
      () => transition({ kind: "dropped", id: awaitingId }),
      AGENT_THREAD_UNDO_CONFIRM_MS,
    );
    return () => clearTimeout(timer);
  }, [awaitingId, transition]);

  const offeredId = state.offered?.entry.id ?? null;
  const restoringId = state.restoring?.entry.id ?? null;
  const held = pauseRequested || restoringId !== null;
  useEffect(() => {
    if (offeredId === null || held) return;
    const timer = setTimeout(
      () => transition({ kind: "dropped", id: offeredId }),
      AGENT_THREAD_UNDO_VISIBLE_MS,
    );
    return () => clearTimeout(timer);
  }, [held, offeredId, transition]);

  useEffect(() => {
    if (restoringId === null) return;
    const timer = setTimeout(() => {
      const restoring = stateRef.current.restoring;
      if (restoring === null || restoring.entry.id !== restoringId) return;
      const tracked = progress.current;
      if (tracked === null || tracked.id !== restoringId) {
        rememberDetached(detached.current, restoringId);
        transition({ kind: "restored", id: restoringId });
        return;
      }
      settleRestoring(restoring, unconfirmedRestores(restoring, tracked.confirmed));
    }, AGENT_THREAD_UNDO_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [restoringId, settleRestoring, transition, unconfirmedRestores]);

  const recorder = useMemo<AgentThreadUndoRecorder>(() => ({ capture, offer }), [capture, offer]);
  const notification = useMemo(
    () => agentThreadUndoNotification(state, ownerKey),
    [ownerKey, state],
  );
  return useMemo(
    () => ({ recorder, notification, undo, dismiss, setPaused }),
    [dismiss, notification, recorder, setPaused, undo],
  );
}

function rememberDetached(detached: Set<number>, id: number): void {
  detached.add(id);
  for (const oldest of detached) {
    if (detached.size <= MAX_DETACHED_RESTORES) return;
    detached.delete(oldest);
  }
}

function rememberStaleRestores(
  stale: Map<string, StaleRestore>,
  offer: AgentThreadUndoOffer,
  unrestored: ReadonlyArray<string>,
  views: ReadonlyArray<AgentThreadView>,
): void {
  const lookup = agentThreadUndoLookup(views);
  const expiresAt = Date.now() + AGENT_THREAD_UNDO_CONFIRM_MS;
  for (const item of offer.entry.items) {
    const threadId = item.before.identity.threadId;
    if (unrestored.includes(threadId)) continue;
    const observed = lookup(threadId);
    if (observed === null) continue;
    if (sameAgentThreadUndoPlacement(observed.placement, item.before.placement)) continue;
    stale.delete(threadId);
    stale.set(threadId, { placement: observed.placement, expiresAt });
  }
  for (const oldest of stale.keys()) {
    if (stale.size <= AGENT_THREAD_UNDO_LIMIT) return;
    stale.delete(oldest);
  }
}

function staleRestore(stale: Map<string, StaleRestore>, subject: AgentThreadUndoSubject): boolean {
  const threadId = subject.identity.threadId;
  const entry = stale.get(threadId);
  if (entry === undefined) return false;
  if (Date.now() < entry.expiresAt) {
    if (sameAgentThreadUndoPlacement(subject.placement, entry.placement)) return true;
  }
  stale.delete(threadId);
  return false;
}

export function agentThreadUndoSubject(view: AgentThreadView): AgentThreadUndoSubject {
  const thread = view.thread;
  return {
    identity: {
      threadId: thread.threadId,
      rootKey: thread.owner.rootKey,
      ownerId: thread.owner.ownerId,
      repositoryRoot: thread.owner.repositoryRoot,
      execution: executionOf(view),
    },
    placement: {
      pinned: thread.pinned,
      archived: thread.archived,
      snoozedUntil: thread.snoozedUntil ?? null,
      settledAt: thread.settledAt ?? null,
      sortOrder: thread.sortOrder ?? null,
    },
  };
}

export function agentThreadUndoSubjects(
  views: ReadonlyArray<AgentThreadView>,
  threadIds: ReadonlyArray<string>,
): ReadonlyArray<AgentThreadUndoSubject> {
  const wanted = new Set(threadIds);
  if (wanted.size === 0) return [];
  return views.filter((view) => wanted.has(view.thread.threadId)).map(agentThreadUndoSubject);
}

export function agentThreadUndoLookup(
  views: ReadonlyArray<AgentThreadView>,
): AgentThreadUndoLookup {
  let byId: ReadonlyMap<string, AgentThreadView> | null = null;
  return (threadId) => {
    byId ??= new Map(views.map((view) => [view.thread.threadId, view]));
    const view = byId.get(threadId);
    if (view === undefined) return null;
    return agentThreadUndoSubject(view);
  };
}

export function agentThreadUndoSupported(
  action: AgentThreadUndoAction,
  ports: AgentThreadUndoPorts,
): boolean {
  switch (action.kind) {
    case "unpin":
      return true;
    case "settle":
    case "snooze":
      return ports.updateThreadOrganization !== undefined;
    case "archive":
      return ports.unarchive !== undefined;
    default:
      return unsupportedAction(action);
  }
}

function agentThreadUndoNotification(
  state: AgentThreadUndoState,
  ownerKey: string | null,
): AgentThreadUndoNotification | null {
  if (state.ownerKey !== ownerKey) return null;
  const offered = state.offered;
  if (offered === null) return null;
  return {
    id: offered.entry.id,
    message: agentThreadUndoMessage(offered.entry.action.kind, offered.entry.items.length),
    busy: state.restoring !== null,
  };
}

function appliedSubjects(
  subjects: ReadonlyArray<AgentThreadUndoSubject>,
  appliedThreadIds: ReadonlyArray<string> | undefined,
): ReadonlyArray<AgentThreadUndoSubject> {
  if (appliedThreadIds === undefined) return subjects;
  const applied = new Set(appliedThreadIds);
  return subjects.filter((subject) => applied.has(subject.identity.threadId));
}

async function settleRestore(
  ports: AgentThreadUndoPorts,
  run: () => Promise<ReadonlyArray<RestoreOutcome>>,
  count: number,
): Promise<ReadonlyArray<RestoreOutcome>> {
  try {
    if (count === 1 || ports.batchThreadMutations === undefined) return await run();
    return await ports.batchThreadMutations(run);
  } catch {
    return Array.from({ length: count }, (): RestoreOutcome => "refused");
  }
}

async function applyAgentThreadUndoInverse(
  ports: AgentThreadUndoPorts,
  inverse: AgentThreadUndoInverse,
): Promise<RestoreOutcome> {
  try {
    return await dispatchInverse(ports, inverse);
  } catch {
    return "refused";
  }
}

function dispatchInverse(
  ports: AgentThreadUndoPorts,
  inverse: AgentThreadUndoInverse,
): Promise<RestoreOutcome> {
  switch (inverse.kind) {
    case "pin":
      return settleInverse(ports.togglePin(inverse.threadId));
    case "unsettle":
      if (ports.updateThreadOrganization === undefined) return Promise.resolve("refused");
      return settleInverse(
        ports.updateThreadOrganization(inverse.threadId, {
          settledAt: null,
          snoozedUntil: inverse.snoozedUntil,
        }),
      );
    case "unsnooze":
      if (ports.updateThreadOrganization === undefined) return Promise.resolve("refused");
      return settleInverse(
        ports.updateThreadOrganization(inverse.threadId, {
          snoozedUntil: inverse.snoozedUntil,
          settledAt: inverse.settledAt,
        }),
      );
    case "unarchive":
      if (ports.unarchive === undefined) return Promise.resolve("refused");
      return settleInverse(ports.unarchive(inverse.threadId));
    default:
      return unsupportedInverse(inverse);
  }
}

async function settleInverse(result: AgentThreadMutationResult | void): Promise<RestoreOutcome> {
  if (result === undefined) return "unconfirmed";
  if (await settleAgentThreadMutation(result)) return "confirmed";
  return "refused";
}

function executionOf(view: AgentThreadView): AgentThreadUndoExecution {
  const execution = view.execution;
  if (execution === undefined) return { kind: "local" };
  return {
    kind: "remote",
    serverId: execution.serverId,
    runnerId: execution.runnerId,
    projectId: execution.projectId,
    conversationId: execution.conversationId,
  };
}

function unsupportedAction(action: never): never {
  throw new TypeError(`Unsupported agent thread undo action: ${JSON.stringify(action)}.`);
}

function unsupportedInverse(inverse: never): never {
  throw new TypeError(`Unsupported agent thread undo inverse: ${JSON.stringify(inverse)}.`);
}

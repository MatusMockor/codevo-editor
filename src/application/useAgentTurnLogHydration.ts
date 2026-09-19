import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import {
  MAX_AGENT_EVENTS_PER_TURN,
  MAX_AGENT_EVENT_BYTES_PER_TURN,
  agentTurnEventUtf8Bytes,
  isTerminalAgentTurnStatus,
  mergeTurnEvents,
  type AgentThread,
  type AgentThreadsAction,
  type AgentThreadsState,
  type AgentTurn,
  type AgentTurnEvent,
} from "../domain/agentThread";
import {
  agentTurnLogProvablyComplete,
  type AgentTurnLogHydration,
} from "../domain/agentTurnContentLoss";
import { planHydratedAgentTurnEvents } from "../domain/agentTurnHydrationCarry";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
} from "../domain/agentTurnLog";
import { attempt, projectByRootKey } from "./agentProjectAuthority";
import { agentTurnLogEvidence } from "./agentTurnLogStatusStore";
import type { AgentTurnLogIntegration } from "./useAgentTurnLogging";

export const MAX_HYDRATED_AGENT_TURNS_PER_THREAD = 8;
export const MAX_HYDRATED_AGENT_THREADS = 3;
export const MAX_AGENT_TURN_HYDRATION_PAGES = 16;

type AgentTurnHydratedAction = Extract<AgentThreadsAction, { kind: "turnHydrated" }>;

export type AgentTurnLogHydrationSource = Pick<AgentTurnLogIntegration, "facts" | "readPage">;

export interface AgentTurnLogHydrationPorts {
  readonly turnLog: () => AgentTurnLogHydrationSource | null;
  readonly projects: () => ReadonlyArray<AgentProjectDescriptor>;
  readonly currentState: () => AgentThreadsState;
  readonly loadKeyOf: (rootKey: string) => string | null;
  readonly mounted: () => boolean;
  readonly publish: (action: AgentTurnHydratedAction) => void;
}

export interface AgentTurnLogHydrator {
  openThread(threadId: string): void;
  cancel(): void;
}

interface ThreadAuthority {
  readonly run: number;
  readonly rootKey: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly loadKey: string;
  readonly threadId: string;
}

interface TurnAuthority extends ThreadAuthority {
  readonly turnId: string;
  readonly order: number;
  readonly events: ReadonlyArray<AgentTurnEvent>;
}

interface HydratedTurnEntry {
  readonly order: number;
  readonly restoreEvents: ReadonlyArray<AgentTurnEvent>;
  readonly publishedEvents: ReadonlyArray<AgentTurnEvent>;
  readonly outcome: AgentTurnLogHydration;
}

type PagesOutcome =
  | { readonly kind: "dropped" }
  | { readonly kind: "failed" }
  | {
      readonly kind: "read";
      readonly events: ReadonlyArray<AgentTurnEvent>;
      readonly hasEarlier: boolean;
    };

export function useAgentTurnLogHydration(
  ports: AgentTurnLogHydrationPorts,
): (threadId: string) => void {
  const portsRef = useRef(ports);
  useLayoutEffect(() => {
    portsRef.current = ports;
  });
  const hydratorRef = useRef<AgentTurnLogHydrator | null>(null);
  if (hydratorRef.current === null) {
    hydratorRef.current = createAgentTurnLogHydrator({
      turnLog: () => portsRef.current.turnLog(),
      projects: () => portsRef.current.projects(),
      currentState: () => portsRef.current.currentState(),
      loadKeyOf: (rootKey) => portsRef.current.loadKeyOf(rootKey),
      mounted: () => portsRef.current.mounted(),
      publish: (action) => portsRef.current.publish(action),
    });
  }
  const hydrator = hydratorRef.current;

  useEffect(() => () => hydrator.cancel(), [hydrator]);

  return useCallback((threadId: string): void => hydrator.openThread(threadId), [hydrator]);
}

export function createAgentTurnLogHydrator(
  ports: AgentTurnLogHydrationPorts,
): AgentTurnLogHydrator {
  const hydrated = new Map<string, Map<string, HydratedTurnEntry>>();
  const inFlight = new Map<string, number>();
  let run = 0;
  let activeThreadId: string | null = null;
  let reopenRequested = false;

  const captureThread = (thread: AgentThread): ThreadAuthority | null => {
    const project = projectByRootKey(ports.projects(), thread.owner.rootKey);
    if (project === undefined) return null;
    const loadKey = ports.loadKeyOf(thread.owner.rootKey);
    if (loadKey === null) return null;
    return {
      run,
      rootKey: thread.owner.rootKey,
      ownerId: thread.owner.ownerId,
      generation: project.generation,
      loadKey,
      threadId: thread.threadId,
    };
  };

  const currentThread = (authority: ThreadAuthority): AgentThread | null => {
    if (!ports.mounted()) return null;
    if (authority.run !== run) return null;
    const project = projectByRootKey(ports.projects(), authority.rootKey);
    if (project === undefined) return null;
    if (project.generation !== authority.generation) return null;
    if (ports.loadKeyOf(authority.rootKey) !== authority.loadKey) return null;
    const thread = ports.currentState().threads.get(authority.threadId);
    if (thread === undefined) return null;
    if (thread.owner.rootKey !== authority.rootKey) return null;
    if (thread.owner.ownerId !== authority.ownerId) return null;
    return thread;
  };

  const currentTurn = (authority: TurnAuthority): AgentTurn | null => {
    const thread = currentThread(authority);
    if (thread === null) return null;
    const turn = thread.turns.find((candidate) => candidate.turnId === authority.turnId);
    if (turn === undefined) return null;
    if (turn.events !== authority.events) return null;
    if (!isTerminalAgentTurnStatus(turn.status)) return null;
    return turn;
  };

  const restoreTurn = (threadId: string, turnId: string, entry: HydratedTurnEntry): void => {
    inFlight.delete(turnId);
    if (!ports.mounted()) return;
    const thread = ports.currentState().threads.get(threadId);
    if (thread === undefined) return;
    const turn = thread.turns.find((candidate) => candidate.turnId === turnId);
    if (turn === undefined) return;
    if (turn.events !== entry.publishedEvents) return;
    if (!isTerminalAgentTurnStatus(turn.status)) return;
    ports.publish({
      kind: "turnHydrated",
      threadId,
      turnId,
      events: entry.restoreEvents,
      hasEarlier: true,
    });
    ports.turnLog()?.facts.publishHydration(turnId, "notAttempted");
  };

  const restoreThread = (threadId: string): void => {
    const entries = hydrated.get(threadId);
    hydrated.delete(threadId);
    if (entries === undefined) return;
    for (const [turnId, entry] of [...entries]) {
      entries.delete(turnId);
      restoreTurn(threadId, turnId, entry);
    }
  };

  const evictThreads = (keep: string): void => {
    while (hydrated.size > MAX_HYDRATED_AGENT_THREADS) {
      const oldest = [...hydrated.keys()].find((threadId) => threadId !== keep);
      if (oldest === undefined) return;
      restoreThread(oldest);
    }
  };

  const remember = (threadId: string, turnId: string, entry: HydratedTurnEntry): void => {
    const entries = hydrated.get(threadId) ?? new Map<string, HydratedTurnEntry>();
    hydrated.delete(threadId);
    entries.delete(turnId);
    entries.set(turnId, entry);
    while (entries.size > MAX_HYDRATED_AGENT_TURNS_PER_THREAD) {
      const oldest = oldestHydratedTurn(entries);
      if (oldest === null) break;
      const stale = entries.get(oldest);
      entries.delete(oldest);
      if (stale !== undefined) restoreTurn(threadId, oldest, stale);
    }
    hydrated.set(threadId, entries);
    evictThreads(threadId);
  };

  const settle = (
    turnLog: AgentTurnLogHydrationSource,
    authority: TurnAuthority,
    hydration: AgentTurnLogHydration,
  ): void => {
    if (inFlight.get(authority.turnId) !== authority.run) return;
    inFlight.delete(authority.turnId);
    turnLog.facts.publishHydration(authority.turnId, hydration);
  };

  const readPages = async (
    turnLog: AgentTurnLogHydrationSource,
    authority: TurnAuthority,
  ): Promise<PagesOutcome> => {
    const scope: AgentTurnLogScope = {
      rootKey: authority.rootKey,
      ownerId: agentRootOwnerId(authority.rootKey),
      threadId: authority.threadId,
      turnId: authority.turnId,
    };
    const pages: Array<ReadonlyArray<AgentTurnEvent>> = [];
    let anchor: AgentTurnLogAnchor = { at: "tail" };
    let count = 0;
    let bytes = 0;
    let hasEarlier = false;
    for (let index = 0; index < MAX_AGENT_TURN_HYDRATION_PAGES; index += 1) {
      const maxEvents = Math.min(
        AGENT_TURN_LOG_LIMITS.pageEvents,
        MAX_AGENT_EVENTS_PER_TURN - count,
      );
      const read = await attempt(() =>
        turnLog.readPage({ scope, anchor, maxEvents, maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes }),
      );
      if (currentTurn(authority) === null) return { kind: "dropped" };
      if (!read.ok) return { kind: "failed" };
      const page = read.value;
      if (!acceptablePage(page, anchor, maxEvents)) return { kind: "failed" };
      const events = page.entries.map((entry) => entry.event);
      pages.unshift(events);
      count += events.length;
      bytes += events.reduce((total, event) => total + agentTurnEventUtf8Bytes(event), 0);
      hasEarlier = page.hasEarlier;
      if (!page.hasEarlier) break;
      if (count >= MAX_AGENT_EVENTS_PER_TURN) break;
      if (bytes >= MAX_AGENT_EVENT_BYTES_PER_TURN) break;
      anchor = { at: "before", seq: page.firstSeq };
    }
    return { kind: "read", events: pages.flat(), hasEarlier };
  };

  const hydrateTurn = async (
    turnLog: AgentTurnLogHydrationSource,
    authority: TurnAuthority,
  ): Promise<void> => {
    inFlight.set(authority.turnId, authority.run);
    turnLog.facts.publishHydration(authority.turnId, "running");
    const outcome = await readPages(turnLog, authority);
    if (outcome.kind === "dropped") return settle(turnLog, authority, "notAttempted");
    if (outcome.kind === "failed") return settle(turnLog, authority, "failed");
    const planned = planHydratedAgentTurnEvents(authority.events, outcome.events);
    const merged = mergeTurnEvents([], planned);
    if (currentTurn(authority) === null) return settle(turnLog, authority, "notAttempted");
    ports.publish({
      kind: "turnHydrated",
      threadId: authority.threadId,
      turnId: authority.turnId,
      events: merged.events,
      hasEarlier: outcome.hasEarlier || merged.truncated,
    });
    const published = ports
      .currentState()
      .threads.get(authority.threadId)
      ?.turns.find((candidate) => candidate.turnId === authority.turnId);
    if (published === undefined) return settle(turnLog, authority, "notAttempted");
    const hydration: AgentTurnLogHydration = published.eventsTruncated ? "partial" : "complete";
    settle(turnLog, authority, hydration);
    remember(authority.threadId, authority.turnId, {
      order: authority.order,
      restoreEvents: authority.events,
      publishedEvents: published.events,
      outcome: hydration,
    });
  };

  const ensureSummaries = async (
    turnLog: AgentTurnLogHydrationSource,
    authority: ThreadAuthority,
    turnIds: ReadonlyArray<string>,
  ): Promise<boolean> => {
    const known =
      turnLog.facts.hasThreadFacts(authority.threadId) &&
      turnIds.every((turnId) => turnLog.facts.factsOf(turnId) !== null);
    if (known) return true;
    await attempt(() => turnLog.facts.ensureThreadFacts(authority.threadId, turnIds));
    return currentThread(authority) !== null;
  };

  const hydrateCandidate = async (
    turnLog: AgentTurnLogHydrationSource,
    authority: ThreadAuthority,
    turnId: string,
  ): Promise<void> => {
    const thread = currentThread(authority);
    if (thread === null) return;
    const order = thread.turns.findIndex((candidate) => candidate.turnId === turnId);
    const turn = thread.turns[order];
    if (turn === undefined || !hydratableTurn(turn)) return;
    const known = hydrated.get(authority.threadId)?.get(turnId);
    if (known !== undefined && known.publishedEvents === turn.events) {
      turnLog.facts.publishHydration(turnId, known.outcome);
      return;
    }
    const evidence = agentTurnLogEvidence(turnLog.facts.factsOf(turnId));
    if (evidence === null) return;
    if (!agentTurnLogProvablyComplete(evidence)) return;
    await hydrateTurn(turnLog, { ...authority, turnId, order, events: turn.events });
  };

  const runThread = async (threadId: string): Promise<void> => {
    const turnLog = ports.turnLog();
    if (turnLog === null) return;
    const thread = ports.currentState().threads.get(threadId);
    if (thread === undefined) return;
    const authority = captureThread(thread);
    if (authority === null) return;
    const evidenceTurnIds = thread.turns.map((turn) => turn.turnId);
    if (!(await ensureSummaries(turnLog, authority, evidenceTurnIds))) return;
    for (const turnId of hydrationCandidates(thread)) {
      if (currentThread(authority) === null) return;
      await hydrateCandidate(turnLog, authority, turnId);
    }
  };

  const start = (threadId: string): void => {
    run += 1;
    const token = run;
    activeThreadId = threadId;
    reopenRequested = false;
    const finish = (): void => {
      if (run !== token) return;
      activeThreadId = null;
      if (!reopenRequested) return;
      if (!ports.mounted()) return;
      start(threadId);
    };
    void runThread(threadId).then(finish, finish);
  };

  const touchThread = (threadId: string): void => {
    const entries = hydrated.get(threadId);
    if (entries === undefined) return;
    hydrated.delete(threadId);
    hydrated.set(threadId, entries);
  };

  return {
    openThread(threadId) {
      touchThread(threadId);
      if (activeThreadId === threadId) {
        reopenRequested = true;
        return;
      }
      start(threadId);
    },
    cancel() {
      run += 1;
      activeThreadId = null;
      reopenRequested = false;
      inFlight.clear();
      hydrated.clear();
    },
  };
}

function oldestHydratedTurn(entries: ReadonlyMap<string, HydratedTurnEntry>): string | null {
  let oldest: string | null = null;
  let order = Number.POSITIVE_INFINITY;
  for (const [turnId, entry] of entries) {
    if (entry.order >= order) continue;
    oldest = turnId;
    order = entry.order;
  }
  return oldest;
}

function hydratableTurn(turn: AgentTurn): boolean {
  if (!turn.eventsTruncated) return false;
  return isTerminalAgentTurnStatus(turn.status);
}

function hydrationCandidates(thread: AgentThread): ReadonlyArray<string> {
  return thread.turns
    .filter(hydratableTurn)
    .map((turn) => turn.turnId)
    .reverse()
    .slice(0, MAX_HYDRATED_AGENT_TURNS_PER_THREAD);
}

function acceptablePage(
  page: AgentTurnLogPage,
  anchor: AgentTurnLogAnchor,
  maxEvents: number,
): boolean {
  if (page.loss.kind !== "none") return false;
  if (page.entries.length === 0) return false;
  if (page.entries.length > maxEvents) return false;
  if (anchor.at !== "before") return true;
  return page.lastSeq < anchor.seq;
}

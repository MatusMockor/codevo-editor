import { useCallback, useLayoutEffect, useRef, useState } from "react";
import {
  MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES,
  agentTurnActivityPageBytes,
  agentTurnActivityPageRejection,
  agentTurnActivityWindowFirstSeq,
  agentTurnActivityWindowLastSeq,
  appendAgentTurnActivityPage,
  openAgentTurnActivityWindow,
  prependAgentTurnActivityPage,
  type AgentTurnActivityWindow,
} from "../domain/agentTurnActivityWindow";
import {
  AGENT_TURN_LOG_LIMITS,
  type AgentTurnLogAnchor,
  type AgentTurnLogPage,
  type AgentTurnLogScope,
  type ReadAgentTurnLogPageRequest,
} from "../domain/agentTurnLog";

export interface AgentHistoryActivitySource {
  readonly scope: AgentTurnLogScope;
  readonly generation: number;
  readonly leaseToken: number | null;
  readPage(request: ReadAgentTurnLogPageRequest): Promise<AgentTurnLogPage>;
}

export type AgentTurnActivityDirection = "earlier" | "later";

export type AgentTurnEarlierActivityState =
  | { readonly kind: "latest" }
  | {
      readonly kind: "loading";
      readonly direction: AgentTurnActivityDirection;
      readonly window: AgentTurnActivityWindow | null;
    }
  | { readonly kind: "ready"; readonly window: AgentTurnActivityWindow }
  | {
      readonly kind: "failed";
      readonly direction: AgentTurnActivityDirection;
      readonly window: AgentTurnActivityWindow | null;
    };

export interface AgentTurnEarlierActivity {
  readonly state: AgentTurnEarlierActivityState;
  loadEarlier(memoryBytes: number): Promise<void>;
  loadLater(): Promise<void>;
  latest(): void;
}

type PageReader = (anchor: AgentTurnLogAnchor) => Promise<AgentTurnLogPage | null>;

type WindowStep =
  | { readonly kind: "window"; readonly window: AgentTurnActivityWindow }
  | { readonly kind: "rejected" }
  | { readonly kind: "dropped" };

interface OwnedState {
  readonly identity: string;
  readonly state: AgentTurnEarlierActivityState;
}

const LATEST: AgentTurnEarlierActivityState = { kind: "latest" };
const REJECTED: WindowStep = { kind: "rejected" };
const DROPPED: WindowStep = { kind: "dropped" };

export function agentTurnActivityWindowOf(
  state: AgentTurnEarlierActivityState,
): AgentTurnActivityWindow | null {
  if (state.kind === "latest") return null;
  return state.window;
}

export function agentHistoryActivitySourceIdentity(
  source: AgentHistoryActivitySource | null,
): string | null {
  if (source === null) return null;
  return JSON.stringify([
    source.scope.rootKey,
    source.scope.ownerId,
    source.scope.threadId,
    source.scope.turnId,
    source.generation,
    source.leaseToken,
  ]);
}

export function useAgentTurnEarlierActivity(
  source: AgentHistoryActivitySource | null,
): AgentTurnEarlierActivity {
  const identity = agentHistoryActivitySourceIdentity(source);
  const currentSource = useRef(source);
  const current = useRef<OwnedState | null>(null);
  const epoch = useRef(0);
  const mounted = useRef(false);
  const [owned, setOwned] = useState<OwnedState | null>(null);

  useLayoutEffect(() => {
    currentSource.current = source;
    if (current.current === null) return;
    if (current.current.identity === identity) return;
    epoch.current += 1;
    current.current = null;
    setOwned(null);
  }, [identity, source]);

  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);

  const latest = useCallback(() => {
    epoch.current += 1;
    current.current = null;
    setOwned(null);
  }, []);

  const load = useCallback(
    async (direction: AgentTurnActivityDirection, memoryBytes: number): Promise<void> => {
      const reader = currentSource.current;
      const owner = agentHistoryActivitySourceIdentity(reader);
      if (!mounted.current || reader === null || owner === null) return;
      const previous = current.current?.identity === owner ? current.current.state : LATEST;
      if (previous.kind === "loading") return;
      const window = agentTurnActivityWindowOf(previous);
      const ticket = ++epoch.current;
      const owns = (): boolean =>
        mounted.current &&
        ticket === epoch.current &&
        agentHistoryActivitySourceIdentity(currentSource.current) === owner;
      const publish = (state: AgentTurnEarlierActivityState): void => {
        const next = { identity: owner, state };
        current.current = next;
        setOwned(next);
      };
      const read: PageReader = async (anchor) => {
        const page = await reader.readPage({
          scope: reader.scope,
          anchor,
          maxEvents: AGENT_TURN_LOG_LIMITS.pageEvents,
          maxBytes: AGENT_TURN_LOG_LIMITS.pageBytes,
        });
        if (agentTurnActivityPageRejection(page, anchor) !== null) return null;
        return page;
      };
      publish({ kind: "loading", direction, window });
      try {
        const step = await nextWindow(direction, window, memoryBytes, read, owns);
        if (step.kind === "dropped") return;
        if (!owns()) return;
        if (step.kind === "rejected") {
          publish({ kind: "failed", direction, window });
          return;
        }
        publish({ kind: "ready", window: step.window });
      } catch {
        if (!owns()) return;
        publish({ kind: "failed", direction, window });
      }
    },
    [],
  );

  const loadEarlier = useCallback((memoryBytes: number) => load("earlier", memoryBytes), [load]);
  const loadLater = useCallback(() => load("later", 0), [load]);
  const state = owned?.identity === identity ? owned.state : LATEST;
  return { state, loadEarlier, loadLater, latest };
}

async function nextWindow(
  direction: AgentTurnActivityDirection,
  window: AgentTurnActivityWindow | null,
  memoryBytes: number,
  read: PageReader,
  owns: () => boolean,
): Promise<WindowStep> {
  if (window === null) return openWindow(read, memoryBytes, owns);
  if (direction === "earlier") return earlierWindow(window, read, owns);
  return laterWindow(window, read, owns);
}

async function openWindow(
  read: PageReader,
  memoryBytes: number,
  owns: () => boolean,
): Promise<WindowStep> {
  let window: AgentTurnActivityWindow | null = null;
  let anchor: AgentTurnLogAnchor = { at: "tail" };
  let readBytes = 0;
  let reached = false;
  for (let index = 0; index < MAX_AGENT_TURN_ACTIVITY_OPEN_PAGES; index += 1) {
    const page = await read(anchor);
    if (!owns()) return DROPPED;
    if (page === null) return REJECTED;
    window =
      window === null
        ? openAgentTurnActivityWindow(page)
        : prependAgentTurnActivityPage(window, page);
    readBytes += agentTurnActivityPageBytes(page);
    if (!page.hasEarlier || page.entries.length === 0) break;
    if (reached) break;
    if (readBytes >= memoryBytes) reached = true;
    anchor = { at: "before", seq: page.firstSeq };
  }
  if (window === null) return REJECTED;
  return { kind: "window", window };
}

async function earlierWindow(
  window: AgentTurnActivityWindow,
  read: PageReader,
  owns: () => boolean,
): Promise<WindowStep> {
  const first = agentTurnActivityWindowFirstSeq(window);
  if (!window.hasEarlier || first === null) return { kind: "window", window };
  const page = await read({ at: "before", seq: first });
  if (!owns()) return DROPPED;
  if (page === null) return REJECTED;
  return { kind: "window", window: prependAgentTurnActivityPage(window, page) };
}

async function laterWindow(
  window: AgentTurnActivityWindow,
  read: PageReader,
  owns: () => boolean,
): Promise<WindowStep> {
  const last = agentTurnActivityWindowLastSeq(window);
  if (!window.hasLater || last === null) return { kind: "window", window };
  const page = await read({ at: "after", seq: last });
  if (!owns()) return DROPPED;
  if (page === null) return REJECTED;
  return { kind: "window", window: appendAgentTurnActivityPage(window, page) };
}

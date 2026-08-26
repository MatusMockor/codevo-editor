import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  AgentThreadSearchSurface,
  AgentThreadsSurface,
  AgentThreadView,
} from "../../application/agentThreadPorts";
import type {
  AgentJumpSlot,
  AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import { useAgentThreadSearch } from "../../application/useAgentThreadSearch";
import { terminalTurnKey } from "./agentComposerLaunch";
import { agentThreadDisplayTitle, type AgentProjectGroup } from "./agentModePresentation";
import { adjacentThreadId, agentThreadsInScope, orderedRailThreadIds } from "./agentModeNavigation";
import {
  agentRailNewThreadTarget,
  agentRailScopeEntries,
  type AgentRailScope,
  type AgentRailScopeEntry,
  type AgentThreadRevealRequest,
} from "./agentSidebarPresentation";
import { useAgentThreadFind, type AgentThreadFindState } from "./useAgentThreadFind";

export type AgentNavigationCommandHandlers = Pick<
  AgentViewCommandHandlers,
  | "previousThread"
  | "nextThread"
  | "jumpToThread"
  | "searchThreads"
  | "findInThread"
  | "threadSelected"
>;

export interface AgentThreadNavigationOptions {
  readonly agents: Pick<AgentThreadsSurface, "threads" | "markThreadViewed">;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
}

export interface AgentThreadPaletteState {
  readonly open: boolean;
  readonly titles: ReadonlyMap<string, string>;
  readonly archivedThreadIds: ReadonlySet<string>;
  activate(threadId: string, reveal: AgentThreadRevealRequest | null): void;
  close(): void;
}

export interface AgentThreadNavigation {
  readonly centerRef: RefObject<HTMLDivElement | null>;
  readonly selectedThreadId: string | null;
  readonly selectedThread: AgentThreadView | null;
  readonly railScope: AgentRailScope;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly search: AgentThreadSearchSurface;
  readonly find: AgentThreadFindState;
  readonly findHitIndex: number | undefined;
  readonly palette: AgentThreadPaletteState;
  readonly commands: AgentNavigationCommandHandlers;
  setRailScope(scope: AgentRailScope): void;
  selectThread(threadId: string, reveal?: AgentThreadRevealRequest): void;
  selectStartedThread(threadId: string): void;
  clearSelectedThread(): void;
  forgetThread(threadId: string): void;
  closeFindBar(): void;
  newThreadTarget(): { readonly projectRootKey: string; readonly repositoryRoot: string } | null;
}

const EMPTY_TITLES: ReadonlyMap<string, string> = new Map();
const EMPTY_IDS: ReadonlySet<string> = new Set();

export function useAgentThreadNavigation({
  agents,
  groups,
}: AgentThreadNavigationOptions): AgentThreadNavigation {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [railScope, setRailScope] = useState<AgentRailScope>({ kind: "all" });
  const [paletteOpen, setPaletteOpen] = useState(false);
  const centerRef = useRef<HTMLDivElement | null>(null);

  const scopeEntries = useMemo(() => agentRailScopeEntries(groups), [groups]);
  const threadViews = agents.threads;
  const scopedViews = useMemo(
    () => agentThreadsInScope(threadViews, railScope),
    [railScope, threadViews],
  );
  const search = useAgentThreadSearch(scopedViews);
  const paletteTitles = useMemo(
    () =>
      paletteOpen
        ? new Map(
            scopedViews.map((view) => [view.thread.threadId, agentThreadDisplayTitle(view.thread)]),
          )
        : EMPTY_TITLES,
    [paletteOpen, scopedViews],
  );
  const archivedThreadIds = useMemo(
    () =>
      paletteOpen
        ? new Set(
            scopedViews.filter((view) => view.thread.archived).map((view) => view.thread.threadId),
          )
        : EMPTY_IDS,
    [paletteOpen, scopedViews],
  );

  const selectedThread =
    threadViews.find((view) => view.thread.threadId === selectedThreadId) ?? null;
  const find = useAgentThreadFind(selectedThread?.thread ?? null);

  const markThreadViewed = agents.markThreadViewed;
  const selectedTerminalKey = terminalTurnKey(selectedThread?.thread ?? null);
  useEffect(() => {
    if (selectedThreadId === null) return;
    markThreadViewed(selectedThreadId);
  }, [markThreadViewed, selectedTerminalKey, selectedThreadId]);

  const selectStartedThread = useCallback((threadId: string) => {
    setSelectedThreadId(threadId);
  }, []);

  const clearSelectedThread = useCallback(() => setSelectedThreadId(null), []);

  const forgetThread = useCallback((threadId: string) => {
    setSelectedThreadId((current) => (current === threadId ? null : current));
  }, []);

  const closeFind = find.close;
  const requestReveal = find.requestReveal;
  const selectThread = useCallback(
    (threadId: string, reveal?: AgentThreadRevealRequest) => {
      setSelectedThreadId(threadId);
      if (reveal !== undefined) {
        requestReveal(reveal);
        return;
      }
      if (threadId !== selectedThreadId) closeFind();
    },
    [closeFind, requestReveal, selectedThreadId],
  );

  const closePalette = useCallback(() => {
    setPaletteOpen(false);
    search.clear();
  }, [search]);

  const activatePaletteResult = useCallback(
    (threadId: string, reveal: AgentThreadRevealRequest | null) => {
      selectThread(threadId, reveal ?? undefined);
      closePalette();
    },
    [closePalette, selectThread],
  );

  const closeFindBar = useCallback(() => {
    closeFind();
    centerRef.current?.querySelector<HTMLElement>(".agent-session__scroll")?.focus();
  }, [closeFind]);

  const orderedThreadIds = useMemo(
    () => orderedRailThreadIds(scopedViews, railScope),
    [railScope, scopedViews],
  );
  const openFind = find.openBar;
  const commands = useMemo<AgentNavigationCommandHandlers>(
    () => ({
      previousThread: () => {
        const next = adjacentThreadId(orderedThreadIds, selectedThreadId, -1);
        if (next !== null) selectThread(next);
      },
      nextThread: () => {
        const next = adjacentThreadId(orderedThreadIds, selectedThreadId, 1);
        if (next !== null) selectThread(next);
      },
      jumpToThread: (slot: AgentJumpSlot) => {
        const next = orderedThreadIds[slot - 1];
        if (next !== undefined) selectThread(next);
      },
      searchThreads: () => setPaletteOpen(true),
      findInThread: () => {
        if (selectedThreadId === null) return;
        openFind();
      },
      threadSelected: () => selectedThreadId !== null,
    }),
    [openFind, orderedThreadIds, selectThread, selectedThreadId],
  );

  const newThreadTarget = useCallback(
    () => agentRailNewThreadTarget(railScope, scopeEntries),
    [railScope, scopeEntries],
  );

  const palette = useMemo<AgentThreadPaletteState>(
    () => ({
      open: paletteOpen,
      titles: paletteTitles,
      archivedThreadIds,
      activate: activatePaletteResult,
      close: closePalette,
    }),
    [activatePaletteResult, archivedThreadIds, closePalette, paletteOpen, paletteTitles],
  );

  return {
    centerRef,
    selectedThreadId,
    selectedThread,
    railScope,
    scopeEntries,
    search,
    find,
    findHitIndex: find.open && find.hitIndex >= 0 ? find.hitIndex : undefined,
    palette,
    commands,
    setRailScope,
    selectThread,
    selectStartedThread,
    clearSelectedThread,
    forgetThread,
    closeFindBar,
    newThreadTarget,
  };
}

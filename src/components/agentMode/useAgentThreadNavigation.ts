import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type {
  AgentThreadSearchSurface,
  AgentThreadsSurface,
  AgentThreadView,
  ExternalSessionsSurface,
} from "../../application/agentThreadPorts";
import type { AgentProjectDescriptor } from "../../domain/agentProject";
import type {
  AgentJumpSlot,
  AgentViewCommandHandlers,
} from "../../application/agentViewCommandBridge";
import { useAgentThreadSearch } from "../../application/useAgentThreadSearch";
import { terminalTurnKey } from "./agentComposerLaunch";
import type { ComposerScope } from "./agentComposerTarget";
import { agentThreadDisplayTitle, type AgentProjectGroup } from "./agentModePresentation";
import { adjacentThreadId, agentThreadsInScope, orderedRailThreadIds } from "./agentModeNavigation";
import {
  agentRailDefaultScopeEntry,
  agentRailNeighbourScopeEntry,
  agentRailNewThreadTarget,
  agentRailScopeEntries,
  agentRailScopeEntryFor,
  agentRailScopeFromEntry,
  agentRailScopeOrder,
  sameAgentRailScopeOrder,
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
> &
  Required<Pick<AgentViewCommandHandlers, "threadFindFocused">>;

export interface AgentThreadNavigationOptions {
  readonly agents: Pick<AgentThreadsSurface, "threads" | "markThreadViewed">;
  readonly presentationThreads: ReadonlyArray<AgentThreadView>;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly externalSessions?: Pick<ExternalSessionsSurface, "close"> | null;
}

export interface AgentThreadPaletteState {
  readonly open: boolean;
  readonly titles: ReadonlyMap<string, string>;
  readonly archivedThreadIds: ReadonlySet<string>;
  activate(threadId: string, reveal: AgentThreadRevealRequest | null): void;
  close(): void;
}

export interface AgentTerminalSessionsTarget {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
}

export interface AgentTerminalSessionsPaletteState {
  readonly open: boolean;
  readonly target: AgentTerminalSessionsTarget | null;
  openFor(projectRootKey: string, repositoryRoot: string): boolean;
  close(): void;
}

export interface AgentThreadNavigation {
  readonly centerRef: RefObject<HTMLDivElement | null>;
  readonly selectedThreadId: string | null;
  readonly selectedThread: AgentThreadView | null;
  readonly railScope: AgentRailScope | null;
  readonly composerScope: ComposerScope | null;
  readonly scopeEntries: ReadonlyArray<AgentRailScopeEntry>;
  readonly search: AgentThreadSearchSurface;
  readonly find: AgentThreadFindState;
  readonly findHitIndex: number | undefined;
  readonly palette: AgentThreadPaletteState;
  readonly terminalSessions: AgentTerminalSessionsPaletteState;
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

interface AgentNavigationScopeAuthority {
  readonly ownerId: string;
  readonly generation: number;
}

interface AgentNavigationScopeState {
  readonly railScope: AgentRailScope | null;
  readonly authority: AgentNavigationScopeAuthority | null;
  readonly order: ReadonlyArray<string>;
}

const NO_SCOPE_STATE: AgentNavigationScopeState = { railScope: null, authority: null, order: [] };

export function useAgentThreadNavigation({
  agents,
  externalSessions = null,
  groups,
  presentationThreads,
  projects,
}: AgentThreadNavigationOptions): AgentThreadNavigation {
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [storedScopeState, setScopeState] = useState<AgentNavigationScopeState>(NO_SCOPE_STATE);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [terminalSessionsTarget, setTerminalSessionsTarget] =
    useState<AgentTerminalSessionsTarget | null>(null);
  const centerRef = useRef<HTMLDivElement | null>(null);

  const externalSessionsRef = useRef(externalSessions);
  externalSessionsRef.current = externalSessions;

  useEffect(() => {
    if (terminalSessionsTarget === null) return;
    if (terminalSessionsTargetIsOpen(terminalSessionsTarget, projects)) return;
    setTerminalSessionsTarget(null);
    externalSessionsRef.current?.close();
  }, [projects, terminalSessionsTarget]);

  const scopeEntries = useMemo(() => agentRailScopeEntries(groups), [groups]);
  const threadViews = agents.threads;
  const selectedThread =
    threadViews.find((view) => view.thread.threadId === selectedThreadId) ?? null;
  const selectedProjectRootKey = selectedThread?.thread.owner.rootKey ?? null;

  const scopeState = reconcileScopeState(
    storedScopeState,
    scopeEntries,
    selectedProjectRootKey,
    projects,
  );
  if (scopeState !== storedScopeState) setScopeState(scopeState);
  const railScope = scopeState.railScope;
  const composerScope = useMemo(
    () => resolveComposerScope(scopeState, projects),
    [projects, scopeState],
  );

  const scopedViews = useMemo(
    () => agentThreadsInScope(threadViews, railScope),
    [railScope, threadViews],
  );
  const scopedPresentationViews = useMemo(
    () => agentThreadsInScope(presentationThreads, railScope),
    [presentationThreads, railScope],
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

  const setRailScope = useCallback(
    (scope: AgentRailScope) => {
      setScopeState((current) => ({
        railScope: scope,
        authority: captureScopeAuthority(scope, projects),
        order: current.order,
      }));
    },
    [projects],
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
    () => orderedRailThreadIds(scopedPresentationViews, railScope),
    [railScope, scopedPresentationViews],
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
      threadFindFocused: () => {
        if (selectedThreadId === null) return false;
        const center = centerRef.current;
        const session = center?.querySelector<HTMLElement>(".agent-session");
        if (session === undefined || session === null) return false;
        const activeElement = session.ownerDocument.activeElement;
        if (session.contains(activeElement)) return true;
        const findBar = center?.querySelector<HTMLElement>(".agent-find");
        return findBar?.contains(activeElement) ?? false;
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

  const openTerminalSessions = useCallback(
    (projectRootKey: string, repositoryRoot: string) => {
      const target: AgentTerminalSessionsTarget = { projectRootKey, repositoryRoot };
      if (!terminalSessionsTargetIsOpen(target, projects)) return false;
      setTerminalSessionsTarget(target);
      return true;
    },
    [projects],
  );
  const closeTerminalSessions = useCallback(() => setTerminalSessionsTarget(null), []);
  const terminalSessions = useMemo<AgentTerminalSessionsPaletteState>(
    () => ({
      open: terminalSessionsTarget !== null,
      target: terminalSessionsTarget,
      openFor: openTerminalSessions,
      close: closeTerminalSessions,
    }),
    [closeTerminalSessions, openTerminalSessions, terminalSessionsTarget],
  );

  return {
    centerRef,
    selectedThreadId,
    selectedThread,
    railScope,
    composerScope,
    scopeEntries,
    search,
    find,
    findHitIndex: find.open && find.hitIndex >= 0 ? find.hitIndex : undefined,
    palette,
    terminalSessions,
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

function terminalSessionsTargetIsOpen(
  target: AgentTerminalSessionsTarget,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): boolean {
  const project = projects.find((candidate) => candidate.rootKey === target.projectRootKey);
  if (project === undefined) return false;
  if (project.origin === "closed-tab-live-tasks") return false;
  return project.repositories.some(
    (repository) => repository.repositoryRoot === target.repositoryRoot,
  );
}

function reconcileScopeState(
  current: AgentNavigationScopeState,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  selectedProjectRootKey: string | null,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): AgentNavigationScopeState {
  const order = agentRailScopeOrder(entries);
  const ordered = sameAgentRailScopeOrder(current.order, order);
  const scope = current.railScope;
  const entry = scope === null ? null : agentRailScopeEntryFor(entries, scope.projectRootKey);
  if (scope !== null && entry !== null && scopeAuthorityIntact(current, scope, projects)) {
    return ordered ? current : { ...current, order };
  }
  const next =
    entry ?? replacementScopeEntry(scope, current.order, entries, selectedProjectRootKey);
  if (next === null) {
    if (scope === null && current.authority === null && ordered) return current;
    return { ...NO_SCOPE_STATE, order };
  }
  const railScope = agentRailScopeFromEntry(next);
  const replacement: AgentNavigationScopeState = {
    railScope,
    authority: captureScopeAuthority(railScope, projects),
    order,
  };
  return sameScopeState(current, replacement) ? current : replacement;
}

function sameScopeState(
  left: AgentNavigationScopeState,
  right: AgentNavigationScopeState,
): boolean {
  if (!sameAgentRailScopeOrder(left.order, right.order)) return false;
  if (left.railScope?.projectRootKey !== right.railScope?.projectRootKey) return false;
  if (left.railScope?.repositoryRoot !== right.railScope?.repositoryRoot) return false;
  if (left.authority?.ownerId !== right.authority?.ownerId) return false;
  return left.authority?.generation === right.authority?.generation;
}

function scopeAuthorityIntact(
  state: AgentNavigationScopeState,
  scope: AgentRailScope,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): boolean {
  const captured = state.authority;
  if (captured === null) return false;
  const live = captureScopeAuthority(scope, projects);
  if (live === null) return false;
  return live.ownerId === captured.ownerId && live.generation === captured.generation;
}

function replacementScopeEntry(
  scope: AgentRailScope | null,
  previousOrder: ReadonlyArray<string>,
  entries: ReadonlyArray<AgentRailScopeEntry>,
  selectedProjectRootKey: string | null,
): AgentRailScopeEntry | null {
  const fallback = agentRailDefaultScopeEntry(entries, selectedProjectRootKey);
  if (scope === null) return fallback;
  return agentRailNeighbourScopeEntry(previousOrder, entries, scope.projectRootKey) ?? fallback;
}

function captureScopeAuthority(
  scope: AgentRailScope,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): AgentNavigationScopeAuthority | null {
  const project = projects.find((candidate) => candidate.rootKey === scope.projectRootKey) ?? null;
  if (project === null) return null;
  if (!project.repositories.some((repo) => repo.repositoryRoot === scope.repositoryRoot)) {
    return null;
  }
  return { ownerId: project.ownerId, generation: project.generation };
}

function resolveComposerScope(
  state: AgentNavigationScopeState,
  projects: ReadonlyArray<AgentProjectDescriptor>,
): ComposerScope | null {
  const scope = state.railScope;
  if (scope === null) return null;
  const missing = {
    kind: "missing" as const,
    projectRootKey: scope.projectRootKey,
    repositoryRoot: scope.repositoryRoot,
  };
  const authority = state.authority;
  if (authority === null) return missing;
  const project = projects.find((candidate) => candidate.rootKey === scope.projectRootKey) ?? null;
  if (project === null) return missing;
  if (project.ownerId !== authority.ownerId || project.generation !== authority.generation) {
    return missing;
  }
  if (!project.repositories.some((repo) => repo.repositoryRoot === scope.repositoryRoot)) {
    return missing;
  }
  return {
    kind: "repository",
    projectRootKey: scope.projectRootKey,
    repositoryRoot: scope.repositoryRoot,
    ownerId: authority.ownerId,
    generation: authority.generation,
  };
}

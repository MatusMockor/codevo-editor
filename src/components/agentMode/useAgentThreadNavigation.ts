import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  AgentThreadSearchSurface,
  AgentThreadsSurface,
  AgentThreadView,
  ExternalSessionsSurface,
} from "../../application/agentThreadPorts";
import { agentProjectOwnsLaunchRoot, type AgentProjectDescriptor } from "../../domain/agentProject";
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
import {
  recalledProjectSelection,
  projectOwnsRememberedThread,
  rememberProjectSelection,
  restorableProjectThread,
  type AgentProjectSelectionMemory,
} from "./agentProjectSelectionMemory";

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
  readonly agents: Pick<AgentThreadsSurface, "threads" | "markThreadViewed" | "historySearch">;
  readonly presentationThreads: ReadonlyArray<AgentThreadView>;
  readonly groups: ReadonlyArray<AgentProjectGroup>;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly externalSessions?: Pick<ExternalSessionsSurface, "close"> | null;
  readonly session?: AgentNavigationSession;
  readonly authoritativeRemoteProjectKeys?: ReadonlySet<string>;
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
  setProjectScope(projectRootKey: string): boolean;
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
  readonly intent: "automatic" | "explicit";
  readonly railScope: AgentRailScope | null;
  readonly authority: AgentNavigationScopeAuthority | null;
  readonly order: ReadonlyArray<string>;
}

export const NO_SCOPE_STATE: AgentNavigationScopeState = {
  intent: "automatic",
  railScope: null,
  authority: null,
  order: [],
};

export interface AgentNavigationSession {
  current: {
    readonly projectSelections?: AgentProjectSelectionMemory;
    readonly selectedThreadId: string | null;
    readonly selectedThreadOwnerKey: string | null;
    readonly scopeState: AgentNavigationScopeState;
  };
}

export function useAgentThreadNavigation({
  agents,
  externalSessions = null,
  groups,
  presentationThreads,
  projects,
  session,
  authoritativeRemoteProjectKeys,
}: AgentThreadNavigationOptions): AgentThreadNavigation {
  const projectSelections = useRef<AgentProjectSelectionMemory>(
    session?.current.projectSelections ?? new Map(),
  );
  const pendingRemoteSelection = useRef(
    session?.current.selectedThreadId?.startsWith("remote-thread:") === true
      ? { id: session.current.selectedThreadId, ownerKey: session.current.selectedThreadOwnerKey }
      : null,
  );
  const [storedSelectedThreadId, setSelectedThreadId] = useState<string | null>(() => {
    const retained = session?.current;
    if (retained === undefined || retained.selectedThreadId === null) return null;
    const thread = agents.threads.find(
      (view) => view.thread.threadId === retained.selectedThreadId,
    );
    if (thread === undefined && pendingRemoteSelection.current !== null)
      return retained.selectedThreadId;
    return thread !== undefined &&
      !thread.thread.archived &&
      JSON.stringify(thread.thread.owner) === retained.selectedThreadOwnerKey
      ? retained.selectedThreadId
      : null;
  });
  const retainedCandidate = agents.threads.find(
    (view) => view.thread.threadId === storedSelectedThreadId,
  );
  const pendingSelection = pendingRemoteSelection.current;
  const retainedOwnerMismatch =
    pendingSelection !== null &&
    retainedCandidate !== undefined &&
    retainedCandidate.thread.threadId === pendingSelection.id &&
    (retainedCandidate.thread.archived ||
      JSON.stringify(retainedCandidate.thread.owner) !== pendingSelection.ownerKey);
  const pendingProjectKey =
    session?.current.selectedThreadId === pendingSelection?.id
      ? session?.current.scopeState.railScope?.projectRootKey
      : undefined;
  const pendingSelectionMissing =
    pendingSelection !== null &&
    retainedCandidate === undefined &&
    [...(authoritativeRemoteProjectKeys ?? [])].some((rootKey) => {
      const retained = projectSelections.current.get(rootKey);
      return (
        retained?.threadId === pendingSelection.id ||
        rootKey === pendingProjectKey ||
        rootKey === rememberedRemoteProjectKey(pendingSelection.ownerKey)
      );
    });
  const selectedThreadId =
    retainedOwnerMismatch || pendingSelectionMissing ? null : storedSelectedThreadId;
  const canMarkSelectedViewed =
    pendingSelection === null || (retainedCandidate !== undefined && !retainedOwnerMismatch);
  useLayoutEffect(() => {
    if (retainedOwnerMismatch || pendingSelectionMissing) {
      pendingRemoteSelection.current = null;
      setSelectedThreadId(null);
    }
  }, [retainedOwnerMismatch, pendingSelectionMissing]);
  const currentProjectsRef = useRef(projects);
  currentProjectsRef.current = projects;
  const [storedScopeState, setScopeState] = useState<AgentNavigationScopeState>(
    () => session?.current.scopeState ?? NO_SCOPE_STATE,
  );
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
  const committedThreadViews = useRef(threadViews);
  useLayoutEffect(() => {
    committedThreadViews.current = threadViews;
  }, [threadViews]);
  const selectedThread =
    threadViews.find((view) => view.thread.threadId === selectedThreadId) ?? null;
  const selectedProjectRootKey =
    selectedThread === null
      ? null
      : (agentRailScopeEntryFor(scopeEntries, selectedThread.thread.owner.rootKey)
          ?.projectRootKey ?? selectedThread.thread.owner.rootKey);
  useLayoutEffect(() => {
    const pending = pendingRemoteSelection.current;
    if (pending === null || selectedThread === null) return;
    pendingRemoteSelection.current = null;
    if (
      selectedThread.thread.threadId === pending.id &&
      JSON.stringify(selectedThread.thread.owner) !== pending.ownerKey
    )
      setSelectedThreadId(null);
  }, [selectedThread]);

  const scopeState = reconcileScopeState(
    storedScopeState,
    scopeEntries,
    selectedProjectRootKey,
    projects,
  );
  if (scopeState !== storedScopeState) setScopeState(scopeState);
  useLayoutEffect(() => {
    const selectedProject = projects.find(
      (project) =>
        project.rootKey === (selectedProjectRootKey ?? scopeState.railScope?.projectRootKey),
    );
    if (selectedProject !== undefined && (selectedThread !== null || selectedThreadId === null)) {
      rememberProjectSelection(
        projectSelections.current,
        selectedProject,
        selectedThread !== null &&
          (selectedThread.thread.archived ||
            !projects.some(
              (member) =>
                (member.rootKey === selectedProject.rootKey ||
                  scopeEntries
                    .find((entry) => entry.projectRootKey === selectedProject.rootKey)
                    ?.memberProjectRootKeys?.includes(member.rootKey)) &&
                projectOwnsRememberedThread(member, selectedThread),
            ))
          ? null
          : selectedThreadId,
        selectedThread === null ? null : JSON.stringify(selectedThread.thread.owner),
      );
    }
    if (session === undefined) return;
    session.current = {
      projectSelections: projectSelections.current,
      selectedThreadId,
      selectedThreadOwnerKey:
        selectedThread === null
          ? (pendingRemoteSelection.current?.ownerKey ?? null)
          : JSON.stringify(selectedThread.thread.owner),
      scopeState,
    };
  }, [
    projects,
    scopeEntries,
    selectedProjectRootKey,
    scopeState,
    selectedThreadId,
    selectedThread,
    session,
  ]);
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
  const search = useAgentThreadSearch(scopedViews, { historySearch: agents.historySearch });
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
    if (selectedThreadId === null || !canMarkSelectedViewed) return;
    markThreadViewed(selectedThreadId);
  }, [canMarkSelectedViewed, markThreadViewed, selectedTerminalKey, selectedThreadId]);

  const closeFind = find.close;
  const requestReveal = find.requestReveal;
  const [pendingSearchReveal, setPendingSearchReveal] = useState<{
    readonly threadId: string;
    readonly owner: string;
    readonly reveal: AgentThreadRevealRequest;
  } | null>(null);
  const selectStartedThread = useCallback((threadId: string) => {
    pendingRemoteSelection.current = null;
    setPendingSearchReveal(null);
    setSelectedThreadId(threadId);
  }, []);

  const clearSelectedThread = useCallback(() => {
    pendingRemoteSelection.current = null;
    setPendingSearchReveal(null);
    setSelectedThreadId(null);
  }, []);

  const forgetThread = useCallback((threadId: string) => {
    for (const [key, selection] of projectSelections.current) {
      if (selection.threadId === threadId) projectSelections.current.delete(key);
    }
    if (pendingRemoteSelection.current?.id === threadId) pendingRemoteSelection.current = null;
    setSelectedThreadId((current) => (current === threadId ? null : current));
  }, []);

  useEffect(() => {
    if (pendingSearchReveal === null) return;
    if (selectedThreadId !== pendingSearchReveal.threadId) {
      setPendingSearchReveal(null);
      return;
    }
    const thread = selectedThread?.thread;
    if (!thread) return;
    if (JSON.stringify(thread.owner) !== pendingSearchReveal.owner) {
      setPendingSearchReveal(null);
      return;
    }
    requestReveal(pendingSearchReveal.reveal);
    setPendingSearchReveal(null);
  }, [pendingSearchReveal, requestReveal, selectedThread, selectedThreadId]);
  const selectThread = useCallback(
    (threadId: string, reveal?: AgentThreadRevealRequest) => {
      pendingRemoteSelection.current = null;
      setSelectedThreadId(threadId);
      const selected = committedThreadViews.current.find(
        (view) => view.thread.threadId === threadId,
      );
      const entry = selected
        ? agentRailScopeEntryFor(scopeEntries, selected.thread.owner.rootKey)
        : null;
      if (entry !== null) {
        const scope = agentRailScopeFromEntry(entry);
        setScopeState((current) => ({
          ...current,
          intent: "automatic",
          railScope: scope,
          authority: captureScopeAuthority(scope, projects),
        }));
      }
      setPendingSearchReveal(null);
      if (reveal !== undefined) {
        const target = committedThreadViews.current.find(
          (view) => view.thread.threadId === threadId,
        );
        if (target)
          setPendingSearchReveal({ threadId, owner: JSON.stringify(target.thread.owner), reveal });
        closeFind();
        return;
      }
      if (threadId !== selectedThreadId) closeFind();
    },
    [closeFind, selectedThreadId, scopeEntries, projects],
  );

  const setRailScope = useCallback(
    (scope: AgentRailScope) => {
      setScopeState((current) => ({
        intent: "explicit",
        railScope: scope,
        authority: captureScopeAuthority(scope, projects),
        order: current.order,
      }));
    },
    [projects],
  );

  const setProjectScope = useCallback(
    (projectRootKey: string) => {
      const captured = projects.find((project) => project.rootKey === projectRootKey);
      const live = currentProjectsRef.current.find((project) => project.rootKey === projectRootKey);
      if (captured === undefined || live === undefined) return false;
      if (captured.ownerId !== live.ownerId || captured.generation !== live.generation)
        return false;
      const entry = agentRailScopeEntryFor(scopeEntries, live.rootKey);
      const railScope =
        entry === null
          ? { projectRootKey: live.rootKey, repositoryRoot: live.rootPath }
          : agentRailScopeFromEntry(entry);
      const authority = captureScopeAuthority(railScope, currentProjectsRef.current);
      if (authority === null) return false;
      if (storedScopeState.railScope?.projectRootKey !== projectRootKey) {
        const retained = restorableProjectThread(
          recalledProjectSelection(projectSelections.current, live),
          live,
          committedThreadViews.current,
          authoritativeRemoteProjectKeys?.has(projectRootKey) ?? false,
          projects.filter((member) => entry?.memberProjectRootKeys?.includes(member.rootKey)),
        );
        pendingRemoteSelection.current = retained?.threadId?.startsWith("remote-thread:")
          ? { id: retained.threadId, ownerKey: retained.threadOwnerKey }
          : null;
        setPendingSearchReveal(null);
        setSelectedThreadId(retained?.threadId ?? null);
      }
      setScopeState((current) => ({
        intent: "automatic",
        railScope,
        authority,
        order: current.order,
      }));
      return true;
    },
    [
      authoritativeRemoteProjectKeys,
      projects,
      scopeEntries,
      storedScopeState.railScope?.projectRootKey,
    ],
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
    setProjectScope,
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
  return agentProjectOwnsLaunchRoot(project, target.repositoryRoot);
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
    const members = entry.memberProjectRootKeys;
    if (JSON.stringify(scope.memberProjectRootKeys) !== JSON.stringify(members))
      return { ...current, order, railScope: agentRailScopeFromEntry(entry) };
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
    intent: entry === null ? "automatic" : current.intent,
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
  if (left.intent !== right.intent) return false;
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
  if (!agentProjectOwnsLaunchRoot(project, scope.repositoryRoot)) return null;
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
  if (!agentProjectOwnsLaunchRoot(project, scope.repositoryRoot)) return missing;
  return {
    kind: state.intent === "automatic" ? "project" : "repository",
    projectRootKey: scope.projectRootKey,
    repositoryRoot: scope.repositoryRoot,
    ownerId: authority.ownerId,
    generation: authority.generation,
  };
}

function rememberedRemoteProjectKey(ownerKey: string | null): string | null {
  if (ownerKey === null || ownerKey.length > 32768) return null;
  try {
    const owner: unknown = JSON.parse(ownerKey);
    if (typeof owner !== "object" || owner === null || !("rootKey" in owner)) return null;
    return typeof owner.rootKey === "string" && owner.rootKey.startsWith("remote:")
      ? owner.rootKey
      : null;
  } catch {
    return null;
  }
}

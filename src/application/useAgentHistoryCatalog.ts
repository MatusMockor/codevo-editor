import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentHistoryTurnPage, ReadAgentHistoryTurnsRequest } from "../domain/agentHistory";
import {
  MAX_AGENT_THREADS_PER_ROOT,
  normalizeAgentThreadTitle,
  runningTurn,
  type AgentThread,
  type AgentThreadsState,
} from "../domain/agentThread";
import type { AgentCliKind } from "../domain/agentTask";
import type {
  AgentHistoryThreadPage,
  ReadAgentHistoryThreadsRequest,
} from "../domain/agentHistoryCatalog";
import { errorMessageOf } from "./agentProjectAuthority";
import { AgentThreadCleanupIncompleteError } from "./agentThreadPorts";

export interface AgentHistoryCatalogGateway {
  readAgentHistoryTurns(request: ReadAgentHistoryTurnsRequest): Promise<AgentHistoryTurnPage>;
  readAgentHistoryThreads(request: ReadAgentHistoryThreadsRequest): Promise<AgentHistoryThreadPage>;
}
export interface AgentHistoryCatalogPage extends AgentHistoryThreadPage {
  readonly rootKey: string;
  readonly loading: boolean;
  readonly deletingThreadId: string | null;
  readonly error: string | null;
  readonly notice: string | null;
}
export interface AgentHistoryCatalogRow {
  readonly threadId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly running: boolean;
  readonly provider: AgentCliKind;
  readonly worktree: boolean;
  readonly updatedAtEpochMs: number;
}
export interface AgentHistoryCatalogSurface {
  readonly projects: ReadonlyArray<{ readonly rootKey: string; readonly label: string }>;
  readonly page: AgentHistoryCatalogPage | null;
  readonly rows: ReadonlyArray<AgentHistoryCatalogRow>;
  choose(rootKey: string): Promise<void>;
  older(): Promise<void>;
  latest(): Promise<void>;
  close(): void;
  open(threadId: string): Promise<boolean>;
  rename(threadId: string, title: string): Promise<boolean>;
  setArchived(threadId: string, archived: boolean): Promise<boolean>;
  remove(threadId: string): Promise<boolean>;
}
interface Dependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly gateway: AgentHistoryCatalogGateway;
  currentState(): AgentThreadsState;
  restoreThread(thread: AgentThread): Promise<boolean>;
  renameThread(threadId: string, title: string): void;
  archiveThread(threadId: string): boolean;
  unarchiveThread(threadId: string): boolean;
  removeThread(threadId: string): boolean;
  deleteSavedThread(thread: AgentThread): Promise<void>;
  reportError(source: string, error: unknown): void;
}
interface OwnedPage {
  readonly identity: string;
  readonly page: AgentHistoryCatalogPage;
}
interface Claim {
  readonly owned: OwnedPage;
  readonly thread: AgentThread;
  readonly project: AgentProjectDescriptor;
  owns(): boolean;
}

type LoadIntent = "open" | "rename" | "archive" | "unarchive";
const FULL_THREAD_LIST_REASON =
  "this project's thread list is full. Archive or delete a thread there first.";

export const SAVED_CONVERSATION_CLEANUP_NOTICE =
  "Deleted, but some attachments could not be removed from this computer.";
export const SAVED_CONVERSATION_RUNNING_DELETE =
  "Stop the agent before deleting this conversation.";
const MAX_FAILURE_REASON_CHARS = 180;

export function useAgentHistoryCatalog(dependencies: Dependencies): AgentHistoryCatalogSurface {
  const deps = useRef(dependencies);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const current = useRef<OwnedPage | null>(null);
  const [state, setState] = useState<OwnedPage | null>(null);
  const close = useCallback(() => {
    epoch.current += 1;
    current.current = null;
    setState(null);
  }, []);
  useLayoutEffect(() => {
    deps.current = dependencies;
    const owned = current.current;
    if (owned && identityFor(dependencies, owned.page.rootKey) !== owned.identity) close();
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      epoch.current += 1;
    };
  }, []);
  const publish = useCallback((owned: OwnedPage) => {
    current.current = owned;
    setState(owned);
  }, []);
  const read = useCallback(
    async (rootKey: string, beforeThreadId: string | null, notice: string | null = null) => {
      const identity = identityFor(deps.current, rootKey);
      if (!mounted.current || identity === null) return;
      const ticket = ++epoch.current;
      const previous = current.current?.identity === identity ? current.current.page : null;
      const initial: AgentHistoryCatalogPage = {
        rootKey,
        threads: previous?.threads ?? [],
        beforeThreadId: previous?.beforeThreadId ?? null,
        hasEarlier: previous?.hasEarlier ?? false,
        loading: true,
        deletingThreadId: null,
        error: null,
        notice,
      };
      publish({ identity, page: initial });
      const owns = () =>
        mounted.current &&
        ticket === epoch.current &&
        identityFor(deps.current, rootKey) === identity;
      try {
        const page = await deps.current.gateway.readAgentHistoryThreads({
          rootKey,
          ownerId: agentRootOwnerId(rootKey),
          beforeThreadId,
        });
        if (!owns()) return;
        publish({
          identity,
          page: {
            ...page,
            rootKey,
            loading: false,
            deletingThreadId: null,
            error: null,
            notice,
          },
        });
      } catch (error) {
        if (!owns()) return;
        deps.current.reportError("Saved conversations", error);
        if (!owns()) return;
        publish({
          identity,
          page: {
            ...initial,
            loading: false,
            error: "Could not load saved conversations. Try again.",
          },
        });
      }
    },
    [publish],
  );
  const choose = useCallback((rootKey: string) => read(rootKey, null), [read]);
  const latest = useCallback(async () => {
    const page = current.current?.page;
    if (page && page.deletingThreadId === null) await read(page.rootKey, null);
  }, [read]);
  const older = useCallback(async () => {
    const page = current.current?.page;
    if (page && page.hasEarlier && !busy(page)) await read(page.rootKey, page.beforeThreadId);
  }, [read]);

  const claim = useCallback((threadId: string): Claim | null => {
    const owned = current.current;
    if (
      !mounted.current ||
      !owned ||
      busy(owned.page) ||
      identityFor(deps.current, owned.page.rootKey) !== owned.identity
    )
      return null;
    const thread = owned.page.threads.find((candidate) => candidate.threadId === threadId);
    const project = deps.current.projects.find(
      (candidate) => candidate.rootKey === owned.page.rootKey,
    );
    if (!thread || !project) return null;
    const ticket = ++epoch.current;
    const owns = () =>
      mounted.current &&
      epoch.current === ticket &&
      identityFor(deps.current, project.rootKey) === owned.identity;
    return { owned, thread, project, owns };
  }, []);
  const settle = useCallback(
    (claimed: Claim, patch: (page: AgentHistoryCatalogPage) => AgentHistoryCatalogPage) => {
      if (!claimed.owns()) return;
      const latestOwned = current.current ?? claimed.owned;
      publish({ identity: claimed.owned.identity, page: patch(latestOwned.page) });
    },
    [publish],
  );
  const fail = useCallback(
    (claimed: Claim, error: string) =>
      settle(claimed, (page) => ({ ...page, error, notice: null })),
    [settle],
  );

  const load = useCallback(
    async (claimed: Claim, intent: LoadIntent): Promise<boolean> => {
      const { thread, project } = claimed;
      const state = deps.current.currentState();
      const live = state.threads.get(thread.threadId);
      if (live !== undefined) return live.owner.rootKey === project.rootKey;
      if (intent !== "open" && rootIsFull(state, project.rootKey)) {
        fail(claimed, `Could not ${intent} this conversation: ${FULL_THREAD_LIST_REASON}`);
        return false;
      }
      try {
        const latestTurns = await deps.current.gateway.readAgentHistoryTurns({
          rootKey: project.rootKey,
          ownerId: agentRootOwnerId(project.rootKey),
          threadId: thread.threadId,
          beforeTurnId: null,
        });
        if (!claimed.owns()) return false;
        if (thread.historyRevision !== latestTurns.revision) {
          fail(claimed, "This conversation changed. Refresh saved conversations and try again.");
          return false;
        }
        const restored = await deps.current.restoreThread({
          ...thread,
          turns: latestTurns.turns,
          historyRevision: latestTurns.revision,
          turnsTruncated: latestTurns.hasEarlier,
          owner: { ...thread.owner, ownerId: project.ownerId },
        });
        if (!claimed.owns()) return false;
        if (!restored)
          fail(
            claimed,
            `Could not ${intent} this conversation. Finish active work or unpin a conversation, then try again.`,
          );
        return restored;
      } catch (error) {
        if (!claimed.owns()) return false;
        deps.current.reportError("Open saved conversation", error);
        fail(claimed, `Could not ${intent} this conversation. Try again.`);
        return false;
      }
    },
    [fail],
  );

  const open = useCallback(
    async (threadId: string): Promise<boolean> => {
      const claimed = claim(threadId);
      if (claimed === null) return false;
      const opened = await load(claimed, "open");
      return opened && claimed.owns();
    },
    [claim, load],
  );

  const rename = useCallback(
    async (threadId: string, title: string): Promise<boolean> => {
      const normalized = normalizeAgentThreadTitle(title);
      if (normalized === null) return false;
      const claimed = claim(threadId);
      if (claimed === null) return false;
      if (!(await load(claimed, "rename")) || !claimed.owns()) return false;
      deps.current.renameThread(threadId, normalized);
      const renamed = deps.current.currentState().threads.get(threadId)?.title === normalized;
      if (!renamed) {
        fail(claimed, "Could not rename this conversation. Try again.");
        return false;
      }
      settle(claimed, (page) => ({
        ...page,
        error: null,
        notice: null,
        threads: page.threads.map((thread) =>
          thread.threadId === threadId ? { ...thread, title: normalized } : thread,
        ),
      }));
      return true;
    },
    [claim, fail, load, settle],
  );

  const setArchived = useCallback(
    async (threadId: string, archived: boolean): Promise<boolean> => {
      const claimed = claim(threadId);
      if (claimed === null) return false;
      if (!(await load(claimed, archived ? "archive" : "unarchive")) || !claimed.owns())
        return false;
      if (archived) deps.current.archiveThread(threadId);
      else deps.current.unarchiveThread(threadId);
      const changed = deps.current.currentState().threads.get(threadId)?.archived === archived;
      if (!changed) {
        fail(
          claimed,
          archived
            ? "Could not archive this conversation. Stop the agent first, then try again."
            : "Could not unarchive this conversation. Try again.",
        );
        return false;
      }
      settle(claimed, (page) => ({
        ...page,
        error: null,
        notice: null,
        threads: page.threads.map((thread) =>
          thread.threadId === threadId ? { ...thread, archived } : thread,
        ),
      }));
      return true;
    },
    [claim, fail, load, settle],
  );

  const remove = useCallback(
    async (threadId: string): Promise<boolean> => {
      const claimed = claim(threadId);
      if (claimed === null) return false;
      const hadEarlier = claimed.owned.page.hasEarlier;
      const dropped = (notice: string | null): boolean => {
        settle(claimed, (page) => withoutRow(page, threadId, notice));
        const remaining = current.current?.page;
        if (claimed.owns() && hadEarlier && remaining?.threads.length === 0)
          void read(claimed.project.rootKey, null, notice);
        return true;
      };
      const live = deps.current.currentState().threads.get(threadId);
      if (live !== undefined) {
        if (live.owner.rootKey !== claimed.project.rootKey) return false;
        if (runningTurn(live) !== null) {
          fail(claimed, SAVED_CONVERSATION_RUNNING_DELETE);
          return false;
        }
        if (!deps.current.removeThread(threadId)) {
          fail(claimed, "Could not delete this conversation. Try again.");
          return false;
        }
        return dropped(null);
      }
      settle(claimed, (page) => ({
        ...page,
        deletingThreadId: threadId,
        error: null,
        notice: null,
      }));
      try {
        await deps.current.deleteSavedThread({
          ...claimed.thread,
          owner: { ...claimed.thread.owner, ownerId: claimed.project.ownerId },
        });
      } catch (error) {
        deps.current.reportError("Delete saved conversation", error);
        if (error instanceof AgentThreadCleanupIncompleteError)
          return dropped(SAVED_CONVERSATION_CLEANUP_NOTICE);
        settle(claimed, (page) => ({
          ...page,
          deletingThreadId: null,
          error: `Could not delete this conversation: ${failureReason(error)}`,
        }));
        return false;
      }
      return dropped(null);
    },
    [claim, fail, read, settle],
  );

  const page =
    state && identityFor(dependencies, state.page.rootKey) === state.identity ? state.page : null;
  return {
    projects: dependencies.projects.map(({ rootKey, label }) => ({ rootKey, label })),
    page,
    rows: page === null ? [] : catalogRows(page, dependencies.currentState()),
    choose,
    older,
    latest,
    close,
    open,
    rename,
    setArchived,
    remove,
  };
}

function busy(page: AgentHistoryCatalogPage): boolean {
  return page.loading || page.deletingThreadId !== null;
}

function rootIsFull(state: AgentThreadsState, rootKey: string): boolean {
  let count = 0;
  for (const thread of state.threads.values()) {
    if (thread.owner.rootKey === rootKey) count += 1;
  }
  return count >= MAX_AGENT_THREADS_PER_ROOT;
}

function withoutRow(
  page: AgentHistoryCatalogPage,
  threadId: string,
  notice: string | null,
): AgentHistoryCatalogPage {
  const threads = page.threads.filter((thread) => thread.threadId !== threadId);
  return {
    ...page,
    threads,
    beforeThreadId: threads[threads.length - 1]?.threadId ?? null,
    hasEarlier: threads.length > 0 && page.hasEarlier,
    deletingThreadId: null,
    error: null,
    notice,
  };
}

function catalogRows(
  page: AgentHistoryCatalogPage,
  state: AgentThreadsState,
): ReadonlyArray<AgentHistoryCatalogRow> {
  return page.threads.map((saved) => {
    const live = state.threads.get(saved.threadId);
    const thread = live !== undefined && live.owner.rootKey === page.rootKey ? live : saved;
    return {
      threadId: thread.threadId,
      title: thread.title,
      archived: thread.archived,
      running: live !== undefined && runningTurn(live) !== null,
      provider: thread.provider.kind,
      worktree: thread.target.isolation === "worktree",
      updatedAtEpochMs: thread.updatedAtEpochMs,
    };
  });
}

function failureReason(error: unknown): string {
  const message = errorMessageOf(error).replace(/\s+/gu, " ").trim();
  if (message === "") return "Try again.";
  const characters = Array.from(message);
  if (characters.length <= MAX_FAILURE_REASON_CHARS) return message;
  return `${characters.slice(0, MAX_FAILURE_REASON_CHARS - 1).join("")}…`;
}

function identityFor(deps: Dependencies, rootKey: string): string | null {
  const project = deps.projects.find((candidate) => candidate.rootKey === rootKey);
  return project
    ? JSON.stringify([project.rootKey, project.ownerId, project.generation, project.leaseToken])
    : null;
}

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { agentRootOwnerId, type AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentHistoryTurnPage, ReadAgentHistoryTurnsRequest } from "../domain/agentHistory";
import type { AgentThread, AgentThreadsState } from "../domain/agentThread";
import type {
  AgentHistoryThreadPage,
  ReadAgentHistoryThreadsRequest,
} from "../domain/agentHistoryCatalog";

export interface AgentHistoryCatalogGateway {
  readAgentHistoryTurns(request: ReadAgentHistoryTurnsRequest): Promise<AgentHistoryTurnPage>;
  readAgentHistoryThreads(request: ReadAgentHistoryThreadsRequest): Promise<AgentHistoryThreadPage>;
}
export interface AgentHistoryCatalogPage extends AgentHistoryThreadPage {
  readonly rootKey: string;
  readonly loading: boolean;
  readonly error: string | null;
}
export interface AgentHistoryCatalogSurface {
  readonly projects: ReadonlyArray<{ readonly rootKey: string; readonly label: string }>;
  readonly page: AgentHistoryCatalogPage | null;
  choose(rootKey: string): Promise<void>;
  older(): Promise<void>;
  latest(): Promise<void>;
  close(): void;
  open(threadId: string): Promise<boolean>;
}
interface Dependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly gateway: AgentHistoryCatalogGateway;
  currentState(): AgentThreadsState;
  restoreThread(thread: AgentThread): Promise<boolean>;
  reportError(source: string, error: unknown): void;
}
interface OwnedPage {
  readonly identity: string;
  readonly page: AgentHistoryCatalogPage;
}
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
  const read = useCallback(async (rootKey: string, beforeThreadId: string | null) => {
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
      error: null,
    };
    const publish = (page: AgentHistoryCatalogPage) => {
      const owned = { identity, page };
      current.current = owned;
      setState(owned);
    };
    publish(initial);
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
      publish({ ...page, rootKey, loading: false, error: null });
    } catch (error) {
      if (!owns()) return;
      deps.current.reportError("Saved conversations", error);
      if (!owns()) return;
      publish({
        ...initial,
        loading: false,
        error: "Could not load saved conversations. Try again.",
      });
    }
  }, []);
  const choose = useCallback((rootKey: string) => read(rootKey, null), [read]);
  const latest = useCallback(async () => {
    const page = current.current?.page;
    if (page) await read(page.rootKey, null);
  }, [read]);
  const older = useCallback(async () => {
    const page = current.current?.page;
    if (page && page.hasEarlier && !page.loading) await read(page.rootKey, page.beforeThreadId);
  }, [read]);
  const open = useCallback(async (threadId: string): Promise<boolean> => {
    const owned = current.current;
    if (
      !mounted.current ||
      !owned ||
      owned.page.loading ||
      identityFor(deps.current, owned.page.rootKey) !== owned.identity
    )
      return false;
    const thread = owned.page.threads.find((candidate) => candidate.threadId === threadId);
    const project = deps.current.projects.find(
      (candidate) => candidate.rootKey === owned.page.rootKey,
    );
    if (!thread || !project) return false;
    const ticket = ++epoch.current;
    const owns = () =>
      mounted.current &&
      epoch.current === ticket &&
      identityFor(deps.current, project.rootKey) === owned.identity;
    try {
      const latest = await deps.current.gateway.readAgentHistoryTurns({
        rootKey: project.rootKey,
        ownerId: agentRootOwnerId(project.rootKey),
        threadId,
        beforeTurnId: null,
      });
      if (!owns()) return false;
      if (thread.historyRevision !== latest.revision) {
        const changed = {
          ...owned,
          page: {
            ...owned.page,
            error: "This conversation changed. Refresh saved conversations and try again.",
          },
        };
        current.current = changed;
        setState(changed);
        return false;
      }
      const restored = await deps.current.restoreThread({
        ...thread,
        turns: latest.turns,
        historyRevision: latest.revision,
        turnsTruncated: latest.hasEarlier,
        owner: { ...thread.owner, ownerId: project.ownerId },
      });
      if (!owns()) return false;
      if (!restored) {
        const failed = {
          ...owned,
          page: {
            ...owned.page,
            error:
              "Could not open this conversation. Finish active work or unpin a conversation, then try again.",
          },
        };
        current.current = failed;
        setState(failed);
      }
      return restored;
    } catch (error) {
      if (owns()) {
        deps.current.reportError("Open saved conversation", error);
        if (owns()) {
          const failed = {
            ...owned,
            page: { ...owned.page, error: "Could not open this conversation. Try again." },
          };
          current.current = failed;
          setState(failed);
        }
      }
      return false;
    }
  }, []);
  return {
    projects: dependencies.projects.map(({ rootKey, label }) => ({ rootKey, label })),
    page:
      state && identityFor(dependencies, state.page.rootKey) === state.identity ? state.page : null,
    choose,
    older,
    latest,
    close,
    open,
  };
}
function identityFor(deps: Dependencies, rootKey: string): string | null {
  const project = deps.projects.find((candidate) => candidate.rootKey === rootKey);
  return project
    ? JSON.stringify([project.rootKey, project.ownerId, project.generation, project.leaseToken])
    : null;
}

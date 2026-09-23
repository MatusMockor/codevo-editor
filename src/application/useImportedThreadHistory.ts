import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { AgentThread, AgentThreadsAction, AgentThreadsState } from "../domain/agentThread";
import {
  parseExternalAgentSessionHistory,
  type ExternalAgentSessionHistory,
} from "../domain/externalAgentSession";
import {
  agentProjectOwnsOwner,
  agentRootOwnerId,
  type AgentProjectDescriptor,
} from "../domain/agentProject";
import type { ExternalSessionImportGateway } from "../domain/externalSessionImport";
import { importSavedSessionHistory } from "./importSavedSessionHistory";
import type { ExternalSessionGateway } from "./agentThreadPorts";

type HistoryState = "loading" | "failed" | "unavailable" | "ready";
interface Dependencies {
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly gateway?: ExternalSessionGateway;
  readonly importGateway?: ExternalSessionImportGateway;
  currentState(): AgentThreadsState;
  dispatchAction(action: AgentThreadsAction): void;
  reportError(source: string, error: unknown): void;
}
interface RequestSlot {
  readonly identity: string;
  readonly promise: Promise<void>;
}

/** Loads a frozen pre-import transcript without starting either provider CLI. */
export function useImportedThreadHistory(dependencies: Dependencies) {
  const latest = useRef(dependencies);
  const mounted = useRef(true);
  const slots = useRef(new Map<string, RequestSlot>());
  const completed = useRef(new Map<string, string>());
  const queue = useRef(Promise.resolve());
  const identities = useRef(new Map<string, string>());
  const cursors = useRef(new Map<string, number | null>());
  const [pages, setPages] = useState<ReadonlyMap<string, ExternalAgentSessionHistory>>(new Map());
  const [hasEarlier, setHasEarlier] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [states, setStates] = useState<ReadonlyMap<string, HistoryState>>(new Map());

  useLayoutEffect(() => {
    latest.current = dependencies;
    const stale = new Set<string>();
    for (const [id, identity] of identities.current) {
      if (identityFor(dependencies, id) !== identity) {
        stale.add(id);
        identities.current.delete(id);
        cursors.current.delete(id);
      }
    }
    if (stale.size > 0) {
      setPages((previous) => withoutKeys(previous, stale));
      setStates((previous) => withoutKeys(previous, stale));
      setHasEarlier((previous) => withoutKeys(previous, stale));
    }
    for (const [id, slot] of slots.current) {
      if (identityFor(dependencies, id) !== slot.identity) slots.current.delete(id);
    }
    for (const [id, identity] of completed.current) {
      if (identityFor(dependencies, id) !== identity) completed.current.delete(id);
    }
  }, [dependencies]);
  useLayoutEffect(() => {
    mounted.current = true;
    const requests = slots.current;
    const finished = completed.current;
    return () => {
      mounted.current = false;
      requests.clear();
      finished.clear();
    };
  }, []);

  const request = useCallback(
    (threadId: string, retry: boolean, earlier = false): Promise<void> => {
      const deps = latest.current;
      const thread = deps.currentState().threads.get(threadId);
      const origin = thread?.externalOrigin;
      if (
        !mounted.current ||
        thread === undefined ||
        origin == null ||
        (origin.history !== undefined && deps.importGateway === undefined)
      ) {
        return Promise.resolve();
      }
      const identity = identityFor(deps, threadId);
      if (identity === null) return Promise.resolve();
      identities.current.delete(threadId);
      identities.current.set(threadId, identity);
      const evicted = new Set<string>();
      while (identities.current.size > 32) {
        const oldest = identities.current.keys().next().value;
        if (oldest === undefined) break;
        identities.current.delete(oldest);
        slots.current.delete(oldest);
        completed.current.delete(oldest);
        cursors.current.delete(oldest);
        evicted.add(oldest);
      }
      if (evicted.size > 0) {
        setPages((previous) => withoutKeys(previous, evicted));
        setStates((previous) => withoutKeys(previous, evicted));
        setHasEarlier((previous) => withoutKeys(previous, evicted));
      }
      const existing = slots.current.get(threadId);
      if (existing?.identity === identity) return existing.promise;
      if (!retry && completed.current.get(threadId) === identity) return Promise.resolve();
      // One filesystem read at a time and a bounded queue for rapid navigation.
      if (slots.current.size >= 64) return Promise.resolve();
      const project = deps.projects.find((entry) => entry.rootKey === thread.owner.rootKey)!;
      const read = deps.gateway?.readExternalSessionHistory;
      const publish = (state: HistoryState) => {
        if (!mounted.current) return;
        setStates((previous) => {
          const next = new Map(previous);
          for (const id of next.keys()) {
            if (!latest.current.currentState().threads.has(id)) next.delete(id);
          }
          next.set(threadId, state);
          return next;
        });
      };
      if (read === undefined && deps.importGateway === undefined) {
        completed.current.set(threadId, identity);
        publish("unavailable");
        return Promise.resolve();
      }
      publish("loading");
      const slot: RequestSlot = {
        identity,
        promise: queue.current.then(async () => {
          const current = () =>
            mounted.current &&
            slots.current.get(threadId) === slot &&
            identityFor(latest.current, threadId) === identity;
          if (!current()) return;
          try {
            let result;
            if (deps.importGateway !== undefined) {
              const owner = {
                rootKey: thread.owner.rootKey,
                ownerId: agentRootOwnerId(thread.owner.rootKey),
                threadId,
              };
              let page = await deps.importGateway.readImportedHistory({
                ...owner,
                beforeOrdinal: earlier ? (cursors.current.get(threadId) ?? null) : null,
              });
              if (!current()) return;
              if (!page.complete && !earlier) {
                try {
                  await importSavedSessionHistory(deps.importGateway, owner, current);
                  if (!current()) return;
                  page = await deps.importGateway.readImportedHistory({
                    ...owner,
                    beforeOrdinal: null,
                  });
                } catch (error) {
                  if (!current()) return;
                  if (page.history.exchanges.length === 0) throw error;
                  latest.current.reportError("Imported conversation history", error);
                }
              }
              if (!current()) return;
              cursors.current.set(threadId, page.beforeOrdinal);
              setHasEarlier((previous) => new Map(previous).set(threadId, page.hasEarlier));
              result = page.history;
            } else {
              result = await read!.call(deps.gateway, {
                provider: origin.provider,
                sessionId: origin.sessionId,
                projectRoot: project.rootPath,
                repositoryRoot: thread.owner.repositoryRoot,
                beforeEpochMs: origin.importedAtEpochMs,
              });
            }
            if (!current()) return;
            const history = parseExternalAgentSessionHistory(result);
            if (history.provider !== origin.provider || history.sessionId !== origin.sessionId) {
              throw new Error("The imported history does not match this session.");
            }
            if (deps.importGateway !== undefined) {
              setPages((previous) => new Map(previous).set(threadId, history));
            } else {
              latest.current.dispatchAction({
                kind: "externalHistoryLoaded",
                threadId,
                owner: thread.owner,
                history,
              });
            }
            completed.current.set(threadId, identity);
            publish("ready");
          } catch (error) {
            if (!current()) return;
            completed.current.set(threadId, identity);
            latest.current.reportError("Imported conversation history", error);
            publish("failed");
          } finally {
            if (slots.current.get(threadId) === slot) slots.current.delete(threadId);
          }
        }),
      };
      slots.current.set(threadId, slot);
      queue.current = slot.promise.catch(() => undefined);
      return slot.promise;
    },
    [],
  );

  const ensure = useCallback((threadId: string) => request(threadId, false), [request]);
  const load = useCallback((threadId: string) => request(threadId, true), [request]);
  const loadEarlier = useCallback((threadId: string) => request(threadId, true, true), [request]);
  const stale = new Set(
    [...identities.current]
      .filter(([id, identity]) => identityFor(dependencies, id) !== identity)
      .map(([id]) => id),
  );
  return {
    states: withoutKeys(states, stale),
    ensure,
    load,
    loadEarlier,
    hasEarlier: withoutKeys(hasEarlier, stale),
    pages: withoutKeys(pages, stale),
  };
}

function identityFor(deps: Dependencies, threadId: string): string | null {
  const thread = deps.currentState().threads.get(threadId);
  const origin = thread?.externalOrigin;
  if (thread === undefined || origin == null) return null;
  const project = deps.projects.find((entry) => entry.rootKey === thread.owner.rootKey);
  if (
    project === undefined ||
    project.trust !== "trusted" ||
    project.origin === "closed-tab-live-tasks"
  )
    return null;
  if (!agentProjectOwnsOwner(project, thread.owner)) return null;
  if (
    project.rootPath !== thread.owner.repositoryRoot &&
    !project.repositories.some((repo) => repo.repositoryRoot === thread.owner.repositoryRoot)
  )
    return null;
  return JSON.stringify([
    project.rootKey,
    project.ownerId,
    project.generation,
    thread.owner,
    origin.provider,
    origin.sessionId,
    origin.importedAtEpochMs,
  ]);
}

function withoutKeys<T>(
  source: ReadonlyMap<string, T>,
  keys: ReadonlySet<string>,
): ReadonlyMap<string, T> {
  if (keys.size === 0) return source;
  return new Map([...source].filter(([id]) => !keys.has(id)));
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeAgentThreadTitle } from "../domain/agentThread";
import type { AgentThreadView } from "./agentThreadPorts";

export interface RemoteAgentMetadata {
  readonly threadId: string;
  readonly title?: string;
  readonly pinned?: boolean;
  readonly archived?: boolean;
  readonly removed?: boolean;
  readonly viewedAtEpochMs?: number | null;
  readonly snoozedUntil?: number | null;
  readonly settledAt?: number | null;
  readonly sortOrder?: number | null;
}

export interface RemoteAgentMetadataRepository {
  load(): readonly RemoteAgentMetadata[];
  save(records: readonly RemoteAgentMetadata[]): void;
}

const LIMIT = 4096;

/** Remote presentation preferences never enter the local workspace thread store. */
export function useRemoteAgentMetadata(repository?: RemoteAgentMetadataRepository) {
  const [state, setState] = useState<{ records: readonly RemoteAgentMetadata[]; revision: number }>(
    () => {
      try {
        return { records: repository?.load().slice(-LIMIT) ?? [], revision: 0 };
      } catch {
        return { records: [], revision: 0 };
      }
    },
  );
  const { records, revision } = state;
  const attempted = useRef(0);
  const [persistenceError, setPersistenceError] = useState<string | null>(null);
  const index = useMemo(
    () => new Map(records.map((record) => [record.threadId, record])),
    [records],
  );
  useEffect(() => {
    if (revision === attempted.current) return;
    attempted.current = revision;
    try {
      repository?.save(records);
      setPersistenceError(null);
    } catch {
      setPersistenceError(
        "Remote conversation preferences could not be saved. Changes remain available until the editor closes.",
      );
    }
  }, [records, repository, revision]);
  const update = useCallback(
    (threadId: string, change: Partial<Omit<RemoteAgentMetadata, "threadId">>) => {
      let normalized = change;
      if (change.title !== undefined) {
        const title = normalizeAgentThreadTitle(change.title);
        if (title === null || /[\u0000-\u001f\u007f]/u.test(title)) return;
        normalized = { ...change, title };
      }
      setState((state) => {
        const previous = state.records;
        const current = previous.find((record) => record.threadId === threadId);
        const updated = { ...current, ...normalized, threadId };
        if (
          current &&
          current.title === updated.title &&
          current.pinned === updated.pinned &&
          current.archived === updated.archived &&
          current.removed === updated.removed &&
          current.viewedAtEpochMs === updated.viewedAtEpochMs
        )
          return state;
        const next = [...previous.filter((record) => record.threadId !== threadId), updated].slice(
          -LIMIT,
        );
        return { records: next, revision: state.revision + 1 };
      });
    },
    [],
  );
  const project = useCallback(
    (view: AgentThreadView): AgentThreadView | null => {
      const metadata = index.get(view.thread.threadId);
      if (metadata?.removed) return null;
      if (metadata === undefined) return view;
      const thread = {
        ...view.thread,
        title: normalizeAgentThreadTitle(metadata.title ?? "") ?? view.thread.title,
        pinned: metadata.pinned ?? view.thread.pinned,
        archived: metadata.archived ?? view.thread.archived,
        viewedAtEpochMs:
          metadata.viewedAtEpochMs === undefined
            ? view.thread.viewedAtEpochMs
            : metadata.viewedAtEpochMs,
      };
      return {
        ...view,
        thread,
        lifecycle: thread.archived ? "archived" : view.lifecycle,
        attention: thread.archived ? "archived" : view.attention,
        unread:
          !thread.archived &&
          (thread.viewedAtEpochMs === null || thread.updatedAtEpochMs > thread.viewedAtEpochMs),
      };
    },
    [index],
  );
  return { update, project, persistenceError };
}

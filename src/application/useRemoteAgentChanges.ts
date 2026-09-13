import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { GitChangedFile } from "../domain/git";
import type { RemoteRunnerGateway } from "../domain/remoteRunner";
import type { AgentTaskChangeSummary, RemoteAgentThreadExecution } from "./agentThreadPorts";

export interface RemoteAgentChangesInput {
  readonly gateway: RemoteRunnerGateway | null;
  readonly owner: object;
  readonly valid: (owner: object) => boolean;
  readonly resolveTarget: (threadId: string) => RemoteAgentThreadExecution | null;
  readonly report: (message: string) => void;
}

const EMPTY: AgentTaskChangeSummary = {
  loading: false,
  error: null,
  files: [],
  truncated: false,
  removing: false,
  diff: null,
};
const MAX_SUMMARIES = 32;
const MAX_PENDING = 64;
interface Entry {
  readonly owner: object;
  readonly gateway: RemoteRunnerGateway;
  readonly key: string;
  summary: AgentTaskChangeSummary;
  statusToken?: object;
  diffToken?: object;
}
function targetKey(target: RemoteAgentThreadExecution): string {
  return JSON.stringify([
    target.serverId,
    target.runnerId,
    target.projectId,
    target.conversationId,
    target.latestTaskId,
  ]);
}
function safePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 4096 &&
    !/[\\\u0000-\u001f\u007f:]/u.test(path) &&
    !path.split("/").some((part) => part === "" || part === "." || part === "..")
  );
}

/** Reads cumulative server worktree changes without entering any local filesystem gateway. */
export function useRemoteAgentChanges(input: RemoteAgentChangesInput) {
  const dependencies = useRef(input);
  const mounted = useRef(true);
  const entries = useRef(new Map<string, Entry>());
  const pending = useRef(0);
  const [summaries, setSummaries] = useState<ReadonlyMap<string, AgentTaskChangeSummary>>(
    new Map(),
  );
  const publish = useCallback(() => {
    if (mounted.current)
      setSummaries(new Map([...entries.current].map(([id, entry]) => [id, entry.summary])));
  }, []);
  const current = useCallback((id: string, entry: Entry): boolean => {
    const deps = dependencies.current;
    const target = deps.resolveTarget(id);
    return (
      mounted.current &&
      entries.current.get(id) === entry &&
      deps.owner === entry.owner &&
      deps.gateway === entry.gateway &&
      deps.valid(entry.owner) &&
      target !== null &&
      targetKey(target) === entry.key
    );
  }, []);
  useLayoutEffect(() => {
    dependencies.current = input;
    let changed = false;
    for (const [id, entry] of entries.current) {
      if (!current(id, entry)) {
        entries.current.delete(id);
        changed = true;
      }
    }
    if (changed) publish();
  });
  useLayoutEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      entries.current.clear();
    };
  }, []);

  const acquire = useCallback(
    (id: string) => {
      const deps = dependencies.current;
      const target = deps.resolveTarget(id);
      if (!mounted.current || !deps.gateway || !deps.valid(deps.owner) || !target) return null;
      if (pending.current >= MAX_PENDING) {
        deps.report("Too many change requests are running. Try again when one finishes.");
        return null;
      }
      let entry = entries.current.get(id);
      if (!entry || !current(id, entry)) {
        entry = {
          owner: deps.owner,
          gateway: deps.gateway,
          key: targetKey(target),
          summary: EMPTY,
        };
        entries.current.set(id, entry);
      }
      entries.current.delete(id);
      entries.current.set(id, entry);
      while (entries.current.size > MAX_SUMMARIES) {
        const oldest = entries.current.keys().next().value;
        if (oldest !== undefined) entries.current.delete(oldest);
      }
      return { entry, target };
    },
    [current],
  );

  const showChanges = useCallback(
    async (threadId: string): Promise<void> => {
      const acquired = acquire(threadId);
      if (!acquired) return;
      const { entry, target } = acquired;
      const token = {};
      entry.statusToken = token;
      // A new snapshot invalidates any diff belonging to the previous snapshot.
      entry.diffToken = undefined;
      entry.summary = { ...EMPTY, loading: true };
      publish();
      pending.current += 1;
      try {
        if (!entry.gateway.listTaskFiles) throw new Error("unsupported");
        const response = await entry.gateway.listTaskFiles({
          serverId: target.serverId,
          taskId: target.latestTaskId,
        });
        if (!current(threadId, entry) || entry.statusToken !== token) return;
        entry.summary = {
          ...EMPTY,
          truncated: response.truncated,
          files: response.files.map((file) => ({
            path: file.path,
            relativePath: file.path,
            status: file.status,
            oldPath: file.oldPath ?? null,
            oldRelativePath: file.oldPath ?? null,
            isStaged: false,
            isUnversioned: file.status === "untracked",
          })),
        };
        publish();
      } catch {
        if (!current(threadId, entry) || entry.statusToken !== token) return;
        const message = "The server worktree changes could not be read.";
        entry.summary = { ...EMPTY, error: message };
        publish();
        dependencies.current.report(message);
      } finally {
        pending.current -= 1;
      }
    },
    [acquire, current, publish],
  );

  const hideChanges = useCallback(
    (threadId: string): void => {
      entries.current.delete(threadId);
      publish();
    },
    [publish],
  );
  const hideFileDiff = useCallback(
    (threadId: string): void => {
      const entry = entries.current.get(threadId);
      if (!entry) return;
      entry.diffToken = undefined;
      entry.summary = { ...entry.summary, diff: null };
      publish();
    },
    [publish],
  );
  const showFileDiff = useCallback(
    async (threadId: string, change: GitChangedFile): Promise<void> => {
      const existing = entries.current.get(threadId);
      // Only a file in this exact server snapshot may become a request.
      if (
        !existing ||
        !current(threadId, existing) ||
        !safePath(change.relativePath) ||
        !existing.summary.files.some(
          (file) =>
            file.relativePath === change.relativePath &&
            file.status === change.status &&
            file.oldRelativePath === change.oldRelativePath,
        )
      )
        return;
      const acquired = acquire(threadId);
      if (!acquired) return;
      const { entry, target } = acquired;
      const token = {};
      entry.diffToken = token;
      const loading = {
        relativePath: change.relativePath,
        loading: true,
        error: null,
        original: { text: "", truncated: false },
        modified: { text: "", truncated: false },
        unavailableReason: null,
      };
      entry.summary = { ...entry.summary, diff: loading };
      publish();
      pending.current += 1;
      try {
        if (!entry.gateway.getTaskFileDiff) throw new Error("unsupported");
        const response = await entry.gateway.getTaskFileDiff({
          serverId: target.serverId,
          taskId: target.latestTaskId,
          path: change.relativePath,
        });
        if (!current(threadId, entry) || entry.diffToken !== token) return;
        if (response.path !== change.relativePath) throw new Error("foreign file");
        entry.summary = {
          ...entry.summary,
          diff: {
            ...loading,
            loading: false,
            original: response.original,
            modified: response.modified,
            unavailableReason: response.unavailableReason,
          },
        };
        publish();
      } catch {
        if (!current(threadId, entry) || entry.diffToken !== token) return;
        const message = "The server file diff could not be read.";
        entry.summary = { ...entry.summary, diff: { ...loading, loading: false, error: message } };
        publish();
        dependencies.current.report(message);
      } finally {
        pending.current -= 1;
      }
    },
    [acquire, current, publish],
  );
  return { summaries, showChanges, hideChanges, showFileDiff, hideFileDiff };
}

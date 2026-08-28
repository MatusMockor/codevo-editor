import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentThread } from "../domain/agentThread";
import type { GitChangedFile, GitGateway } from "../domain/git";
import {
  AGENT_TASKS_SOURCE,
  isCurrentProjectOwner,
  projectAuthority,
  projectByOwnerId,
  type AgentProjectAuthority,
} from "./agentProjectAuthority";
import type {
  AgentTaskChangeSummary,
  AgentTaskDiffSide,
  AgentTaskFileDiff,
} from "./agentThreadPorts";

export const MAX_AGENT_TASK_CHANGE_ROWS = 500;
export const MAX_AGENT_TASK_DIFF_SIDE_BYTES = 128 * 1_024;
export const MAX_AGENT_TASK_CHANGE_SUMMARIES = 32;
// One pending-authority record per cached thread, with at most one status and one diff request.
export const MAX_AGENT_TASK_CHANGE_REQUEST_THREADS = MAX_AGENT_TASK_CHANGE_SUMMARIES;
export const MAX_AGENT_TASK_CHANGE_REQUESTS = MAX_AGENT_TASK_CHANGE_REQUEST_THREADS * 2;

const SUMMARY_AUTHORITY_DROPPED_ERROR =
  "This project no longer owns the repository, so its changes could not be read.";
const DIFF_AUTHORITY_DROPPED_ERROR =
  "This project no longer owns the repository, so the file diff could not be read.";
const CHANGE_REQUEST_CAPACITY_ERROR =
  "Too many change requests are already running. Try again after one finishes.";
const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder("utf-8");
const EMPTY_SUMMARY: AgentTaskChangeSummary = Object.freeze({
  loading: true,
  error: null,
  files: Object.freeze([]),
  truncated: false,
  removing: false,
  diff: null,
});

export interface AgentChangeSummaryDependencies {
  readonly gitGateway: Pick<GitGateway, "getStatus" | "getDiff">;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly reportError: (source: string, error: unknown) => void;
}

export interface AgentChangeSummarySurface {
  readonly summaries: ReadonlyMap<string, AgentTaskChangeSummary>;
  showChanges(threadId: string): Promise<void>;
  hideChanges(threadId: string): void;
  showFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
  hideFileDiff(threadId: string): void;
  refreshVisibleChanges(threadId: string): Promise<void>;
  setRemoving(threadId: string, removing: boolean): void;
  clear(threadId: string): void;
}

interface ThreadChangeTarget {
  readonly worktreePath: string;
  readonly repositoryRoot: string;
  readonly authority: AgentProjectAuthority;
}

interface PendingChangeRequests {
  readonly byThread: Map<string, { readonly status: number | null; readonly diff: number | null }>;
  readonly inFlightIds: Set<number>;
  readonly operations: Map<number, Promise<void>>;
  nextId: number;
}

interface RequestAdmission {
  readonly requestId: number;
  readonly evictedThreadId: string | null;
}

export function useAgentChangeSummary(
  dependencies: AgentChangeSummaryDependencies,
): AgentChangeSummarySurface {
  const [summaries, setSummaries] = useState<ReadonlyMap<string, AgentTaskChangeSummary>>(
    () => new Map(),
  );

  const dependenciesRef = useRef(dependencies);
  const summariesRef = useRef(summaries);
  summariesRef.current = summaries;
  const mountedRef = useRef(true);
  const cacheTargetsRef = useRef(new Map<string, ThreadChangeTarget>());
  const requestsRef = useRef<PendingChangeRequests>({
    byThread: new Map(),
    inFlightIds: new Set(),
    operations: new Map(),
    nextId: 0,
  });

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    setSummaries((current) =>
      pruneInvalidSummaries(
        current,
        dependenciesRef.current,
        cacheTargetsRef.current,
        (threadId) => {
          invalidateRequests(requestsRef.current, threadId);
          cacheTargetsRef.current.delete(threadId);
        },
      ),
    );
  }, [dependencies.projects, dependencies.threads]);

  useEffect(() => {
    for (const threadId of cacheTargetsRef.current.keys()) {
      if (!summaries.has(threadId)) cacheTargetsRef.current.delete(threadId);
    }
  }, [summaries]);

  const dropSummaryAuthority = useCallback((threadId: string): void => {
    if (!mountedRef.current) return;
    invalidateRequests(requestsRef.current, threadId);
    setSummaries((current) => {
      const summary = current.get(threadId);
      if (summary === undefined || !summary.loading) return current;
      return withSummary(current, threadId, {
        ...summary,
        loading: false,
        error: SUMMARY_AUTHORITY_DROPPED_ERROR,
      });
    });
  }, []);

  const refreshChangeSummary = useCallback(
    async (threadId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const target = changeTarget(deps, threadId);
      if (target === null) {
        dropSummaryAuthority(threadId);
        return;
      }
      const existingOperation = currentRequestOperation(requestsRef.current, "status", threadId);
      if (existingOperation !== null) {
        touchPendingRequestThread(requestsRef.current, threadId);
        setSummaries((current) => touchSummary(current, threadId));
        await existingOperation;
        return;
      }
      const admission = beginRequest(requestsRef.current, "status", threadId);
      if (admission === null) {
        settleStatusRequestCapacity(setSummaries, threadId);
        return;
      }
      const requestId = admission.requestId;
      if (admission.evictedThreadId !== null) {
        cacheTargetsRef.current.delete(admission.evictedThreadId);
      }
      cacheTargetsRef.current.set(threadId, target);

      setSummaries((current) => {
        const admitted =
          admission.evictedThreadId === null
            ? current
            : withoutSummary(current, admission.evictedThreadId);
        return withBoundedSummary(
          admitted,
          threadId,
          {
            ...summaryOf(current, threadId),
            loading: true,
            error: null,
          },
          (evictedThreadId) => {
            invalidateRequests(requestsRef.current, evictedThreadId);
            cacheTargetsRef.current.delete(evictedThreadId);
          },
        );
      });

      const operation = (async (): Promise<void> => {
        try {
          const status = await deps.gitGateway.getStatus(target.worktreePath);
          if (!isCurrentRequest(requestsRef.current, "status", threadId, requestId)) return;
          if (!isCurrentChangeTarget(dependenciesRef.current, mountedRef, threadId, target)) {
            dropSummaryAuthority(threadId);
            return;
          }
          const files = status.changes.slice(0, MAX_AGENT_TASK_CHANGE_ROWS);
          setSummaries((current) => {
            const summary = current.get(threadId);
            if (summary === undefined) return current;
            return withSummary(current, threadId, {
              ...summary,
              loading: false,
              error: null,
              files,
              truncated: status.changes.length > MAX_AGENT_TASK_CHANGE_ROWS,
            });
          });
        } catch (error) {
          if (
            !isCurrentRequest(requestsRef.current, "status", threadId, requestId) ||
            !isCurrentChangeTarget(dependenciesRef.current, mountedRef, threadId, target)
          )
            return;
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
          setSummaries((current) => {
            const summary = current.get(threadId);
            if (summary === undefined) return current;
            return withSummary(current, threadId, {
              ...summary,
              loading: false,
              error: "The worktree changes could not be read.",
            });
          });
        } finally {
          finishRequest(requestsRef.current, "status", threadId, requestId);
        }
      })();
      if (requestsRef.current.inFlightIds.has(requestId)) {
        requestsRef.current.operations.set(requestId, operation);
      }
      await operation;
    },
    [dropSummaryAuthority],
  );

  const showChanges = useCallback(
    async (threadId: string): Promise<void> => {
      const target = changeTarget(dependenciesRef.current, threadId);
      if (target === null) return;
      cacheTargetsRef.current.set(threadId, target);
      setSummaries((current) =>
        withBoundedSummary(current, threadId, EMPTY_SUMMARY, (evictedThreadId) => {
          invalidateRequests(requestsRef.current, evictedThreadId);
          cacheTargetsRef.current.delete(evictedThreadId);
        }),
      );
      await refreshChangeSummary(threadId);
    },
    [refreshChangeSummary],
  );

  const refreshVisibleChanges = useCallback(
    async (threadId: string): Promise<void> => {
      if (!summariesRef.current.has(threadId)) return;
      await refreshChangeSummary(threadId);
    },
    [refreshChangeSummary],
  );

  const hideChanges = useCallback((threadId: string): void => {
    invalidateRequests(requestsRef.current, threadId);
    cacheTargetsRef.current.delete(threadId);
    setSummaries((current) => withoutSummary(current, threadId));
  }, []);

  const hideFileDiff = useCallback((threadId: string): void => {
    invalidateRequestKind(requestsRef.current, "diff", threadId);
    setSummaries((current) => {
      const summary = current.get(threadId);
      if (summary === undefined || summary.diff === null) return current;
      return withSummary(current, threadId, { ...summary, diff: null });
    });
  }, []);

  const showFileDiff = useCallback(
    async (threadId: string, change: GitChangedFile): Promise<void> => {
      const deps = dependenciesRef.current;
      const target = changeTarget(deps, threadId);
      if (target === null) return;
      const admission = beginRequest(requestsRef.current, "diff", threadId);
      if (admission === null) {
        invalidateRequestKind(requestsRef.current, "diff", threadId);
        settleDiffRequestCapacity(setSummaries, threadId, change.relativePath);
        return;
      }
      const requestId = admission.requestId;
      if (admission.evictedThreadId !== null) {
        cacheTargetsRef.current.delete(admission.evictedThreadId);
      }
      cacheTargetsRef.current.set(threadId, target);
      setSummaries((current) => {
        const admitted =
          admission.evictedThreadId === null
            ? current
            : withoutSummary(current, admission.evictedThreadId);
        return withBoundedSummary(
          admitted,
          threadId,
          {
            ...summaryOf(current, threadId),
            diff: loadingFileDiff(change.relativePath),
          },
          (evictedThreadId) => {
            invalidateRequests(requestsRef.current, evictedThreadId);
            cacheTargetsRef.current.delete(evictedThreadId);
          },
        );
      });

      const operation = (async (): Promise<void> => {
        try {
          const diff = await deps.gitGateway.getDiff(target.worktreePath, change);
          if (!isCurrentRequest(requestsRef.current, "diff", threadId, requestId)) return;
          if (!isCurrentChangeTarget(dependenciesRef.current, mountedRef, threadId, target)) {
            dropFileDiffAuthority(threadId, change.relativePath, mountedRef, setSummaries);
            return;
          }
          setSummaries((current) => {
            const summary = current.get(threadId);
            if (summary === undefined) return current;
            return withSummary(current, threadId, {
              ...summary,
              diff: {
                relativePath: change.relativePath,
                loading: false,
                error: null,
                original: clipDiffSide(diff.originalContent),
                modified: clipDiffSide(diff.modifiedContent),
                unavailableReason: diff.previewUnavailableReason ?? null,
              },
            });
          });
        } catch (error) {
          if (
            !isCurrentRequest(requestsRef.current, "diff", threadId, requestId) ||
            !isCurrentChangeTarget(dependenciesRef.current, mountedRef, threadId, target)
          )
            return;
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
          setSummaries((current) => {
            const summary = current.get(threadId);
            if (summary === undefined) return current;
            return withSummary(current, threadId, {
              ...summary,
              diff: {
                ...loadingFileDiff(change.relativePath),
                loading: false,
                error: "The file diff could not be read.",
              },
            });
          });
        } finally {
          finishRequest(requestsRef.current, "diff", threadId, requestId);
        }
      })();
      if (requestsRef.current.inFlightIds.has(requestId)) {
        requestsRef.current.operations.set(requestId, operation);
      }
      await operation;
    },
    [],
  );

  const setRemoving = useCallback((threadId: string, removing: boolean): void => {
    if (!mountedRef.current) return;
    setSummaries((current) => {
      const summary = current.get(threadId);
      if (summary === undefined) return current;
      if (summary.removing === removing) return current;
      return withSummary(current, threadId, { ...summary, removing });
    });
  }, []);

  const clear = useCallback((threadId: string): void => {
    if (!mountedRef.current) return;
    invalidateRequests(requestsRef.current, threadId);
    cacheTargetsRef.current.delete(threadId);
    setSummaries((current) => withoutSummary(current, threadId));
  }, []);

  return {
    summaries,
    showChanges,
    hideChanges,
    showFileDiff,
    hideFileDiff,
    refreshVisibleChanges,
    setRemoving,
    clear,
  };
}

function changeTarget(
  dependencies: AgentChangeSummaryDependencies,
  threadId: string,
): ThreadChangeTarget | null {
  const thread = dependencies.threads.get(threadId);
  if (thread === undefined || thread.target.worktreePath === null) return null;
  const project = projectByOwnerId(dependencies.projects, thread.owner.ownerId);
  if (project === undefined) return null;
  if (project.rootKey !== thread.owner.rootKey) return null;
  if (
    !project.repositories.some(
      (repository) => repository.repositoryRoot === thread.owner.repositoryRoot,
    )
  )
    return null;
  return {
    worktreePath: thread.target.worktreePath,
    repositoryRoot: thread.owner.repositoryRoot,
    authority: projectAuthority(project, thread.owner.ownerId),
  };
}

function sameChangeTarget(left: ThreadChangeTarget, right: ThreadChangeTarget): boolean {
  return (
    left.worktreePath === right.worktreePath &&
    left.repositoryRoot === right.repositoryRoot &&
    left.authority.rootKey === right.authority.rootKey &&
    left.authority.ownerId === right.authority.ownerId &&
    left.authority.generation === right.authority.generation
  );
}

function isCurrentChangeTarget(
  dependencies: AgentChangeSummaryDependencies,
  mountedRef: { readonly current: boolean },
  threadId: string,
  target: ThreadChangeTarget,
): boolean {
  if (
    !isCurrentProjectOwner(
      { current: dependencies },
      mountedRef,
      target.authority,
      target.repositoryRoot,
    )
  )
    return false;
  const current = changeTarget(dependencies, threadId);
  return current !== null && sameChangeTarget(current, target);
}

function pruneInvalidSummaries(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  dependencies: AgentChangeSummaryDependencies,
  cacheTargets: ReadonlyMap<string, ThreadChangeTarget>,
  onPrune: (threadId: string) => void,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  let next = summaries;
  for (const threadId of summaries.keys()) {
    const cached = cacheTargets.get(threadId);
    const current = changeTarget(dependencies, threadId);
    if (cached === undefined || current === null || !sameChangeTarget(cached, current)) {
      onPrune(threadId);
      next = withoutSummary(next, threadId);
    }
  }
  return next;
}

function beginRequest(
  requests: PendingChangeRequests,
  kind: "status" | "diff",
  threadId: string,
): RequestAdmission | null {
  if (requests.inFlightIds.size >= MAX_AGENT_TASK_CHANGE_REQUESTS) return null;
  requests.nextId += 1;
  requests.inFlightIds.add(requests.nextId);
  let evictedThreadId: string | null = null;
  const existing = requests.byThread.get(threadId);
  if (existing === undefined && requests.byThread.size >= MAX_AGENT_TASK_CHANGE_REQUEST_THREADS) {
    evictedThreadId = requests.byThread.keys().next().value ?? null;
    if (evictedThreadId !== null) requests.byThread.delete(evictedThreadId);
  }
  requests.byThread.delete(threadId);
  requests.byThread.set(threadId, {
    status: kind === "status" ? requests.nextId : (existing?.status ?? null),
    diff: kind === "diff" ? requests.nextId : (existing?.diff ?? null),
  });
  return { requestId: requests.nextId, evictedThreadId };
}

function isCurrentRequest(
  requests: PendingChangeRequests,
  kind: "status" | "diff",
  threadId: string,
  requestId: number,
): boolean {
  return requests.byThread.get(threadId)?.[kind] === requestId;
}

function currentRequestOperation(
  requests: PendingChangeRequests,
  kind: "status" | "diff",
  threadId: string,
): Promise<void> | null {
  const requestId = requests.byThread.get(threadId)?.[kind];
  return requestId === null || requestId === undefined
    ? null
    : (requests.operations.get(requestId) ?? null);
}

function touchPendingRequestThread(requests: PendingChangeRequests, threadId: string): void {
  const pending = requests.byThread.get(threadId);
  if (pending === undefined) return;
  requests.byThread.delete(threadId);
  requests.byThread.set(threadId, pending);
}

function finishRequest(
  requests: PendingChangeRequests,
  kind: "status" | "diff",
  threadId: string,
  requestId: number,
): void {
  requests.inFlightIds.delete(requestId);
  requests.operations.delete(requestId);
  if (isCurrentRequest(requests, kind, threadId, requestId)) {
    invalidateRequestKind(requests, kind, threadId);
  }
}

function invalidateRequestKind(
  requests: PendingChangeRequests,
  kind: "status" | "diff",
  threadId: string,
): void {
  const pending = requests.byThread.get(threadId);
  if (pending === undefined) return;
  const next = { ...pending, [kind]: null };
  if (next.status === null && next.diff === null) {
    requests.byThread.delete(threadId);
  } else {
    requests.byThread.set(threadId, next);
  }
}

function invalidateRequests(requests: PendingChangeRequests, threadId: string): void {
  requests.byThread.delete(threadId);
}

function settleStatusRequestCapacity(
  setSummaries: (
    update: (
      current: ReadonlyMap<string, AgentTaskChangeSummary>,
    ) => ReadonlyMap<string, AgentTaskChangeSummary>,
  ) => void,
  threadId: string,
): void {
  setSummaries((current) => {
    const summary = current.get(threadId);
    if (summary === undefined) return current;
    return withSummary(current, threadId, {
      ...summary,
      loading: false,
      error: CHANGE_REQUEST_CAPACITY_ERROR,
    });
  });
}

function settleDiffRequestCapacity(
  setSummaries: (
    update: (
      current: ReadonlyMap<string, AgentTaskChangeSummary>,
    ) => ReadonlyMap<string, AgentTaskChangeSummary>,
  ) => void,
  threadId: string,
  relativePath: string,
): void {
  setSummaries((current) => {
    const summary = current.get(threadId);
    if (summary === undefined) return current;
    return withSummary(current, threadId, {
      ...summary,
      diff: {
        ...loadingFileDiff(relativePath),
        loading: false,
        error: CHANGE_REQUEST_CAPACITY_ERROR,
      },
    });
  });
}

function dropFileDiffAuthority(
  threadId: string,
  relativePath: string,
  mountedRef: { current: boolean },
  setSummaries: (
    update: (
      current: ReadonlyMap<string, AgentTaskChangeSummary>,
    ) => ReadonlyMap<string, AgentTaskChangeSummary>,
  ) => void,
): void {
  if (!mountedRef.current) return;
  setSummaries((current) => {
    const summary = current.get(threadId);
    if (summary === undefined || summary.diff === null || !summary.diff.loading) return current;
    return withSummary(current, threadId, {
      ...summary,
      diff: {
        ...loadingFileDiff(relativePath),
        loading: false,
        error: DIFF_AUTHORITY_DROPPED_ERROR,
      },
    });
  });
}

function summaryOf(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  threadId: string,
): AgentTaskChangeSummary {
  return summaries.get(threadId) ?? EMPTY_SUMMARY;
}

function withSummary(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  threadId: string,
  summary: AgentTaskChangeSummary,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  const next = new Map(summaries);
  next.set(threadId, summary);
  return next;
}

function touchSummary(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  threadId: string,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  const summary = summaries.get(threadId);
  if (summary === undefined) return summaries;
  const next = new Map(summaries);
  next.delete(threadId);
  next.set(threadId, summary);
  return next;
}

function withBoundedSummary(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  threadId: string,
  summary: AgentTaskChangeSummary,
  onEvict: (threadId: string) => void,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  const next = new Map(summaries);
  next.delete(threadId);
  next.set(threadId, summary);
  while (next.size > MAX_AGENT_TASK_CHANGE_SUMMARIES) {
    const evicted = leastRecentEvictableThread(next, threadId);
    if (evicted === null) break;
    onEvict(evicted);
    next.delete(evicted);
  }
  return next;
}

function leastRecentEvictableThread(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  protectedThreadId: string,
): string | null {
  let loadingFallback: string | null = null;
  for (const [threadId, summary] of summaries) {
    if (threadId === protectedThreadId) continue;
    if (loadingFallback === null) loadingFallback = threadId;
    if (!summary.loading && summary.diff?.loading !== true) return threadId;
  }
  return loadingFallback ?? summaries.keys().next().value ?? null;
}

function withoutSummary(
  summaries: ReadonlyMap<string, AgentTaskChangeSummary>,
  threadId: string,
): ReadonlyMap<string, AgentTaskChangeSummary> {
  if (!summaries.has(threadId)) return summaries;
  const next = new Map(summaries);
  next.delete(threadId);
  return next;
}

function loadingFileDiff(relativePath: string): AgentTaskFileDiff {
  return {
    relativePath,
    loading: true,
    error: null,
    original: { text: "", truncated: false },
    modified: { text: "", truncated: false },
    unavailableReason: null,
  };
}

function clipDiffSide(content: string): AgentTaskDiffSide {
  const bytes = UTF8_ENCODER.encode(content);
  if (bytes.byteLength <= MAX_AGENT_TASK_DIFF_SIDE_BYTES) {
    return { text: content, truncated: false };
  }
  let end = MAX_AGENT_TASK_DIFF_SIDE_BYTES;
  while (end > 0 && (bytes[end] & 0b1100_0000) === 0b1000_0000) end -= 1;
  return { text: UTF8_DECODER.decode(bytes.subarray(0, end)), truncated: true };
}

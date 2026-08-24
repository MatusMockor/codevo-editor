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

const SUMMARY_AUTHORITY_DROPPED_ERROR =
  "This project no longer owns the repository, so its changes could not be read.";
const DIFF_AUTHORITY_DROPPED_ERROR =
  "This project no longer owns the repository, so the file diff could not be read.";
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

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const dropSummaryAuthority = useCallback((threadId: string): void => {
    if (!mountedRef.current) return;
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
      const thread = deps.threads.get(threadId);
      if (thread === undefined || thread.target.worktreePath === null) return;
      const project = projectByOwnerId(deps.projects, thread.owner.ownerId);
      if (project === undefined) {
        dropSummaryAuthority(threadId);
        return;
      }
      const authority = projectAuthority(project);
      const worktreePath = thread.target.worktreePath;
      const repositoryRoot = thread.owner.repositoryRoot;

      setSummaries((current) =>
        withSummary(current, threadId, {
          ...summaryOf(current, threadId),
          loading: true,
          error: null,
        }),
      );

      try {
        const status = await deps.gitGateway.getStatus(worktreePath);
        if (!isCurrentProjectOwner(dependenciesRef, mountedRef, authority, repositoryRoot)) {
          dropSummaryAuthority(threadId);
          return;
        }
        const files = status.changes.slice(0, MAX_AGENT_TASK_CHANGE_ROWS);
        setSummaries((current) =>
          withSummary(current, threadId, {
            ...summaryOf(current, threadId),
            loading: false,
            error: null,
            files,
            truncated: status.changes.length > MAX_AGENT_TASK_CHANGE_ROWS,
          }),
        );
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        setSummaries((current) =>
          withSummary(current, threadId, {
            ...summaryOf(current, threadId),
            loading: false,
            error: "The worktree changes could not be read.",
          }),
        );
      }
    },
    [dropSummaryAuthority],
  );

  const showChanges = useCallback(
    async (threadId: string): Promise<void> => {
      const thread = dependenciesRef.current.threads.get(threadId);
      if (thread === undefined || thread.target.worktreePath === null) return;
      setSummaries((current) => withSummary(current, threadId, EMPTY_SUMMARY));
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
    setSummaries((current) => withoutSummary(current, threadId));
  }, []);

  const hideFileDiff = useCallback((threadId: string): void => {
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
      setSummaries((current) =>
        withSummary(current, threadId, {
          ...summaryOf(current, threadId),
          diff: loadingFileDiff(change.relativePath),
        }),
      );

      try {
        const diff = await deps.gitGateway.getDiff(target.worktreePath, change);
        if (
          !isCurrentProjectOwner(
            dependenciesRef,
            mountedRef,
            target.authority,
            target.repositoryRoot,
          )
        ) {
          dropFileDiffAuthority(threadId, change.relativePath, mountedRef, setSummaries);
          return;
        }
        setSummaries((current) =>
          withSummary(current, threadId, {
            ...summaryOf(current, threadId),
            diff: {
              relativePath: change.relativePath,
              loading: false,
              error: null,
              original: clipDiffSide(diff.originalContent),
              modified: clipDiffSide(diff.modifiedContent),
              unavailableReason: diff.previewUnavailableReason ?? null,
            },
          }),
        );
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!mountedRef.current) return;
        setSummaries((current) =>
          withSummary(current, threadId, {
            ...summaryOf(current, threadId),
            diff: {
              ...loadingFileDiff(change.relativePath),
              loading: false,
              error: "The file diff could not be read.",
            },
          }),
        );
      }
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
  return {
    worktreePath: thread.target.worktreePath,
    repositoryRoot: thread.owner.repositoryRoot,
    authority: projectAuthority(project),
  };
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

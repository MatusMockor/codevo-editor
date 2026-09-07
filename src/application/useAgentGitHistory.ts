import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  Commit,
  CommitDetails,
  DiffPayload,
  FileChange,
  GitHistoryGateway,
  GitBranches,
} from "../domain/git";

export type AgentGitHistoryGateway = Pick<
  GitHistoryGateway,
  | "getBranches"
  | "getRepoStatus"
  | "getCommitLog"
  | "getCommitDetails"
  | "getCommitFiles"
  | "getCommitDiff"
>;
export interface AgentGitHistoryTarget {
  readonly rootPath: string;
  readonly ownerKey: string;
}
export type AgentGitHistoryBranchFilter =
  | { readonly kind: "all" }
  | { readonly kind: "head" }
  | { readonly kind: "branch"; readonly ref: string };
interface HistoryState {
  readonly branches: GitBranches | null;
  readonly branchFilter: AgentGitHistoryBranchFilter;
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly reason: string | null;
  readonly commits: readonly Commit[];
  readonly hasNext: boolean;
  readonly loadingMore: boolean;
  readonly selectedHash: string | null;
  readonly details: CommitDetails | null;
  readonly files: readonly FileChange[];
  readonly filesTruncated: boolean;
  readonly detailsLoading: boolean;
  readonly detailsError: string | null;
  readonly selectedFile: FileChange | null;
  readonly diff: DiffPayload | null;
  readonly diffLoading: boolean;
  readonly diffError: string | null;
}
const selection = {
  selectedHash: null,
  details: null,
  files: [],
  filesTruncated: false,
  detailsLoading: false,
  detailsError: null,
  selectedFile: null,
  diff: null,
  diffLoading: false,
  diffError: null,
} satisfies Partial<HistoryState>;
const initial: HistoryState = {
  status: "loading",
  reason: null,
  commits: [],
  branches: null,
  branchFilter: { kind: "all" },
  hasNext: false,
  loadingMore: false,
  ...selection,
};

function diffFailureReason(error: unknown): string {
  const message = error instanceof Error ? error.message : error;
  switch (message) {
    case "Binary file; text preview unavailable.":
      return "Binary files cannot be previewed.";
    case "Git history contains non-UTF-8 data; preview unavailable.":
      return "This file uses an unsupported text encoding and cannot be previewed.";
    case "File exceeds the preview size limit.":
      return "This file exceeds the preview size limit.";
    default:
      return "Could not load this file change. Select it to retry.";
  }
}

function historyBranchRefs(branches: GitBranches): Set<string> {
  const refs = [
    ...branches.local.map((name) => `refs/heads/${name}`),
    ...Object.entries(branches.remotes).flatMap(([remote, names]) =>
      names.map((name) => `refs/remotes/${remote}/${name}`),
    ),
  ];
  if (
    refs.length > 5000 ||
    refs.some((ref) => ref.length > 4096 || /[\x00-\x20\x7f]/.test(ref)) ||
    new Set(refs).size !== refs.length
  )
    throw new Error("Invalid branches");
  return new Set(refs);
}

export function useAgentGitHistory({
  target,
  gateway,
}: {
  readonly target: AgentGitHistoryTarget | null;
  readonly gateway: AgentGitHistoryGateway | null;
}) {
  const rootPath = target?.rootPath ?? null;
  const ownerKey = target?.ownerKey ?? null;
  const identity = useMemo(() => ({ rootPath, ownerKey, gateway }), [rootPath, ownerKey, gateway]);
  const [state, setState] = useState<HistoryState>(initial);
  const [request, setRequest] = useState<{
    count: number;
    refresh: number;
    filter: AgentGitHistoryBranchFilter;
  }>({ count: 50, refresh: 0, filter: { kind: "all" } });
  const lease = useRef(0);
  const detailRequest = useRef(0);
  const fileRequest = useRef(0);
  const owner = useRef<typeof identity | null>(identity);
  const selectedCommit = useRef<string | null>(null);
  const currentState = useRef(state);
  useLayoutEffect(() => {
    owner.current = identity;
    lease.current += 1;
    setRequest((previous) =>
      previous.count === 50 && previous.refresh === 0 && previous.filter.kind === "all"
        ? previous
        : { count: 50, refresh: 0, filter: { kind: "all" } },
    );
    setState(initial);
    return () => {
      owner.current = null;
      lease.current += 1;
    };
  }, [rootPath, ownerKey, gateway, identity]);
  useLayoutEffect(() => {
    currentState.current = state;
  }, [state]);
  useEffect(() => {
    const generation = ++lease.current;
    let active = true;
    const valid = () => active && generation === lease.current;
    detailRequest.current += 1;
    fileRequest.current += 1;
    selectedCommit.current = null;
    if (rootPath === null || ownerKey === null || gateway === null) {
      setState({
        ...initial,
        status: "unavailable",
        reason: "Choose a repository to view its history.",
      });
      return () => {
        active = false;
      };
    }
    setState((previous) => ({ ...previous, ...selection, branchFilter: request.filter }));
    void (async () => {
      try {
        const repo = await gateway.getRepoStatus(rootPath);
        if (!valid()) return;
        if (!repo.gitAvailable || !repo.isRepository) {
          setState({
            ...initial,
            status: "unavailable",
            reason: repo.gitAvailable
              ? "This folder is not a Git repository."
              : "Git is not available.",
          });
          return;
        }
        const branches = await gateway.getBranches(rootPath);
        if (!valid()) return;
        const refs = historyBranchRefs(branches);
        if (request.filter.kind === "branch" && !refs.has(request.filter.ref)) {
          setState({
            ...initial,
            branches,
            branchFilter: request.filter,
            status: "error",
            reason: "This branch is no longer available. Choose another branch or refresh.",
          });
          return;
        }
        const limit = Math.min(request.count + 1, 500);
        const commits = await gateway.getCommitLog(rootPath, {
          limit,
          cursor: "0",
          ...(request.filter.kind === "all"
            ? { allBranches: true }
            : request.filter.kind === "branch"
              ? { branch: request.filter.ref }
              : {}),
        });
        if (!valid()) return;
        if (
          commits.length > limit ||
          new Set(commits.map((commit) => commit.hash)).size !== commits.length
        )
          throw new Error("Invalid commit page");
        setState({
          ...initial,
          status: "ready",
          branches,
          branchFilter: request.filter,
          commits: commits.slice(0, request.count),
          hasNext: commits.length > request.count && request.count < 500,
          reason:
            commits.length === 500 && request.count === 500
              ? "Showing up to 500 commits. Choose a branch to narrow the history."
              : null,
        });
      } catch {
        if (!valid()) return;
        setState((previous) => ({
          ...previous,
          status: previous.loadingMore ? "ready" : "error",
          loadingMore: false,
          branchFilter: request.filter,
          reason: "Could not load Git history. Try refreshing.",
        }));
      }
    })();
    return () => {
      active = false;
      lease.current += 1;
    };
  }, [rootPath, ownerKey, gateway, request]);

  const owns = (generation: number) =>
    generation === lease.current &&
    owner.current === identity &&
    owner.current.rootPath === rootPath &&
    owner.current.ownerKey === ownerKey &&
    owner.current.gateway === gateway;
  const actionGeneration = lease.current;
  const selectCommit = (hash: string) => {
    if (
      !owns(actionGeneration) ||
      rootPath === null ||
      gateway === null ||
      currentState.current.status !== "ready" ||
      !currentState.current.commits.some((commit) => commit.hash === hash)
    )
      return;
    const generation = lease.current;
    const id = ++detailRequest.current;
    selectedCommit.current = hash;
    fileRequest.current += 1;
    const valid = () => owns(generation) && detailRequest.current === id;
    setState((previous) => ({
      ...previous,
      ...selection,
      selectedHash: hash,
      detailsLoading: true,
    }));
    void (async () => {
      try {
        const [details, files] = await Promise.all([
          gateway.getCommitDetails(rootPath, hash),
          gateway.getCommitFiles(rootPath, hash),
        ]);
        if (!valid()) return;
        if (details.hash !== hash) throw new Error("Mismatched commit");
        if (
          new Set(files.slice(0, 200).map((file) => file.path)).size !== Math.min(files.length, 200)
        )
          throw new Error("Duplicate files");
        setState((previous) => ({
          ...previous,
          details,
          files: files.slice(0, 200),
          filesTruncated: files.length > 200,
          detailsLoading: false,
        }));
      } catch {
        if (!valid()) return;
        setState((previous) => ({
          ...previous,
          detailsLoading: false,
          detailsError: "Could not load this commit. Select it to retry.",
        }));
      }
    })();
  };
  const selectFile = (file: FileChange) => {
    const snapshot = currentState.current;
    const hash = snapshot.selectedHash;
    if (
      !owns(actionGeneration) ||
      rootPath === null ||
      gateway === null ||
      hash === null ||
      selectedCommit.current !== hash ||
      !snapshot.files.includes(file)
    )
      return;
    const generation = lease.current;
    const detailId = detailRequest.current;
    const id = ++fileRequest.current;
    const valid = () =>
      owns(generation) && fileRequest.current === id && detailRequest.current === detailId;
    setState((previous) => ({
      ...previous,
      selectedFile: file,
      diff: null,
      diffLoading: true,
      diffError: null,
    }));
    void (async () => {
      try {
        const diff = await gateway.getCommitDiff(
          rootPath,
          hash,
          file.path,
          file.oldPath,
          snapshot.files.slice(),
        );
        if (!valid()) return;
        if (diff.commitHash !== hash || diff.path !== file.path) throw new Error("Mismatched diff");
        setState((previous) => ({ ...previous, diff, diffLoading: false }));
      } catch (error: unknown) {
        if (!valid()) return;
        setState((previous) => ({
          ...previous,
          diffLoading: false,
          diffError: diffFailureReason(error),
        }));
      }
    })();
  };
  const navigate = (count: number, filter: AgentGitHistoryBranchFilter) => {
    if (!owns(actionGeneration)) return;
    lease.current += 1;
    selectedCommit.current = null;
    const loadingMore =
      count > state.commits.length && state.status === "ready" && filter === request.filter;
    setState((previous) =>
      loadingMore
        ? { ...previous, ...selection, loadingMore: true, reason: null }
        : { ...initial, branches: previous.branches, branchFilter: filter },
    );
    setRequest((previous) => ({ count, filter, refresh: previous.refresh + 1 }));
  };
  return {
    ...state,
    selectCommit,
    selectFile,
    clearSelection: () => {
      if (!owns(actionGeneration)) return;
      detailRequest.current += 1;
      fileRequest.current += 1;
      selectedCommit.current = null;
      setState((previous) => ({ ...previous, ...selection }));
    },
    closeDiff: () => {
      if (!owns(actionGeneration)) return;
      fileRequest.current += 1;
      setState((previous) => ({
        ...previous,
        selectedFile: null,
        diff: null,
        diffLoading: false,
        diffError: null,
      }));
    },
    selectBranch: (filter: AgentGitHistoryBranchFilter) => {
      if (!owns(actionGeneration)) return;
      if (
        filter.kind === "branch" &&
        (!state.branches || !historyBranchRefs(state.branches).has(filter.ref))
      )
        return;
      navigate(50, filter);
    },
    loadMore: () => {
      if (state.status === "ready" && !state.loadingMore && state.hasNext)
        navigate(Math.min(state.commits.length + 50, 500), request.filter);
    },
    refresh: () => navigate(50, request.filter),
  };
}

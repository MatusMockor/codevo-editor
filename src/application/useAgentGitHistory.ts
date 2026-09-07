import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type {
  Commit,
  CommitDetails,
  DiffPayload,
  FileChange,
  GitHistoryGateway,
} from "../domain/git";

export type AgentGitHistoryGateway = Pick<
  GitHistoryGateway,
  "getRepoStatus" | "getCommitLog" | "getCommitDetails" | "getCommitFiles" | "getCommitDiff"
>;
export interface AgentGitHistoryTarget {
  readonly rootPath: string;
  readonly ownerKey: string;
}
interface HistoryState {
  readonly status: "loading" | "ready" | "unavailable" | "error";
  readonly reason: string | null;
  readonly commits: readonly Commit[];
  readonly page: number;
  readonly hasNext: boolean;
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
  page: 0,
  hasNext: false,
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
  const [request, setRequest] = useState({ page: 0, refresh: 0 });
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
      previous.page === 0 && previous.refresh === 0 ? previous : { page: 0, refresh: 0 },
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
    setState({ ...initial, page: request.page });
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
        const commits = await gateway.getCommitLog(rootPath, {
          limit: 51,
          cursor: String(request.page * 50),
        });
        if (!valid()) return;
        if (
          new Set(commits.slice(0, 50).map((commit) => commit.hash)).size !==
          Math.min(commits.length, 50)
        )
          throw new Error("Duplicate commits");
        setState({
          ...initial,
          status: "ready",
          page: request.page,
          commits: commits.slice(0, 50),
          hasNext: commits.length > 50 && request.page < 999,
          reason:
            commits.length > 50 && request.page === 999
              ? "History is limited to the latest 50,000 commits."
              : null,
        });
      } catch {
        if (!valid()) return;
        setState({
          ...initial,
          status: "error",
          page: request.page,
          reason: "Could not load Git history. Try refreshing.",
        });
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
  const selectCommit = (hash: string) => {
    if (
      owner.current !== identity ||
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
      owner.current !== identity ||
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
  const navigate = (page: number) => {
    if (owner.current !== identity) return;
    lease.current += 1;
    selectedCommit.current = null;
    setState({ ...initial, page });
    setRequest((previous) => ({ page, refresh: previous.refresh + 1 }));
  };
  return {
    ...state,
    selectCommit,
    selectFile,
    closeDiff: () => {
      if (owner.current !== identity) return;
      fileRequest.current += 1;
      setState((previous) => ({
        ...previous,
        selectedFile: null,
        diff: null,
        diffLoading: false,
        diffError: null,
      }));
    },
    nextPage: () => {
      if (state.status === "ready" && state.hasNext) navigate(state.page + 1);
    },
    previousPage: () => {
      if (state.status === "ready" && state.page > 0) navigate(state.page - 1);
    },
    refresh: () => navigate(0),
  };
}

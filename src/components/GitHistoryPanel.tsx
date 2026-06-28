import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  ChangeEvent,
  KeyboardEvent,
  UIEvent,
} from "react";
import {
  GitBranch,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  type Commit,
  type CommitDetails,
  type CommitGraphNode,
  type FileChange,
  type GitBranches,
  type GitHistoryGateway,
  type GitRepoStatus,
} from "../domain/git";

const COMMIT_LIST_ROW_HEIGHT = 30;
const COMMIT_LIST_OVERSCAN = 8;
const COMMIT_LIST_VIEWPORT_FALLBACK_HEIGHT = 320;
const COMMIT_LIST_PADDING_TOP = 6;
const COMMIT_LIST_PADDING_BOTTOM = 10;
const COMMIT_LIST_VIRTUAL_THRESHOLD = 180;

interface GitHistoryPanelProps {
  rootPath: string | null;
  gateway: GitHistoryGateway;
  onOpenCommitFileDiff(
    commitHash: string,
    path: string,
    oldPath: string | null,
  ): Promise<void> | void;
}

type HistoryError = string | null;

type CommitGraphByHash = Map<string, CommitGraphNode>;

function statusIcon(status: FileChange["status"]): string {
  if (status === "A") {
    return "A";
  }

  if (status === "D") {
    return "D";
  }

  if (status === "R") {
    return "R";
  }

  return "M";
}

function statusLabel(status: FileChange["status"]): string {
  if (status === "A") {
    return "Added";
  }

  if (status === "D") {
    return "Deleted";
  }

  if (status === "R") {
    return "Renamed";
  }

  return "Modified";
}

function emptyRepoStatus(): GitRepoStatus {
  return { gitAvailable: false, isRepository: false };
}

function emptyBranches(): GitBranches {
  return {
    current: null,
    local: [],
    remotes: {},
  };
}

function emptyCommitDetails(commitHash: string): CommitDetails {
  return {
    body: "",
    authorEmail: "",
    authorName: "",
    containingBranches: [],
    date: "",
    hash: commitHash,
    abbrevHash: commitHash.slice(0, 8),
    labels: [],
    parents: [],
    subject: "",
  };
}

function formatCommitDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Unknown date";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function measureGitHistoryViewportHeight(element: HTMLElement | null): number {
  if (!element) {
    return 0;
  }

  return element.clientHeight;
}

function groupFilesByFolder(files: FileChange[]): Array<[string, FileChange[]]> {
  const grouped: Record<string, FileChange[]> = {};

  for (const file of files) {
    const folder = file.path.includes("/")
      ? file.path.slice(0, file.path.lastIndexOf("/"))
      : "";
    const bucket = grouped[folder] ?? [];
    bucket.push(file);
    grouped[folder] = bucket;
  }

  return Object.entries(grouped)
    .map(
      ([folder, folderFiles]) =>
        [
          folder,
          folderFiles.slice().sort((a, b) => a.path.localeCompare(b.path)),
        ] as [string, FileChange[]],
    )
    .sort(([left], [right]) => left.localeCompare(right));
}

function commitGraphByHash(nodes: CommitGraphNode[]): CommitGraphByHash {
  const graph = new Map<string, CommitGraphNode>();

  for (const node of nodes) {
    graph.set(node.hash, node);
  }

  return graph;
}

function commitGraphGlyph(node: CommitGraphNode | undefined, commit: Commit): string {
  if (!node) {
    return commit.parents.length > 1 ? "◉" : "•";
  }

  if (node.isMerge) {
    return "◉";
  }

  if (node.children.length > 1) {
    return "┬";
  }

  return "•";
}

export const GitHistoryPanel = memo(function GitHistoryPanel(
  props: GitHistoryPanelProps,
) {
  const { gateway, onOpenCommitFileDiff, rootPath } = props;
  const [repoStatus, setRepoStatus] = useState<GitRepoStatus>(emptyRepoStatus());
  const [branches, setBranches] = useState<GitBranches>(emptyBranches());
  const [commits, setCommits] = useState<Commit[]>([]);
  const [selectedCommitHash, setSelectedCommitHash] = useState<string | null>(null);
  const [selectedDetails, setSelectedDetails] = useState<CommitDetails | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<FileChange[]>([]);
  const [query, setQuery] = useState("");
  const [branchFilter, setBranchFilter] = useState<string | null>(null);
  const [authorFilter, setAuthorFilter] = useState("");
  const [pathFilter, setPathFilter] = useState("");
  const [loading, setLoading] = useState({
    branches: false,
    commits: false,
    details: false,
  });
  const [branchesError, setBranchesError] = useState<HistoryError>(null);
  const [commitsError, setCommitsError] = useState<HistoryError>(null);
  const [detailsError, setDetailsError] = useState<HistoryError>(null);
  const [localExpanded, setLocalExpanded] = useState(true);
  const [remoteExpanded, setRemoteExpanded] = useState(true);
  const [commitGraph, setCommitGraph] = useState<CommitGraphNode[]>([]);
  const [commitListScrollTop, setCommitListScrollTop] = useState(0);
  const [commitListViewportHeight, setCommitListViewportHeight] = useState(0);
  const commitListRef = useRef<HTMLDivElement | null>(null);
  const pendingCommitListScrollTopRef = useRef(0);
  const commitListScrollAnimationRef = useRef<number | null>(null);
  const requestTokenRef = useRef(0);

  const branchEntries = branches.local.map((branch) => ({
    group: "local",
    kind: "local",
    branch,
  }));

  const remoteEntries = Object.entries(branches.remotes).flatMap(([remote, names]) =>
    names.map((name) => ({ group: remote, kind: "remote", branch: name })),
  );

  const shouldVirtualize = commits.length >= COMMIT_LIST_VIRTUAL_THRESHOLD;

  const commitGraphIndex = useMemo(
    () => commitGraphByHash(commitGraph),
    [commitGraph],
  );

  const selectedIndex = useMemo(
    () => commits.findIndex((commit) => commit.hash === selectedCommitHash),
    [commits, selectedCommitHash],
  );

  const selectedCommit = useMemo(
    () =>
      selectedCommitHash
        ? commits.find((commit) => commit.hash === selectedCommitHash) ?? null
        : null,
    [commits, selectedCommitHash],
  );

  const effectiveCommitListHeight =
    commitListViewportHeight > 0
      ? commitListViewportHeight
      : COMMIT_LIST_VIEWPORT_FALLBACK_HEIGHT;
  const pageSize = Math.max(
    1,
    Math.floor(
      (effectiveCommitListHeight -
        COMMIT_LIST_PADDING_TOP -
        COMMIT_LIST_PADDING_BOTTOM) /
        COMMIT_LIST_ROW_HEIGHT,
    ),
  );

  const normalizedCommitScrollTop = Math.min(
    commitListScrollTop,
    Math.max(
      0,
      commits.length * COMMIT_LIST_ROW_HEIGHT +
        COMMIT_LIST_PADDING_TOP +
        COMMIT_LIST_PADDING_BOTTOM -
        effectiveCommitListHeight,
    ),
  );

  const normalizedRowsScrollTop = Math.max(
    0,
    normalizedCommitScrollTop - COMMIT_LIST_PADDING_TOP,
  );
  const visibleCommitStart = shouldVirtualize
    ? Math.max(
      0,
      Math.floor(normalizedRowsScrollTop / COMMIT_LIST_ROW_HEIGHT) -
        COMMIT_LIST_OVERSCAN,
    )
    : 0;
  const visibleCommitEnd = shouldVirtualize
    ? Math.min(
      commits.length,
      visibleCommitStart +
        Math.ceil(
          effectiveCommitListHeight / COMMIT_LIST_ROW_HEIGHT,
        ) +
        COMMIT_LIST_OVERSCAN * 2,
    )
    : commits.length;
  const visibleCommits = useMemo(
    () => commits.slice(visibleCommitStart, visibleCommitEnd),
    [commits, visibleCommitStart, visibleCommitEnd],
  );
  const visibleCommitOffset = visibleCommitStart * COMMIT_LIST_ROW_HEIGHT;
  const totalCommitListHeight = Math.max(
    commits.length * COMMIT_LIST_ROW_HEIGHT +
      COMMIT_LIST_PADDING_TOP +
      COMMIT_LIST_PADDING_BOTTOM,
    effectiveCommitListHeight,
  );

  const commitFilesByFolder = groupFilesByFolder(selectedFiles);

  const ensureCommitIndexVisible = useCallback(
    (index: number) => {
      if (!commitListRef.current || commits.length === 0) {
        return;
      }

      const rowTop = COMMIT_LIST_PADDING_TOP + index * COMMIT_LIST_ROW_HEIGHT;
      const rowBottom = rowTop + COMMIT_LIST_ROW_HEIGHT;
      const viewportHeight = effectiveCommitListHeight;
      const maxScrollTop = Math.max(
        0,
        commits.length * COMMIT_LIST_ROW_HEIGHT +
          COMMIT_LIST_PADDING_TOP +
          COMMIT_LIST_PADDING_BOTTOM -
          viewportHeight,
      );

      if (rowTop < commitListScrollTop) {
        setCommitListScrollTop(Math.max(0, rowTop));
        commitListRef.current.scrollTop = Math.max(0, rowTop);
        return;
      }

      if (rowBottom > commitListScrollTop + viewportHeight) {
        const nextScrollTop = Math.min(
          maxScrollTop,
          Math.max(0, rowBottom - viewportHeight + 1),
        );

        setCommitListScrollTop(nextScrollTop);
        commitListRef.current.scrollTop = nextScrollTop;
      }
    },
    [commits.length, commitListScrollTop, effectiveCommitListHeight],
  );

  const resetSelection = useCallback(() => {
    const [nextCommit] = commits;
    setSelectedCommitHash(nextCommit?.hash ?? null);
    setSelectedDetails(null);
    setSelectedFiles([]);
  }, [commits]);

  const loadBranches = useCallback(async () => {
    if (!rootPath) {
      setRepoStatus(emptyRepoStatus());
      setBranches(emptyBranches());
      setCommits([]);
      setCommitGraph([]);
      setSelectedCommitHash(null);
      setSelectedDetails(null);
      setSelectedFiles([]);
      setBranchesError("No workspace open.");
      return;
    }

    const requestToken = ++requestTokenRef.current;
    setLoading((current) => ({ ...current, branches: true }));
    setBranchesError(null);
    setCommitsError(null);
    setDetailsError(null);

    try {
      const [status, nextBranches] = await Promise.all([
        gateway.getRepoStatus(rootPath),
        gateway.getBranches(rootPath),
      ]);

      if (requestToken !== requestTokenRef.current) {
        return;
      }

      setRepoStatus(status);
      setBranches(nextBranches);

      if (!status.gitAvailable || !status.isRepository) {
        setCommits([]);
        setCommitGraph([]);
        setSelectedCommitHash(null);
        setSelectedDetails(null);
        setSelectedFiles([]);
      }
    } catch (nextError: unknown) {
      if (requestToken !== requestTokenRef.current) {
        return;
      }

      setRepoStatus(emptyRepoStatus());
      setBranches(emptyBranches());
      setCommits([]);
      setCommitGraph([]);
      setSelectedCommitHash(null);
      setSelectedDetails(null);
      setSelectedFiles([]);
      setBranchesError("Failed to load git repository info.");
      console.error(nextError);
    } finally {
      if (requestToken === requestTokenRef.current) {
        setLoading((current) => ({ ...current, branches: false }));
      }
    }
  }, [gateway, rootPath]);

  const loadCommits = useCallback(async () => {
    if (!rootPath || !repoStatus.isRepository) {
      return;
    }

    const requestToken = ++requestTokenRef.current;
    setLoading((current) => ({ ...current, commits: true }));
    setCommitsError(null);
    setDetailsError(null);

    try {
      const nextCommitsResult = await Promise.all([
        gateway.getCommitLog(rootPath, {
          author: authorFilter || undefined,
          branch: branchFilter,
          limit: 500,
          path: pathFilter || undefined,
          query: query || undefined,
        }),
        gateway.getCommitGraphPage(rootPath, null),
      ]);

      if (requestToken !== requestTokenRef.current) {
        return;
      }

      const [nextCommits, nextGraph] = nextCommitsResult;
      const nextSelectedHash =
        selectedCommitHash && nextCommits.some((commit) => commit.hash === selectedCommitHash)
          ? selectedCommitHash
          : nextCommits[0]?.hash ?? null;

      setCommits(nextCommits);
      setCommitGraph(nextGraph);

      if (nextSelectedHash !== selectedCommitHash) {
        setSelectedDetails(null);
        setSelectedFiles([]);
      }

      setSelectedCommitHash(nextSelectedHash);
    } catch (nextError: unknown) {
      if (requestToken !== requestTokenRef.current) {
        return;
      }

      setCommits([]);
      setCommitGraph([]);
      setSelectedCommitHash(null);
      setSelectedDetails(null);
      setSelectedFiles([]);
      setCommitsError("Failed to load commit log.");
      console.error(nextError);
    } finally {
      if (requestToken === requestTokenRef.current) {
        setLoading((current) => ({ ...current, commits: false }));
      }
    }
  }, [
    authorFilter,
    branchFilter,
    gateway,
    pathFilter,
    query,
    repoStatus.isRepository,
    rootPath,
    selectedCommitHash,
  ]);

  const loadSelectedCommitDetails = useCallback(async () => {
    if (!rootPath || !selectedCommitHash || !repoStatus.isRepository) {
      return;
    }

    const requestToken = ++requestTokenRef.current;
    setLoading((current) => ({ ...current, details: true }));
    setDetailsError(null);

    try {
      const [details, files] = await Promise.all([
        gateway.getCommitDetails(rootPath, selectedCommitHash),
        gateway.getCommitFiles(rootPath, selectedCommitHash),
      ]);

      if (requestToken !== requestTokenRef.current) {
        return;
      }

      setSelectedDetails(details);
      setSelectedFiles(files);
    } catch (nextError: unknown) {
      if (requestToken !== requestTokenRef.current) {
        return;
      }

      setSelectedDetails(emptyCommitDetails(selectedCommitHash));
      setSelectedFiles([]);
      setDetailsError("Failed to load selected commit data.");
      console.error(nextError);
    } finally {
      if (requestToken === requestTokenRef.current) {
        setLoading((current) => ({ ...current, details: false }));
      }
    }
  }, [gateway, rootPath, repoStatus.isRepository, selectedCommitHash]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    void loadCommits();
  }, [loadCommits]);

  useEffect(() => {
    void loadSelectedCommitDetails();
  }, [loadSelectedCommitDetails]);

  useEffect(() => {
    resetSelection();
  }, [repoStatus.isRepository, resetSelection]);

  useLayoutEffect(() => {
    if (!commitListRef.current || !shouldVirtualize) {
      return;
    }

    const updateHeight = () => {
      setCommitListViewportHeight(
        measureGitHistoryViewportHeight(commitListRef.current),
      );
    };

    updateHeight();
    const animationFrame = requestAnimationFrame(updateHeight);

    if (typeof ResizeObserver === "undefined") {
      return () => cancelAnimationFrame(animationFrame);
    }

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(commitListRef.current);
    if (commitListRef.current.parentElement) {
      resizeObserver.observe(commitListRef.current.parentElement);
    }

    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
    };
  }, [shouldVirtualize]);

  useEffect(() => {
    if (!commitListRef.current || !shouldVirtualize) {
      return;
    }

    if (normalizedCommitScrollTop !== commitListScrollTop) {
      commitListRef.current.scrollTop = normalizedCommitScrollTop;
      setCommitListScrollTop(normalizedCommitScrollTop);
    }
  }, [normalizedCommitScrollTop, commitListScrollTop, shouldVirtualize]);

  useEffect(() => {
    if (!shouldVirtualize || selectedIndex === -1) {
      return;
    }

    ensureCommitIndexVisible(selectedIndex);
  }, [ensureCommitIndexVisible, selectedIndex, shouldVirtualize]);

  const handleCommitListScroll = (event: UIEvent<HTMLDivElement>) => {
    pendingCommitListScrollTopRef.current = event.currentTarget.scrollTop;

    if (!shouldVirtualize) {
      return;
    }

    if (commitListScrollAnimationRef.current !== null) {
      return;
    }

    commitListScrollAnimationRef.current = requestAnimationFrame(() => {
      commitListScrollAnimationRef.current = null;
      setCommitListScrollTop(pendingCommitListScrollTopRef.current);
    });
  };

  const onSelectCommit = useCallback(
    (commitHash: string) => {
      setSelectedCommitHash(commitHash);
    },
    [],
  );

  const onCommitKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (commits.length === 0 || selectedIndex === -1) {
        return;
      }

      let nextIndex = selectedIndex;

      if (event.key === "ArrowDown") {
        nextIndex = Math.min(selectedIndex + 1, commits.length - 1);
      } else if (event.key === "ArrowUp") {
        nextIndex = Math.max(selectedIndex - 1, 0);
      } else if (event.key === "Home") {
        nextIndex = 0;
      } else if (event.key === "End") {
        nextIndex = commits.length - 1;
      } else if (event.key === "PageUp") {
        nextIndex = Math.max(selectedIndex - pageSize, 0);
      } else if (event.key === "PageDown") {
        nextIndex = Math.min(selectedIndex + pageSize, commits.length - 1);
      } else {
        return;
      }

      if (nextIndex === selectedIndex) {
        return;
      }

      event.preventDefault();
      onSelectCommit(commits[nextIndex]?.hash ?? selectedCommitHash ?? "");
      ensureCommitIndexVisible(nextIndex);
    },
    [commits, ensureCommitIndexVisible, pageSize, onSelectCommit, selectedCommitHash, selectedIndex],
  );

  const onCommitSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setQuery(event.target.value);
    },
    [],
  );

  const onAuthorSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setAuthorFilter(event.target.value);
    },
    [],
  );

  const onPathSearch = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      setPathFilter(event.target.value);
    },
    [],
  );

  const onRefreshBranches = useCallback(() => {
    void loadBranches();
  }, [loadBranches]);

  const onRefreshCommits = useCallback(() => {
    void loadCommits();
  }, [loadCommits]);

  const onRefreshCommitDetails = useCallback(() => {
    void loadSelectedCommitDetails();
  }, [loadSelectedCommitDetails]);

  const onOpenFile = useCallback(
    (file: FileChange) => {
      if (!selectedCommit) {
        return;
      }

      void onOpenCommitFileDiff(
        selectedCommit.hash,
        file.path,
        file.oldPath ?? null,
      );
    },
    [onOpenCommitFileDiff, selectedCommit],
  );

  if (!rootPath) {
    return (
      <div className="git-history-empty">
        <p>No workspace</p>
      </div>
    );
  }

  if (loading.branches) {
    return (
      <div className="git-history-empty">
        <p>Loading Git history</p>
      </div>
    );
  }

  if (!repoStatus.gitAvailable) {
    return (
      <div className="git-history-empty">
        <p>Git is not available</p>
        <p className="git-history-message-subtle">Install Git to enable history views.</p>
      </div>
    );
  }

  if (!repoStatus.isRepository) {
    return (
      <div className="git-history-empty">
        <p>No Git repository</p>
        <p className="git-history-message-subtle">
          Open a folder with a .git directory or initialize a repository first.
        </p>
      </div>
    );
  }

  return (
    <section className="git-history-panel" aria-label="Git history panel">
      <div className="git-history-layout">
        <aside className="git-history-branches">
          <header className="git-history-section-header">
            <span>
              <GitBranch aria-hidden="true" size={14} />
              Branches
            </span>
            <button
              onClick={onRefreshBranches}
              title="Refresh branches"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={13} />
              Refresh
            </button>
          </header>
          <div className="git-history-current-branch">
            <p>HEAD (Current Branch)</p>
            <strong>{branches.current || "detached"}</strong>
          </div>
          <button
            aria-pressed={branchFilter === null}
            className={`git-history-branch-row ${
              branchFilter === null ? "selected" : ""
            }`}
            onClick={() => setBranchFilter(null)}
            type="button"
          >
            <span>All branches</span>
          </button>
          <div className="git-history-group">
            <button
              aria-expanded={localExpanded}
              className="git-history-group-toggle"
              onClick={() => setLocalExpanded((value) => !value)}
              type="button"
            >
              {localExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <span>Local</span>
            </button>
            {localExpanded ? (
              <div>
                {branchEntries.map((entry) => (
                  <button
                    className={`git-history-branch-row ${
                      branchFilter === entry.branch ? "selected" : ""
                    }`}
                    key={`local:${entry.branch}`}
                    onClick={() => setBranchFilter(entry.branch)}
                    type="button"
                  >
                    <span>{entry.branch}</span>
                    {entry.branch === branches.current ? (
                      <small>current</small>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <div className="git-history-group">
            <button
              aria-expanded={remoteExpanded}
              className="git-history-group-toggle"
              onClick={() => setRemoteExpanded((value) => !value)}
              type="button"
            >
              {remoteExpanded ? (
                <ChevronDown size={12} />
              ) : (
                <ChevronRight size={12} />
              )}
              <span>Remotes</span>
            </button>
            {remoteExpanded ? (
              <div>
                {remoteEntries.map((entry) => (
                  <button
                    className={`git-history-branch-row ${
                      branchFilter === `${entry.group}/${entry.branch}`
                        ? "selected"
                        : ""
                    }`}
                    key={`${entry.group}:${entry.branch}`}
                    onClick={() =>
                      setBranchFilter(`${entry.group}/${entry.branch}`)
                    }
                    type="button"
                  >
                    <span>
                      {entry.group}/{entry.branch}
                    </span>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </aside>
        <section className="git-history-commits">
          <header className="git-history-section-header">
            <span>Commit Log</span>
            {commitsError ? (
              <small className="git-history-inline-error">{commitsError}</small>
            ) : null}
          </header>
          <div className="git-history-filters">
            <label className="git-history-filter">
              <Search aria-hidden="true" size={13} />
              <input
                onChange={onCommitSearch}
                placeholder="Search subject/hash"
                value={query}
              />
            </label>
            <label className="git-history-filter">
              <input
                onChange={onAuthorSearch}
                placeholder="Author"
                value={authorFilter}
              />
            </label>
            <label className="git-history-filter">
              <input
                onChange={onPathSearch}
                placeholder="Path"
                value={pathFilter}
              />
            </label>
          </div>
          {loading.commits ? (
            <div className="git-history-empty">
              <p>Loading commits</p>
            </div>
          ) : commits.length === 0 ? (
            <div className="git-history-empty">
              <p>No commits yet</p>
              <button
                className="git-history-refresh"
                onClick={onRefreshCommits}
                type="button"
              >
                Retry
              </button>
            </div>
          ) : (
            <div
              className="git-history-commit-list"
              onKeyDown={onCommitKeyDown}
              onScroll={handleCommitListScroll}
              ref={commitListRef}
              role="listbox"
              tabIndex={0}
            >
              <div
                className="git-history-commit-list-inner"
                style={{ height: `${totalCommitListHeight}px` }}
              >
                <div
                  className="git-history-commit-window"
                  style={{ transform: `translateY(${visibleCommitOffset}px)` }}
                >
                  {visibleCommits.map((commit) => {
                    const isSelected = commit.hash === selectedCommitHash;
                    const node = commitGraphIndex.get(commit.hash);
                    const glyph = commitGraphGlyph(node, commit);
                    const graphDepth = Math.min(node?.depth ?? 0, 5);

                    return (
                      <button
                        aria-selected={isSelected}
                        className={`git-history-commit-row ${
                          isSelected ? "selected" : ""
                        } ${node?.isMerge ? "git-history-commit-row--merge" : ""}`}
                        key={commit.hash}
                        onClick={() => onSelectCommit(commit.hash)}
                        role="option"
                        type="button"
                      >
                        <span
                          className="git-history-commit-graph"
                          style={{ paddingLeft: `${graphDepth * 8}px` }}
                          title={node?.isMerge ? "Merge commit" : "Commit"}
                        >
                          {glyph}
                        </span>
                        <span className="git-history-commit-subject">
                          {commit.subject}
                        </span>
                        <span className="git-history-commit-meta">
                          {commit.authorName || "Unknown author"} · {" "}
                          {formatCommitDate(commit.date)}
                        </span>
                        <span className="git-history-commit-hash">
                          {commit.abbrevHash}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </section>
        <section className="git-history-details">
          <header className="git-history-section-header">
            <span>Commit Details</span>
            <button
              className="git-history-refresh"
              onClick={onRefreshCommitDetails}
              title="Refresh selected commit"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={13} />
              Refresh
            </button>
          </header>
          {!selectedCommit ? (
            <div className="git-history-empty">
              <p>No commit selected</p>
            </div>
          ) : loading.details ? (
            <div className="git-history-empty">
              <p>Loading commit files</p>
            </div>
          ) : !selectedDetails ? (
            <div className="git-history-empty">
              <p>Loading commit metadata</p>
            </div>
          ) : (
            <div className="git-history-details-content">
              <div className="git-history-commit-meta-panel">
                <div className="git-history-commit-title-line">
                  <strong>{selectedDetails.subject}</strong>
                  <span>{selectedDetails.abbrevHash}</span>
                </div>
                <p>{selectedDetails.body || selectedCommit.subject}</p>
                <p>
                  {selectedDetails.authorName || "Unknown"}
                  {selectedDetails.authorEmail ? ` · ${selectedDetails.authorEmail}` : ""}
                </p>
                <p>{formatCommitDate(selectedDetails.date)}</p>
                {selectedDetails.labels.length > 0 ? (
                  <div className="git-history-labels">
                    {selectedDetails.labels.map((label) => (
                      <span key={label}>{label}</span>
                    ))}
                  </div>
                ) : null}
                {selectedDetails.containingBranches.length > 0 ? (
                  <div className="git-history-branches-line">
                    {selectedDetails.containingBranches.join(", ")}
                  </div>
                ) : null}
              </div>
              {detailsError ? (
                <div className="git-history-empty">
                  <p>{detailsError}</p>
                  <button
                    className="git-history-refresh"
                    onClick={onRefreshCommitDetails}
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              ) : selectedFiles.length === 0 ? (
                <div className="git-history-empty">
                  <p>No changed files</p>
                  <button
                    className="git-history-refresh"
                    onClick={onRefreshCommitDetails}
                    type="button"
                  >
                    Retry
                  </button>
                </div>
              ) : (
                <div className="git-history-files">
                  {commitFilesByFolder.map(([folder, files]) => (
                    <div
                      key={folder || "_root"}
                      className="git-history-file-group"
                    >
                      <header>
                        <span>{folder || "(root)"}</span>
                      </header>
                      <div className="git-history-file-rows">
                        {files.map((file) => (
                          <button
                            key={`${file.path}-${
                              file.oldPath ?? file.newPath ?? "null"}`}
                            className="git-history-file-row"
                            onClick={() => onOpenFile(file)}
                            type="button"
                          >
                            <span
                              className={`git-history-file-status status-${file.status.toLowerCase()}`}
                              title={statusLabel(file.status)}
                            >
                              {statusIcon(file.status)}
                            </span>
                            <span className="git-history-file-path">
                              {file.isRename
                                ? `${file.oldPath} → ${file.path}`
                                : file.path}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
});

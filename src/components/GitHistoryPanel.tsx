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
  CSSProperties,
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
const COMMIT_LOG_PAGE_SIZE = 200;
const COMMIT_LOG_LOAD_MORE_THRESHOLD_PX = 360;
const COMMIT_GRAPH_WIDTH = 76;
const COMMIT_GRAPH_ROW_HEIGHT = 30;
const COMMIT_GRAPH_LANE_GAP = 11;
const COMMIT_GRAPH_LANE_START = 9;
const COMMIT_GRAPH_MAX_DEPTH = 5;
const COMMIT_GRAPH_COLORS = [
  "var(--color-accent)",
  "var(--color-success)",
  "var(--color-warning)",
  "#a78bfa",
  "#38bdf8",
  "#f472b6",
  "#fb7185",
];

interface GitHistoryPanelProps {
  rootPath: string | null;
  gateway: GitHistoryGateway;
  onOpenCommitFileDiff(
    commitHash: string,
    path: string,
    oldPath: string | null,
    files?: FileChange[],
  ): Promise<void> | void;
}

type HistoryError = string | null;

interface CommitGraphLane {
  colorIndex: number;
  depth: number;
}

interface RenderedCommitGraphNode extends CommitGraphNode {
  activeLanes: CommitGraphLane[];
  colorIndex: number;
  mergeLanes: CommitGraphLane[];
}

type CommitGraphByHash = Map<string, RenderedCommitGraphNode>;

interface FileTreeNode {
  children: Map<string, FileTreeNode>;
  file: FileChange | null;
  name: string;
}

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

function commitGraphByHash(nodes: RenderedCommitGraphNode[]): CommitGraphByHash {
  const graph = new Map<string, RenderedCommitGraphNode>();

  for (const node of nodes) {
    graph.set(node.hash, node);
  }

  return graph;
}

function graphColor(index: number): string {
  return COMMIT_GRAPH_COLORS[index % COMMIT_GRAPH_COLORS.length];
}

function graphX(depth: number): number {
  return COMMIT_GRAPH_LANE_START +
    Math.min(Math.max(depth, 0), COMMIT_GRAPH_MAX_DEPTH) *
      COMMIT_GRAPH_LANE_GAP;
}

function buildCommitGraph(commits: Commit[]): RenderedCommitGraphNode[] {
  const childrenByParent = new Map<string, string[]>();

  for (const commit of commits) {
    for (const parent of commit.parents) {
      const children = childrenByParent.get(parent) ?? [];
      children.push(commit.hash);
      childrenByParent.set(parent, children);
    }
  }

  const lanes: Array<{ colorIndex: number; hash: string } | null> = [];
  let nextColorIndex = 0;

  const nextColor = () => nextColorIndex++;

  return commits.map((commit) => {
    let depth = lanes.findIndex((lane) => lane?.hash === commit.hash);

    if (depth === -1) {
      depth = lanes.findIndex((lane) => lane === null);
    }

    if (depth === -1) {
      depth = lanes.length;
    }

    if (!lanes[depth]) {
      lanes[depth] = {
        colorIndex: nextColor(),
        hash: commit.hash,
      };
    }

    const colorIndex = lanes[depth]?.colorIndex ?? 0;
    const activeLanes = lanes
      .map((lane, laneDepth) =>
        lane ? { colorIndex: lane.colorIndex, depth: laneDepth } : null,
      )
      .filter((lane): lane is CommitGraphLane => lane !== null);

    if (!activeLanes.some((lane) => lane.depth === depth)) {
      activeLanes.push({ colorIndex, depth });
    }

    const parents = commit.parents.filter(Boolean);
    const [firstParent, ...additionalParents] = parents;
    const mergeLanes: CommitGraphLane[] = [];
    lanes[depth] = firstParent
      ? {
        colorIndex,
        hash: firstParent,
      }
      : null;

    for (const parent of additionalParents) {
      const existingLane = lanes.findIndex((lane) => lane?.hash === parent);

      if (existingLane !== -1) {
        const lane = lanes[existingLane];
        if (lane) {
          mergeLanes.push({
            colorIndex: lane.colorIndex,
            depth: existingLane,
          });
        }
        continue;
      }

      const emptyLane = lanes.findIndex((lane) => lane === null);
      const nextLane = {
        colorIndex: nextColor(),
        hash: parent,
      };

      if (emptyLane === -1) {
        lanes.push(nextLane);
        mergeLanes.push({
          colorIndex: nextLane.colorIndex,
          depth: lanes.length - 1,
        });
      } else {
        lanes[emptyLane] = nextLane;
        mergeLanes.push({
          colorIndex: nextLane.colorIndex,
          depth: emptyLane,
        });
      }
    }

    while (lanes.length > 0 && lanes[lanes.length - 1] === null) {
      lanes.pop();
    }

    return {
      children: childrenByParent.get(commit.hash) ?? [],
      commit,
      depth,
      hash: commit.hash,
      isMerge: parents.length > 1,
      activeLanes,
      colorIndex,
      mergeLanes,
    };
  });
}

function CommitGraphCell(props: {
  commit: Commit;
  node: RenderedCommitGraphNode | undefined;
}) {
  const { commit, node } = props;
  const depth = Math.min(Math.max(node?.depth ?? 0, 0), COMMIT_GRAPH_MAX_DEPTH);
  const nodeX = graphX(depth);
  const isMerge = node?.isMerge ?? commit.parents.length > 1;
  const hasFork = (node?.children.length ?? 0) > 1;
  const title = isMerge ? "Merge commit" : hasFork ? "Branch point" : "Commit";
  const activeLanes = node?.activeLanes ?? [{ colorIndex: 0, depth }];
  const mergeLanes =
    node?.mergeLanes.length ? node.mergeLanes : hasFork
      ? [{ colorIndex: (node?.colorIndex ?? 0) + 1, depth: depth + 1 }]
      : [];
  const nodeColor = graphColor(node?.colorIndex ?? 0);
  const nodeY = COMMIT_GRAPH_ROW_HEIGHT / 2;

  return (
    <span className="git-history-commit-graph" title={title}>
      <svg
        aria-hidden="true"
        className="git-history-commit-graph-svg"
        focusable="false"
        viewBox={`0 0 ${COMMIT_GRAPH_WIDTH} ${COMMIT_GRAPH_ROW_HEIGHT}`}
      >
        {activeLanes.map((lane) => {
          const laneX = graphX(lane.depth);

          return (
            <line
              className="git-history-commit-graph-line"
              key={`lane:${lane.depth}:${lane.colorIndex}`}
              style={{ stroke: graphColor(lane.colorIndex) }}
              x1={laneX}
              x2={laneX}
              y1="-1"
              y2={COMMIT_GRAPH_ROW_HEIGHT + 1}
            />
          );
        })}
        {mergeLanes.map((lane) => {
          const targetX = graphX(lane.depth);
          const endY = COMMIT_GRAPH_ROW_HEIGHT + 2;

          return (
            <path
              className="git-history-commit-graph-branch"
              d={`M ${nodeX} ${nodeY} C ${nodeX} ${COMMIT_GRAPH_ROW_HEIGHT - 2} ${targetX} ${COMMIT_GRAPH_ROW_HEIGHT - 2} ${targetX} ${endY}`}
              key={`merge:${lane.depth}:${lane.colorIndex}`}
              style={{ stroke: graphColor(lane.colorIndex) }}
            />
          );
        })}
        {hasFork && mergeLanes.length === 0 ? (
          <path
            className="git-history-commit-graph-branch"
            d={`M ${nodeX} ${nodeY} C ${nodeX + 4} ${COMMIT_GRAPH_ROW_HEIGHT - 2} ${nodeX + 10} ${COMMIT_GRAPH_ROW_HEIGHT - 2} ${nodeX + COMMIT_GRAPH_LANE_GAP} ${COMMIT_GRAPH_ROW_HEIGHT - 1}`}
            style={{ stroke: graphColor((node?.colorIndex ?? 0) + 1) }}
          />
        ) : null}
        <circle
          className={`git-history-commit-graph-node ${
            isMerge ? "git-history-commit-graph-node--merge" : ""
          }`}
          cx={nodeX}
          cy={nodeY}
          style={{ fill: isMerge ? nodeColor : "var(--color-bg)", stroke: nodeColor }}
          r={isMerge ? 4 : 3}
        />
      </svg>
    </span>
  );
}

function appendUniqueCommits(current: Commit[], next: Commit[]): Commit[] {
  if (next.length === 0) {
    return current;
  }

  const seen = new Set(current.map((commit) => commit.hash));
  const uniqueNext = next.filter((commit) => !seen.has(commit.hash));
  return uniqueNext.length === 0 ? current : [...current, ...uniqueNext];
}

function createFileTreeNode(name: string): FileTreeNode {
  return {
    children: new Map(),
    file: null,
    name,
  };
}

function buildFileTree(files: FileChange[]): FileTreeNode {
  const root = createFileTreeNode("");

  for (const file of files.slice().sort((a, b) => a.path.localeCompare(b.path))) {
    const parts = file.path.split("/").filter(Boolean);
    let node = root;

    for (const part of parts.slice(0, -1)) {
      const existing = node.children.get(part);
      const child = existing ?? createFileTreeNode(part);

      if (!existing) {
        node.children.set(part, child);
      }

      node = child;
    }

    const fileName = parts[parts.length - 1] ?? file.path;
    const fileNode = node.children.get(fileName) ?? createFileTreeNode(fileName);
    fileNode.file = file;
    node.children.set(fileName, fileNode);
  }

  return root;
}

function sortedFileTreeChildren(node: FileTreeNode): FileTreeNode[] {
  return [...node.children.values()].sort((left, right) => {
    if (left.file && !right.file) {
      return 1;
    }

    if (!left.file && right.file) {
      return -1;
    }

    return left.name.localeCompare(right.name);
  });
}

function fileTreeDepthStyle(
  depth: number,
): CSSProperties & Record<"--git-history-file-depth", number> {
  return { "--git-history-file-depth": depth };
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
  const [, setBranchesError] = useState<HistoryError>(null);
  const [commitsError, setCommitsError] = useState<HistoryError>(null);
  const [detailsError, setDetailsError] = useState<HistoryError>(null);
  const [localExpanded, setLocalExpanded] = useState(true);
  const [remoteExpanded, setRemoteExpanded] = useState(true);
  const [commitGraph, setCommitGraph] = useState<RenderedCommitGraphNode[]>([]);
  const [hasMoreCommits, setHasMoreCommits] = useState(false);
  const [loadingMoreCommits, setLoadingMoreCommits] = useState(false);
  const [commitListScrollTop, setCommitListScrollTop] = useState(0);
  const [commitListViewportHeight, setCommitListViewportHeight] = useState(0);
  const commitListRef = useRef<HTMLDivElement | null>(null);
  const pendingCommitListScrollTopRef = useRef(0);
  const commitListScrollAnimationRef = useRef<number | null>(null);
  const branchesRequestTokenRef = useRef(0);
  const commitsRequestTokenRef = useRef(0);
  const detailsRequestTokenRef = useRef(0);
  const selectedCommitHashRef = useRef<string | null>(null);
  const lastAutoScrolledCommitHashRef = useRef<string | null>(null);
  const currentRootPathRef = useRef(rootPath);

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

  const commitFileTree = useMemo(
    () => buildFileTree(selectedFiles),
    [selectedFiles],
  );

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

  useEffect(() => {
    selectedCommitHashRef.current = selectedCommitHash;
  }, [selectedCommitHash]);

  useEffect(() => {
    currentRootPathRef.current = rootPath;
  }, [rootPath]);

  const isCurrentRootPath = useCallback(
    (requestedRootPath: string | null) =>
      currentRootPathRef.current === requestedRootPath,
    [],
  );

  const invalidateHistoryRequests = useCallback(() => {
    branchesRequestTokenRef.current += 1;
    commitsRequestTokenRef.current += 1;
    detailsRequestTokenRef.current += 1;
  }, []);

  const loadBranches = useCallback(async () => {
    if (!rootPath) {
      invalidateHistoryRequests();
      setRepoStatus(emptyRepoStatus());
      setBranches(emptyBranches());
      setCommits([]);
      setCommitGraph([]);
      setHasMoreCommits(false);
      setSelectedCommitHash(null);
      setSelectedDetails(null);
      setSelectedFiles([]);
      setBranchesError("No workspace open.");
      return;
    }

    const requestToken = ++branchesRequestTokenRef.current;
    setLoading((current) => ({ ...current, branches: true }));
    setBranchesError(null);
    setCommitsError(null);
    setDetailsError(null);

    try {
      const [status, nextBranches] = await Promise.all([
        gateway.getRepoStatus(rootPath),
        gateway.getBranches(rootPath),
      ]);

      if (
        requestToken !== branchesRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      setRepoStatus(status);
      setBranches(nextBranches);

      if (!status.gitAvailable || !status.isRepository) {
        commitsRequestTokenRef.current += 1;
        detailsRequestTokenRef.current += 1;
        setCommits([]);
        setCommitGraph([]);
        setHasMoreCommits(false);
        setSelectedCommitHash(null);
        setSelectedDetails(null);
        setSelectedFiles([]);
      }
    } catch (nextError: unknown) {
      if (
        requestToken !== branchesRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      commitsRequestTokenRef.current += 1;
      detailsRequestTokenRef.current += 1;
      setRepoStatus(emptyRepoStatus());
      setBranches(emptyBranches());
      setCommits([]);
      setCommitGraph([]);
      setHasMoreCommits(false);
      setSelectedCommitHash(null);
      setSelectedDetails(null);
      setSelectedFiles([]);
      setBranchesError("Failed to load git repository info.");
      console.error(nextError);
    } finally {
      if (
        requestToken === branchesRequestTokenRef.current &&
        isCurrentRootPath(rootPath)
      ) {
        setLoading((current) => ({ ...current, branches: false }));
      }
    }
  }, [gateway, invalidateHistoryRequests, isCurrentRootPath, rootPath]);

  const loadCommits = useCallback(async () => {
    if (!rootPath || !repoStatus.isRepository) {
      commitsRequestTokenRef.current += 1;
      detailsRequestTokenRef.current += 1;
      return;
    }

    const requestToken = ++commitsRequestTokenRef.current;
    setLoading((current) => ({ ...current, commits: true }));
    setCommitsError(null);
    setDetailsError(null);

    try {
      const nextCommits = await gateway.getCommitLog(rootPath, {
        author: authorFilter || undefined,
        branch: branchFilter,
        cursor: undefined,
        limit: COMMIT_LOG_PAGE_SIZE,
        path: pathFilter || undefined,
        query: query || undefined,
      });

      if (
        requestToken !== commitsRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      const currentSelectedHash = selectedCommitHashRef.current;
      const nextSelectedHash =
        currentSelectedHash && nextCommits.some((commit) => commit.hash === currentSelectedHash)
          ? currentSelectedHash
          : nextCommits[0]?.hash ?? null;

      setCommits(nextCommits);
      setCommitGraph(buildCommitGraph(nextCommits));
      setHasMoreCommits(nextCommits.length === COMMIT_LOG_PAGE_SIZE);
      setLoadingMoreCommits(false);
      lastAutoScrolledCommitHashRef.current = null;
      setCommitListScrollTop(0);
      pendingCommitListScrollTopRef.current = 0;
      if (commitListRef.current) {
        commitListRef.current.scrollTop = 0;
      }

      if (nextSelectedHash !== currentSelectedHash) {
        setSelectedDetails(null);
        setSelectedFiles([]);
      }

      selectedCommitHashRef.current = nextSelectedHash;
      setSelectedCommitHash(nextSelectedHash);
    } catch (nextError: unknown) {
      if (
        requestToken !== commitsRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      detailsRequestTokenRef.current += 1;
      setCommits([]);
      setCommitGraph([]);
      setHasMoreCommits(false);
      setLoadingMoreCommits(false);
      setSelectedCommitHash(null);
      setSelectedDetails(null);
      setSelectedFiles([]);
      setCommitsError("Failed to load commit log.");
      console.error(nextError);
    } finally {
      if (
        requestToken === commitsRequestTokenRef.current &&
        isCurrentRootPath(rootPath)
      ) {
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
    isCurrentRootPath,
    rootPath,
  ]);

  const loadMoreCommits = useCallback(async () => {
    if (
      !rootPath ||
      !repoStatus.isRepository ||
      loading.commits ||
      loadingMoreCommits ||
      !hasMoreCommits
    ) {
      return;
    }

    const requestToken = commitsRequestTokenRef.current;
    const cursor = String(commits.length);
    setLoadingMoreCommits(true);

    try {
      const nextCommits = await gateway.getCommitLog(rootPath, {
        author: authorFilter || undefined,
        branch: branchFilter,
        cursor,
        limit: COMMIT_LOG_PAGE_SIZE,
        path: pathFilter || undefined,
        query: query || undefined,
      });

      if (
        requestToken !== commitsRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      setCommits((currentCommits) => {
        const combinedCommits = appendUniqueCommits(currentCommits, nextCommits);
        setCommitGraph(buildCommitGraph(combinedCommits));
        return combinedCommits;
      });
      setHasMoreCommits(nextCommits.length === COMMIT_LOG_PAGE_SIZE);
    } catch (nextError: unknown) {
      if (
        requestToken !== commitsRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      setHasMoreCommits(false);
      setCommitsError("Failed to load more commits.");
      console.error(nextError);
    } finally {
      if (
        requestToken === commitsRequestTokenRef.current &&
        isCurrentRootPath(rootPath)
      ) {
        setLoadingMoreCommits(false);
      }
    }
  }, [
    authorFilter,
    branchFilter,
    commits.length,
    gateway,
    hasMoreCommits,
    loading.commits,
    loadingMoreCommits,
    pathFilter,
    query,
    repoStatus.isRepository,
    isCurrentRootPath,
    rootPath,
  ]);

  const loadSelectedCommitDetails = useCallback(async () => {
    if (!rootPath || !selectedCommitHash || !repoStatus.isRepository) {
      detailsRequestTokenRef.current += 1;
      return;
    }

    const requestToken = ++detailsRequestTokenRef.current;
    setLoading((current) => ({ ...current, details: true }));
    setDetailsError(null);

    try {
      const [details, files] = await Promise.all([
        gateway.getCommitDetails(rootPath, selectedCommitHash),
        gateway.getCommitFiles(rootPath, selectedCommitHash),
      ]);

      if (
        requestToken !== detailsRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      setSelectedDetails(details);
      setSelectedFiles(files);
    } catch (nextError: unknown) {
      if (
        requestToken !== detailsRequestTokenRef.current ||
        !isCurrentRootPath(rootPath)
      ) {
        return;
      }

      setSelectedDetails(emptyCommitDetails(selectedCommitHash));
      setSelectedFiles([]);
      setDetailsError("Failed to load selected commit data.");
      console.error(nextError);
    } finally {
      if (
        requestToken === detailsRequestTokenRef.current &&
        isCurrentRootPath(rootPath)
      ) {
        setLoading((current) => ({ ...current, details: false }));
      }
    }
  }, [
    gateway,
    isCurrentRootPath,
    rootPath,
    repoStatus.isRepository,
    selectedCommitHash,
  ]);

  useEffect(() => {
    void loadBranches();
  }, [loadBranches]);

  useEffect(() => {
    void loadCommits();
  }, [loadCommits]);

  useEffect(() => {
    void loadSelectedCommitDetails();
  }, [loadSelectedCommitDetails]);

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
    if (
      !shouldVirtualize ||
      selectedIndex === -1 ||
      !selectedCommitHash ||
      lastAutoScrolledCommitHashRef.current === selectedCommitHash
    ) {
      return;
    }

    lastAutoScrolledCommitHashRef.current = selectedCommitHash;
    ensureCommitIndexVisible(selectedIndex);
  }, [ensureCommitIndexVisible, selectedCommitHash, selectedIndex, shouldVirtualize]);

  const handleCommitListScroll = (event: UIEvent<HTMLDivElement>) => {
    const { clientHeight, scrollHeight, scrollTop } = event.currentTarget;
    pendingCommitListScrollTopRef.current = event.currentTarget.scrollTop;

    if (
      scrollHeight - scrollTop - clientHeight <=
      COMMIT_LOG_LOAD_MORE_THRESHOLD_PX
    ) {
      void loadMoreCommits();
    }

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
      selectedCommitHashRef.current = commitHash;
      setSelectedDetails(null);
      setSelectedFiles([]);
      setDetailsError(null);
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
        selectedFiles,
      );
    },
    [onOpenCommitFileDiff, selectedCommit, selectedFiles],
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
              className="git-history-refresh"
              onClick={onRefreshBranches}
              title="Refresh branches"
              type="button"
            >
              <RefreshCw aria-hidden="true" size={13} />
              Refresh
            </button>
          </header>
          <div className="git-history-branch-body">
            <div className="git-history-current-branch">
              <p>HEAD</p>
              <strong title={branches.current || "detached"}>
                {branches.current || "detached"}
              </strong>
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
                      title={entry.branch}
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
                  {remoteEntries.map((entry) => {
                    const branch = `${entry.group}/${entry.branch}`;

                    return (
                      <button
                        className={`git-history-branch-row ${
                          branchFilter === branch ? "selected" : ""
                        }`}
                        key={`${entry.group}:${entry.branch}`}
                        onClick={() => setBranchFilter(branch)}
                        title={branch}
                        type="button"
                      >
                        <span>{branch}</span>
                      </button>
                    );
                  })}
                </div>
              ) : null}
            </div>
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
                aria-label="Search commits"
                onChange={onCommitSearch}
                placeholder="Search subject/hash"
                value={query}
              />
            </label>
            <label className="git-history-filter">
              <input
                aria-label="Filter commits by author"
                onChange={onAuthorSearch}
                placeholder="Author"
                value={authorFilter}
              />
            </label>
            <label className="git-history-filter">
              <input
                aria-label="Filter commits by path"
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
                        <CommitGraphCell commit={commit} node={node} />
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
          ) : detailsError ? (
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
              {selectedFiles.length === 0 ? (
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
                  <FileTreeRows
                    node={commitFileTree}
                    onOpenFile={onOpenFile}
                  />
                </div>
              )}
            </div>
          )}
        </section>
      </div>
    </section>
  );
});

interface FileTreeRowsProps {
  node: FileTreeNode;
  onOpenFile(file: FileChange): void;
  depth?: number;
}

function FileTreeRows({
  depth = 0,
  node,
  onOpenFile,
}: FileTreeRowsProps) {
  return (
    <>
      {sortedFileTreeChildren(node).map((child) => {
        const childRows =
          child.children.size > 0 ? (
            <FileTreeRows
              depth={depth + 1}
              node={child}
              onOpenFile={onOpenFile}
            />
          ) : null;

        if (child.file) {
          const file = child.file;

          return (
            <div
              className="git-history-file-folder"
              key={`file:${file.path}-${file.oldPath ?? file.newPath ?? "null"}`}
            >
              <button
                className="git-history-file-row"
                onClick={() => onOpenFile(file)}
                style={fileTreeDepthStyle(depth)}
                title={
                  file.isRename && file.oldPath
                    ? `${file.oldPath} -> ${file.path}`
                    : file.path
                }
                type="button"
              >
                <span
                  className={`git-history-file-status status-${file.status.toLowerCase()}`}
                  title={statusLabel(file.status)}
                >
                  {statusIcon(file.status)}
                </span>
                <span className="git-history-file-path">
                  {file.isRename && file.oldPath
                    ? `${file.oldPath} -> ${file.path}`
                    : child.name}
                </span>
              </button>
              {childRows}
            </div>
          );
        }

        return (
          <div
            className="git-history-file-folder"
            key={`folder:${depth}:${child.name}`}
          >
            <div
              className="git-history-file-folder-label"
              style={fileTreeDepthStyle(depth)}
              title={child.name}
            >
              <ChevronRight aria-hidden="true" size={12} />
              <span>{child.name}</span>
            </div>
            {childRows}
          </div>
        );
      })}
    </>
  );
}

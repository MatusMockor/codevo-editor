export interface GitHistoryGraphCommit {
  readonly hash: string;
  readonly parents: readonly string[];
}

export interface GitHistoryGraphPoint {
  readonly lane: number;
  readonly position: 0 | 0.5 | 1;
}

export interface GitHistoryGraphSegment {
  readonly from: GitHistoryGraphPoint;
  readonly to: GitHistoryGraphPoint;
  readonly color: number;
}

export interface GitHistoryGraphRow {
  readonly hash: string;
  readonly node: { readonly lane: number; readonly color: number } | null;
  readonly segments: readonly GitHistoryGraphSegment[];
  readonly omittedEdgeCount: number;
}

export interface GitHistoryGraph {
  readonly rows: readonly GitHistoryGraphRow[];
  readonly laneCount: number;
  readonly omittedCommitCount: number;
  readonly omittedEdgeCount: number;
  readonly invalidCommitHash: string | null;
}

export const GIT_HISTORY_GRAPH_COMMIT_LIMIT = 500;
export const GIT_HISTORY_GRAPH_LANE_LIMIT = 12;
const PARENT_LIMIT = 64;
const HASH_LENGTH_LIMIT = 128;

function validHash(hash: string): boolean {
  return hash.length > 0 && hash.length <= HASH_LENGTH_LIMIT;
}

function segment(
  fromLane: number,
  fromPosition: GitHistoryGraphPoint["position"],
  toLane: number,
  toPosition: GitHistoryGraphPoint["position"],
  colorLane: number,
): GitHistoryGraphSegment {
  return {
    from: { lane: fromLane, position: fromPosition },
    to: { lane: toLane, position: toPosition },
    color: colorLane,
  };
}

export function projectGitHistoryGraph(commits: readonly GitHistoryGraphCommit[]): GitHistoryGraph {
  const lanes: (string | null)[] = Array.from({ length: GIT_HISTORY_GRAPH_LANE_LIMIT }, () => null);
  const seen = new Set<string>();
  const rows: GitHistoryGraphRow[] = [];
  let laneCount = 0;
  let omittedEdgeCount = 0;
  let invalidCommitHash: string | null = null;
  for (
    let index = 0;
    index < Math.min(commits.length, GIT_HISTORY_GRAPH_COMMIT_LIMIT);
    index += 1
  ) {
    const commit = commits[index];
    if (
      !validHash(commit.hash) ||
      seen.has(commit.hash) ||
      commit.parents.length > PARENT_LIMIT ||
      new Set(commit.parents).size !== commit.parents.length ||
      commit.parents.some(
        (parent) => !validHash(parent) || parent === commit.hash || seen.has(parent),
      )
    ) {
      invalidCommitHash = commit.hash.slice(0, HASH_LENGTH_LIMIT);
      break;
    }
    seen.add(commit.hash);
    const incomingLane = lanes.indexOf(commit.hash);
    const nodeLane = incomingLane >= 0 ? incomingLane : lanes.indexOf(null);
    const segments: GitHistoryGraphSegment[] = [];
    for (let lane = 0; lane < lanes.length; lane += 1) {
      if (lanes[lane] === null) continue;
      if (lane === incomingLane) {
        segments.push(segment(lane, 0, lane, 0.5, lane));
        continue;
      }
      segments.push(segment(lane, 0, lane, 1, lane));
    }
    if (nodeLane < 0) {
      const omitted = commit.parents.length + 1;
      omittedEdgeCount += omitted;
      rows.push({ hash: commit.hash, node: null, segments, omittedEdgeCount: omitted });
      continue;
    }
    laneCount = Math.max(laneCount, nodeLane + 1);
    lanes[nodeLane] = null;
    let omitted = 0;
    for (const parent of commit.parents) {
      let parentLane = lanes.indexOf(parent);
      if (parentLane < 0) {
        parentLane = lanes[nodeLane] === null ? nodeLane : lanes.indexOf(null);
        if (parentLane < 0) {
          omitted += 1;
          continue;
        }
        lanes[parentLane] = parent;
      }
      laneCount = Math.max(laneCount, parentLane + 1);
      segments.push(segment(nodeLane, 0.5, parentLane, 1, parentLane));
    }
    omittedEdgeCount += omitted;
    rows.push({
      hash: commit.hash,
      node: { lane: nodeLane, color: nodeLane },
      segments,
      omittedEdgeCount: omitted,
    });
  }
  return {
    rows,
    laneCount,
    omittedCommitCount: commits.length - rows.length,
    omittedEdgeCount,
    invalidCommitHash,
  };
}

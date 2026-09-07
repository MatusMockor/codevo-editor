import { GitBranch, GitMerge, Tag } from "lucide-react";
import { useMemo, type CSSProperties } from "react";
import { historyDate } from "./agentHistoryPresentation";
import type { Commit } from "../../domain/git";
import { projectGitHistoryGraph, type GitHistoryGraphSegment } from "../../domain/gitHistoryGraph";

interface Props {
  readonly commits: readonly Commit[];
  readonly selectedHash: string | null;
  onSelect(hash: string): void;
}

export function AgentHistoryGraph({ commits, selectedHash, onSelect }: Props) {
  const graph = useMemo(() => projectGitHistoryGraph(commits), [commits]);
  const width = Math.max(42, graph.laneCount * 12 + 14);
  return (
    <>
      <div className="agent-history__graph-heading" aria-hidden="true">
        <span style={{ width }}>Graph</span>
        <span>Commit</span>
        <span>Author</span>
        <span>Date</span>
      </div>
      <div className="agent-history__commits" aria-label="Commits">
        {commits.length === 0 && <p className="agent-note">No commits in this repository yet.</p>}
        {commits.map((commit, index) => {
          const row = graph.rows[index];
          return (
            <button
              type="button"
              className="agent-history__commit"
              aria-pressed={selectedHash === commit.hash}
              key={commit.hash}
              onClick={() => onSelect(commit.hash)}
              title={`${commit.subject}\n${commit.authorName} · ${commit.date}\n${commit.hash}`}
            >
              <svg className="agent-history__graph" width={width} height={42} aria-hidden="true">
                {row?.segments.map((segment, segmentIndex) => (
                  <path
                    key={segmentIndex}
                    d={segmentPath(segment)}
                    style={graphColor(segment.color)}
                  />
                ))}
                {row?.node !== null && row?.node !== undefined && (
                  <circle
                    cx={laneX(row.node.lane)}
                    cy={21}
                    r={commit.parents.length > 1 ? 4 : 3}
                    style={graphColor(row.node.color)}
                    data-merge={commit.parents.length > 1}
                  />
                )}
              </svg>
              <span className="agent-history__commit-main">
                <span className="agent-history__subject-line">
                  <span className="agent-history__subject">{commit.subject}</span>
                  {commit.parents.length > 1 && (
                    <GitMerge
                      className="agent-history__merge"
                      size={12}
                      aria-label="Merge commit"
                    />
                  )}
                </span>
                <span className="agent-history__commit-secondary">
                  <CommitLabels labels={commit.labels} />
                  <span className="agent-history__compact-author">{commit.authorName}</span>
                  <code>{commit.abbrevHash}</code>
                </span>
              </span>
              <span className="agent-history__author">{commit.authorName}</span>
              <time dateTime={commit.date} className="agent-history__date">
                {historyDate(commit.date)}
              </time>
            </button>
          );
        })}
        {(graph.omittedCommitCount > 0 ||
          graph.omittedEdgeCount > 0 ||
          graph.invalidCommitHash !== null) && (
          <p className="agent-note">
            Some connections are hidden in this graph. Select a branch for a simpler view.
          </p>
        )}
      </div>
    </>
  );
}

function CommitLabels({ labels }: { readonly labels: readonly string[] }) {
  return (
    <>
      {labels.slice(0, 3).map((label, index) => {
        const tag = label.startsWith("tag: ");
        const text = label.replace(/^tag: |^HEAD -> |^refs\/heads\/|^refs\/remotes\//, "");
        return (
          <span
            className="agent-history__ref"
            data-tag={tag}
            key={`${label}:${index}`}
            title={label}
          >
            {tag ? <Tag size={9} /> : <GitBranch size={9} />}
            {text}
          </span>
        );
      })}
      {labels.length > 3 && (
        <span className="agent-history__ref" title={labels.slice(3).join(", ")}>
          +{labels.length - 3}
        </span>
      )}
    </>
  );
}

function laneX(lane: number): number {
  return 13 + lane * 12;
}
const laneColors = [
  "var(--history-lane-0)",
  "var(--history-lane-1)",
  "var(--history-lane-2)",
  "var(--history-lane-3)",
  "var(--history-lane-4)",
  "var(--history-lane-5)",
] as const;
function graphColor(color: number): CSSProperties {
  return { color: laneColors[color % laneColors.length] ?? laneColors[0] };
}
function segmentPath(segment: GitHistoryGraphSegment): string {
  const fromX = laneX(segment.from.lane);
  const toX = laneX(segment.to.lane);
  const fromY = segment.from.position * 42;
  const toY = segment.to.position * 42;
  if (fromX === toX) return `M ${fromX} ${fromY} L ${toX} ${toY}`;
  const middleY = (fromY + toY) / 2;
  return `M ${fromX} ${fromY} C ${fromX} ${middleY}, ${toX} ${middleY}, ${toX} ${toY}`;
}

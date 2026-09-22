import { memo, useId, useMemo, useState } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, FileDiff, Folder } from "lucide-react";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import {
  buildAgentTurnDiffTree,
  type TurnDiffTreeNode,
  type TurnDiffTreeStats,
} from "../../domain/agentTurnDiffTree";
import "./agentTurnChangesCard.css";

export interface AgentTurnChangesCardProps {
  readonly summary: AgentTurnChangeSummary;
  onOpenDiff(relativePath?: string): void;
}
function Stats({ stats }: { readonly stats: TurnDiffTreeStats }) {
  return (
    <span className="agent-turn-changes__stats">
      {stats.addedLines !== null && (
        <span className="agent-turn-changes__added">+{stats.addedLines}</span>
      )}
      {stats.deletedLines !== null && (
        <span className="agent-turn-changes__deleted">−{stats.deletedLines}</span>
      )}
    </span>
  );
}

/** Historical per-turn changes; this card does not substitute live working-tree totals. */
export const AgentTurnChangesCard = memo(function AgentTurnChangesCard({
  summary,
  onOpenDiff,
}: AgentTurnChangesCardProps) {
  const tree = useMemo(() => buildAgentTurnDiffTree(summary.files), [summary.files]);
  return (
    <TurnChangesContent
      key={summary.turnId}
      summary={summary}
      tree={tree}
      onOpenDiff={onOpenDiff}
    />
  );
});
function TurnChangesContent({
  summary,
  tree,
  onOpenDiff,
}: AgentTurnChangesCardProps & { readonly tree: ReturnType<typeof buildAgentTurnDiffTree> }) {
  const descriptionId = useId();
  const [allExpanded, setAllExpanded] = useState(false);
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const partial = summary.truncated || tree.truncated;
  const count = tree.stats.fileCount;
  if (summary.state === "ready" && count === 0 && !partial) return null;
  if (summary.state === "unavailable")
    return (
      <section
        className="agent-turn-changes agent-turn-changes--unavailable"
        aria-label="Changes in this turn"
      >
        <FileDiff size={14} aria-hidden="true" />
        <span>{summary.reason ?? "Changes for this turn are unavailable."}</span>
      </section>
    );
  const renderNode = (node: TurnDiffTreeNode, depth: number) => {
    if (node.kind === "directory") {
      const expanded = overrides.get(node.path) ?? allExpanded;
      return (
        <div key={`directory:${node.path}`}>
          <button
            type="button"
            className="agent-turn-changes__row agent-turn-changes__directory"
            style={{ paddingLeft: 8 + depth * 14 }}
            aria-expanded={expanded}
            onClick={() => setOverrides((current) => new Map(current).set(node.path, !expanded))}
            title={node.path}
          >
            <ChevronRight
              size={13}
              aria-hidden="true"
              className={expanded ? "is-expanded" : undefined}
            />
            <Folder size={14} aria-hidden="true" />
            <span className="agent-turn-changes__name">{node.name}</span>
            {node.stats.unknownFiles > 0 && (
              <span
                className="agent-turn-changes__unknown"
                title="Some line counts are unavailable"
              >
                Partial
              </span>
            )}
            <Stats stats={node.stats} />
          </button>
          {expanded && node.children.map((child) => renderNode(child, depth + 1))}
        </div>
      );
    }
    return (
      <button
        type="button"
        key={`file:${node.path}`}
        className="agent-turn-changes__row agent-turn-changes__file"
        style={{ paddingLeft: 29 + depth * 14 }}
        title={
          node.file.oldRelativePath ? `${node.file.oldRelativePath} → ${node.path}` : node.path
        }
        aria-label={`Open diff for ${node.path}`}
        aria-describedby={`${descriptionId}-${encodeURIComponent(node.path)}`}
        onClick={() => onOpenDiff(node.file.relativePath)}
      >
        <FileDiff size={14} aria-hidden="true" />
        <span
          className="agent-turn-changes__description"
          id={`${descriptionId}-${encodeURIComponent(node.path)}`}
        >
          {node.file.status}.{" "}
          {node.stats.addedLines === null
            ? "Added line count unavailable."
            : `${node.stats.addedLines} added lines.`}{" "}
          {node.stats.deletedLines === null
            ? "Deleted line count unavailable."
            : `${node.stats.deletedLines} deleted lines.`}
          {node.file.oldRelativePath ? ` Previously ${node.file.oldRelativePath}.` : ""}
        </span>
        <span className="agent-turn-changes__name">{node.name}</span>
        <span className="agent-turn-changes__status">{node.file.status}</span>
        {node.stats.unknownFiles > 0 && (
          <span className="agent-turn-changes__unknown">Line counts unavailable</span>
        )}
        <Stats stats={node.stats} />
      </button>
    );
  };
  const hasFolders = tree.nodes.some((node) => node.kind === "directory");
  return (
    <section className="agent-turn-changes" aria-label="Changes in this turn">
      <div className="agent-turn-changes__header">
        <strong>
          {partial ? "Showing " : ""}
          {count} changed {count === 1 ? "file" : "files"}
        </strong>
        <Stats stats={tree.stats} />
        <div className="agent-turn-changes__actions">
          {hasFolders && (
            <button
              type="button"
              title={allExpanded ? "Collapse all folders" : "Expand all folders"}
              aria-label={allExpanded ? "Collapse all folders" : "Expand all folders"}
              onClick={() => {
                setAllExpanded(!allExpanded);
                setOverrides(new Map());
              }}
            >
              {allExpanded ? (
                <ChevronsDownUp size={13} aria-hidden="true" />
              ) : (
                <ChevronsUpDown size={13} aria-hidden="true" />
              )}
            </button>
          )}
          {count > 0 && (
            <button type="button" onClick={() => onOpenDiff()}>
              <FileDiff size={13} aria-hidden="true" />
              Open diff
            </button>
          )}
        </div>
      </div>
      <div className="agent-turn-changes__tree">
        {tree.nodes.map((node) => renderNode(node, 0))}
      </div>
      {(partial || tree.stats.unknownFiles > 0) && (
        <p className="agent-turn-changes__notice">
          {partial ? "Only part of this turn’s changes is available. " : ""}
          {tree.stats.unknownFiles > 0
            ? "Line totals include known counts only; binary or unavailable counts are excluded."
            : ""}
        </p>
      )}
    </section>
  );
}

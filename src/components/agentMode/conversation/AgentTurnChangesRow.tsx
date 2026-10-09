import { memo, useCallback, useId, useMemo } from "react";
import { ChevronsDownUp, ChevronsUpDown, FileDiff } from "lucide-react";
import type { AgentTurnChangeSummary } from "../../../domain/agentTurnChanges";
import { buildAgentTurnDiffTree } from "../../../domain/agentTurnDiffTree";
import { Button } from "../../../ui/foundation/Button";
import { IconButton } from "../../../ui/foundation/IconButton";
import { useLatest } from "../../../ui/foundation/useLatest";
import { AgentTurnChangesStat, AgentTurnChangesTree } from "./AgentTurnChangesTree";
import {
  useAgentTurnChangesFolders,
  type AgentTurnChangesRowLimits,
} from "./useAgentTurnChangesFolders";
import "./agentTurnChangesRow.css";

export const MAX_CHANGES_VISIBLE_ROWS = 100;
export const MAX_CHANGES_INITIALLY_EXPANDED_ROWS = 12;

const ROW_LIMITS: AgentTurnChangesRowLimits = {
  visibleRows: MAX_CHANGES_VISIBLE_ROWS,
  initiallyExpandedRows: MAX_CHANGES_INITIALLY_EXPANDED_ROWS,
};

export interface AgentTurnChangesRowProps {
  readonly summary: AgentTurnChangeSummary;
  readonly active: boolean;
  onOpenDiff(relativePath?: string): void;
}

export const AgentTurnChangesRow = memo(function AgentTurnChangesRow({
  active,
  onOpenDiff,
  summary,
}: AgentTurnChangesRowProps) {
  const onOpenDiffRef = useLatest(onOpenDiff);
  const openDiff = useCallback(
    (...path: [relativePath?: string]) => onOpenDiffRef.current(...path),
    [onOpenDiffRef],
  );
  if (summary.state === "unsupported") return null;
  if (summary.state === "unavailable") {
    return (
      <p className="cv-changes-note" role="note">
        {summary.reason ?? "Changes for this turn are unavailable."}
      </p>
    );
  }
  return <AgentTurnChangesCard active={active} onOpenDiff={openDiff} summary={summary} />;
});

const AgentTurnChangesCard = memo(function AgentTurnChangesCard({
  active,
  onOpenDiff,
  summary,
}: AgentTurnChangesRowProps) {
  const tree = useMemo(() => buildAgentTurnDiffTree(summary.files), [summary.files]);
  const folders = useAgentTurnChangesFolders(tree.nodes, ROW_LIMITS);
  const treeId = useId();
  const partial = summary.truncated || tree.truncated;
  const count = tree.stats.fileCount;
  if (count === 0 && !partial) return null;
  const atLeast = partial ? "At least " : "";
  const countLabel = `${atLeast}${count} changed ${count === 1 ? "file" : "files"}`;
  const { addedLines, deletedLines } = tree.stats;
  const unlisted = count - folders.representedFiles;
  const { hasFolders } = folders;
  return (
    <div className="cv-changes" data-active={active ? "true" : "false"}>
      <div className="cv-changes__header">
        <span className="cv-changes__count">{countLabel}</span>
        <AgentTurnChangesStat added={addedLines} deleted={deletedLines} />
        <span className="cv-changes__actions">
          {hasFolders && (
            <IconButton
              aria-controls={treeId}
              aria-expanded={folders.anyExpanded}
              className="cv-changes__fold"
              icon={<FoldAllIcon anyExpanded={folders.anyExpanded} />}
              label={folders.anyExpanded ? "Collapse all folders" : "Expand all folders"}
              onClick={folders.toggleAll}
              size="xs"
            />
          )}
          <Button
            aria-label={changesAccessibleLabel(countLabel, addedLines, deletedLines)}
            className="cv-changes__open"
            icon={<FileDiff size={12} strokeWidth={1.5} />}
            onClick={() => onOpenDiff()}
            size="sm"
            variant="ghost"
          >
            Open diff
          </Button>
        </span>
      </div>
      {folders.rows.length > 0 && (
        <AgentTurnChangesTree
          hasFolders={hasFolders}
          id={treeId}
          moreLabel={unlisted > 0 ? `${atLeast}${unlisted} more in the diff` : null}
          onOpenFile={onOpenDiff}
          onToggleFolder={folders.toggle}
          rows={folders.rows}
        />
      )}
    </div>
  );
});

function FoldAllIcon({ anyExpanded }: { readonly anyExpanded: boolean }) {
  if (anyExpanded) return <ChevronsDownUp size={14} strokeWidth={1.75} />;
  return <ChevronsUpDown size={14} strokeWidth={1.75} />;
}

function changesAccessibleLabel(
  countLabel: string,
  addedLines: number | null,
  deletedLines: number | null,
): string {
  const parts = [countLabel];
  if (addedLines !== null) parts.push(`${addedLines} lines added`);
  if (deletedLines !== null) parts.push(`${deletedLines} removed`);
  return `${parts.join(", ")}. Open diff`;
}

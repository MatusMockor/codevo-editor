import { memo, useId, useMemo, useState } from "react";
import { FileDiff } from "lucide-react";
import type {
  AgentTurnChangeSummary,
  AgentTurnChangedFile,
} from "../../../domain/agentTurnChanges";
import { buildAgentTurnDiffTree } from "../../../domain/agentTurnDiffTree";
import "./agentTurnChangesRow.css";

export const MAX_CHANGES_ROW_FILES = 50;

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
  const tree = useMemo(() => buildAgentTurnDiffTree(summary.files), [summary.files]);
  const filesId = useId();
  const [filesOpen, setFilesOpen] = useState(false);
  if (summary.state === "unsupported") return null;
  if (summary.state === "unavailable") {
    return (
      <p className="cv-changes-row cv-changes-row--unavailable" role="note">
        {summary.reason ?? "Changes for this turn are unavailable."}
      </p>
    );
  }
  const partial = summary.truncated || tree.truncated;
  const count = tree.stats.fileCount;
  if (count === 0 && !partial) return null;
  const countLabel = `${partial ? "At least " : ""}${count} changed ${count === 1 ? "file" : "files"}`;
  const { addedLines, deletedLines } = tree.stats;
  const listed = summary.files.slice(0, MAX_CHANGES_ROW_FILES);
  const unlisted = summary.files.length - listed.length;
  return (
    <div className="cv-changes">
      <button
        aria-label={changesAccessibleLabel(countLabel, addedLines, deletedLines)}
        className="cv-changes-row"
        data-active={active ? "true" : "false"}
        onClick={() => onOpenDiff()}
        type="button"
      >
        <span className="cv-changes-row__count">{countLabel}</span>
        {(addedLines !== null || deletedLines !== null) && (
          <span className="cv-changes-row__stat">
            {addedLines !== null && <span className="cv-changes-row__added">+{addedLines}</span>}
            {deletedLines !== null && (
              <span className="cv-changes-row__deleted">−{deletedLines}</span>
            )}
          </span>
        )}
        <span className="cv-changes-row__open">
          <FileDiff aria-hidden="true" size={12} strokeWidth={1.5} />
          Open diff
        </span>
      </button>
      {listed.length > 0 && (
        <button
          aria-controls={filesId}
          aria-expanded={filesOpen}
          className="cv-changes__toggle"
          onClick={() => setFilesOpen((open) => !open)}
          type="button"
        >
          {filesOpen ? "Hide files" : "Show files"}
        </button>
      )}
      {filesOpen && (
        <ul aria-label="Changed files" className="cv-changes__files" id={filesId}>
          {listed.map((changed) => (
            <li key={changed.relativePath}>
              <ChangedFileButton file={changed} onOpen={onOpenDiff} />
            </li>
          ))}
          {unlisted > 0 && <li className="cv-changes__more">{unlisted} more in the diff</li>}
        </ul>
      )}
    </div>
  );
});

function ChangedFileButton({
  file,
  onOpen,
}: {
  readonly file: AgentTurnChangedFile;
  onOpen(relativePath: string): void;
}) {
  return (
    <button
      className="cv-changes__file"
      onClick={() => onOpen(file.relativePath)}
      title={file.relativePath}
      type="button"
    >
      <span className="cv-changes__path">{file.relativePath}</span>
      {file.addedLines !== null && (
        <span className="cv-changes-row__added">+{file.addedLines}</span>
      )}
      {file.deletedLines !== null && (
        <span className="cv-changes-row__deleted">−{file.deletedLines}</span>
      )}
    </button>
  );
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

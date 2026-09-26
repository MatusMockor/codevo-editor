import { Trash2, Undo2 } from "lucide-react";
import { useEffect, useRef } from "react";
import type { AgentGitDiscardFocus } from "../../../../application/rightPanel/useAgentGitDiscard";
import type { AgentGitChangeRow } from "../../../../application/rightPanel/useAgentGitSurface";
import type { GitChangeStatus } from "../../../../domain/git";
import type { CommitIncludeSummary } from "../../../../domain/gitCommitSelection";
import { gitDiscardBlock, gitDiscardEffect } from "../../../../domain/gitWorkingTree";
import { Checkbox } from "../../../../ui/foundation/Checkbox";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { DISCARD_BLOCKED_REASONS } from "./agentGitPresentation";
import { DiffStat } from "../diff/AgentDiffFileSection";

export interface AgentGitChangesListProps {
  readonly rows: ReadonlyArray<AgentGitChangeRow>;
  readonly summary: CommitIncludeSummary;
  readonly loading: boolean;
  readonly error: string | null;
  readonly discardAvailable: boolean;
  readonly focusAfterDiscard: AgentGitDiscardFocus | null;
  onRowIncludedChange(rowKey: string, include: boolean): void;
  onAllIncludedChange(include: boolean): void;
  onDiscard(row: AgentGitChangeRow): void;
}

export function AgentGitChangesList(props: AgentGitChangesListProps) {
  return (
    <div
      className="cv-git-list"
      ref={useDiscardFocus(props.focusAfterDiscard, props.rows)}
      tabIndex={-1}
    >
      <ChangesListBody {...props} />
    </div>
  );
}

function useDiscardFocus(
  request: AgentGitDiscardFocus | null,
  rows: ReadonlyArray<AgentGitChangeRow>,
) {
  const listRef = useRef<HTMLDivElement | null>(null);
  const handled = useRef(0);
  useEffect(() => {
    const list = listRef.current;
    if (request === null || list === null || handled.current === request.sequence) return;
    if (rows.some((row) => row.key === request.removedKey)) return;
    handled.current = request.sequence;
    const checkboxes = list.querySelectorAll<HTMLElement>(".cv-git-row [role='checkbox']");
    const target = checkboxes[Math.min(request.index, checkboxes.length - 1)] ?? list;
    target.focus();
  }, [request, rows]);
  return listRef;
}

function ChangesListBody(props: AgentGitChangesListProps) {
  if (props.error !== null && props.rows.length === 0) {
    return <p className="cv-rp-note cv-rp-note--warning">{props.error}</p>;
  }
  if (props.loading && props.rows.length === 0) {
    return <p className="cv-rp-note">Loading changes…</p>;
  }
  if (props.rows.length === 0) return <p className="cv-rp-note">No changes to commit.</p>;
  const totals = includedTotals(props.rows);
  return (
    <div className="cv-git-changes">
      <div className="cv-git-head">
        <Checkbox
          checked={props.summary.checked}
          label="Include all files"
          onChange={props.onAllIncludedChange}
        />
        <span>
          <b>
            {props.summary.included} of {props.summary.total}
          </b>{" "}
          files
        </span>
        <span className="cv-git-head__end">
          <DiffStat added={totals.added} deleted={totals.deleted} />
        </span>
      </div>
      {props.rows.map((row) => (
        <ChangeRow
          key={row.key}
          onDiscard={props.discardAvailable ? props.onDiscard : null}
          onIncludedChange={props.onRowIncludedChange}
          row={row}
        />
      ))}
    </div>
  );
}

function ChangeRow(props: {
  readonly row: AgentGitChangeRow;
  readonly onDiscard: ((row: AgentGitChangeRow) => void) | null;
  onIncludedChange(rowKey: string, include: boolean): void;
}) {
  const { row } = props;
  const slash = row.relativePath.lastIndexOf("/");
  const directory = row.relativePath.slice(0, slash + 1);
  const name = row.relativePath.slice(slash + 1);
  return (
    <div className={row.included ? "cv-git-row" : "cv-git-row cv-git-row--off"}>
      <Checkbox
        checked={row.included}
        label={
          row.status === "untracked"
            ? `Include ${row.relativePath} (untracked)`
            : `Include ${row.relativePath}`
        }
        onChange={(include) => props.onIncludedChange(row.key, include)}
      />
      <abbr className={`cv-git-status cv-git-status--${row.status}`} title={row.status}>
        {statusLetter(row.status)}
      </abbr>
      <span className="cv-git-row__path" title={row.relativePath}>
        {directory.length > 0 && <span className="cv-git-row__dir">{directory}</span>}
        {name}
      </span>
      <span className="cv-git-row__counts">
        {row.included ? (
          <DiffStat added={row.added} deleted={row.deleted} />
        ) : (
          <span className="cv-git-row__excluded">Excluded</span>
        )}
      </span>
      {props.onDiscard !== null && <DiscardButton onDiscard={props.onDiscard} row={row} />}
    </div>
  );
}

function DiscardButton(props: {
  readonly row: AgentGitChangeRow;
  onDiscard(row: AgentGitChangeRow): void;
}) {
  const { row } = props;
  const block = gitDiscardBlock(row.relativePath, row.status);
  const deletes = gitDiscardEffect(row.status) === "delete";
  return (
    <IconButton
      className="cv-git-row__action"
      disabled={block !== null}
      icon={deletes ? <Trash2 size={13} /> : <Undo2 size={13} />}
      label={deletes ? `Delete ${row.relativePath}` : `Discard changes to ${row.relativePath}`}
      onClick={() => props.onDiscard(row)}
      size="xs"
      title={block === null ? undefined : DISCARD_BLOCKED_REASONS[block]}
    />
  );
}

function includedTotals(rows: ReadonlyArray<AgentGitChangeRow>): {
  readonly added: number | null;
  readonly deleted: number | null;
} {
  const included = rows.filter((row) => row.included);
  if (included.every((row) => row.added === null && row.deleted === null)) {
    return { added: null, deleted: null };
  }
  return {
    added: included.reduce((sum, row) => sum + (row.added ?? 0), 0),
    deleted: included.reduce((sum, row) => sum + (row.deleted ?? 0), 0),
  };
}

function statusLetter(status: GitChangeStatus): string {
  switch (status) {
    case "added":
      return "A";
    case "modified":
      return "M";
    case "deleted":
      return "D";
    case "renamed":
      return "R";
    case "untracked":
      return "U";
    case "conflicted":
      return "C";
    default: {
      const exhaustive: never = status;
      return exhaustive;
    }
  }
}

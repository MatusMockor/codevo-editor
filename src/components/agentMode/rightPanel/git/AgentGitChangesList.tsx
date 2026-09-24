import type { AgentGitChangeRow } from "../../../../application/rightPanel/useAgentGitSurface";
import type { GitChangeStatus } from "../../../../domain/git";
import type { CommitIncludeSummary } from "../../../../domain/gitCommitSelection";
import { Checkbox } from "../../../../ui/foundation/Checkbox";
import { DiffStat } from "../diff/AgentDiffFileSection";

export interface AgentGitChangesListProps {
  readonly rows: ReadonlyArray<AgentGitChangeRow>;
  readonly summary: CommitIncludeSummary;
  readonly loading: boolean;
  readonly error: string | null;
  onRowIncludedChange(relativePath: string, include: boolean): void;
  onAllIncludedChange(include: boolean): void;
}

export function AgentGitChangesList(props: AgentGitChangesListProps) {
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
        <ChangeRow key={row.relativePath} onIncludedChange={props.onRowIncludedChange} row={row} />
      ))}
    </div>
  );
}

function ChangeRow(props: {
  readonly row: AgentGitChangeRow;
  onIncludedChange(relativePath: string, include: boolean): void;
}) {
  const { row } = props;
  const slash = row.relativePath.lastIndexOf("/");
  const directory = row.relativePath.slice(0, slash + 1);
  const name = row.relativePath.slice(slash + 1);
  return (
    <div className={row.included ? "cv-git-row" : "cv-git-row cv-git-row--off"}>
      <Checkbox
        checked={row.included}
        label={`Include ${row.relativePath}`}
        onChange={(include) => props.onIncludedChange(row.relativePath, include)}
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
    </div>
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

import { Fragment } from "react";
import {
  splitDiffRows,
  type DiffHunk,
  type SplitDiffCell,
} from "../../../../domain/diffView/diffHunks";
import type { DiffLineKind } from "../../../../domain/diffView/lineDiff";

export type AgentDiffLayout = "unified" | "split";

export interface AgentDiffHunksProps {
  readonly label: string;
  readonly hunks: ReadonlyArray<DiffHunk>;
  readonly layout: AgentDiffLayout;
}

export function AgentDiffHunks({ hunks, label, layout }: AgentDiffHunksProps) {
  return (
    <div aria-label={label} className="cv-diff-hunk" role="group">
      {hunks.map((hunk, index) =>
        layout === "split" ? (
          <SplitHunk hunk={hunk} key={index} />
        ) : (
          <UnifiedHunk hunk={hunk} key={index} />
        ),
      )}
    </div>
  );
}

function UnifiedHunk({ hunk }: { readonly hunk: DiffHunk }) {
  return (
    <div className="cv-diff-grid cv-diff-grid--unified">
      <span className="cv-diff-cell cv-diff-cell--head">{hunk.header}</span>
      {hunk.lines.map((line, index) => (
        <Fragment key={index}>
          <span className={cellClass("cv-diff-ln", line.kind)}>{line.oldLine ?? ""}</span>
          <span className={cellClass("cv-diff-ln", line.kind)}>{line.newLine ?? ""}</span>
          <span className={cellClass("cv-diff-sign", line.kind)}>{sign(line.kind)}</span>
          <span className={cellClass("cv-diff-code", line.kind)}>
            {line.text.length === 0 ? " " : line.text}
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function SplitHunk({ hunk }: { readonly hunk: DiffHunk }) {
  return (
    <div className="cv-diff-grid cv-diff-grid--split">
      <span className="cv-diff-cell cv-diff-cell--head">{hunk.header}</span>
      {splitDiffRows(hunk).map((row, index) => (
        <Fragment key={index}>
          <SplitSide cell={row.left} start={false} />
          <SplitSide cell={row.right} start />
        </Fragment>
      ))}
    </div>
  );
}

function SplitSide({
  cell,
  start,
}: {
  readonly cell: SplitDiffCell | null;
  readonly start: boolean;
}) {
  const edge = start ? " cv-diff-cell--split-start" : "";
  if (cell === null) {
    return (
      <>
        <span className={`cv-diff-cell cv-diff-ln cv-diff-cell--empty${edge}`} />
        <span className="cv-diff-cell cv-diff-sign cv-diff-cell--empty" />
        <span className="cv-diff-cell cv-diff-code cv-diff-cell--empty" />
      </>
    );
  }
  return (
    <>
      <span className={`${cellClass("cv-diff-ln", cell.kind)}${edge}`}>{cell.line}</span>
      <span className={cellClass("cv-diff-sign", cell.kind)}>{sign(cell.kind)}</span>
      <span className={cellClass("cv-diff-code", cell.kind)}>
        {cell.text.length === 0 ? " " : cell.text}
      </span>
    </>
  );
}

function cellClass(role: string, kind: DiffLineKind): string {
  return `cv-diff-cell ${role} ${role}--${kind} cv-diff-cell--${kind}`;
}

function sign(kind: DiffLineKind): string {
  switch (kind) {
    case "add":
      return "+";
    case "del":
      return "−";
    case "context":
      return "";
  }
}

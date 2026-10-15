import { Fragment } from "react";
import type { HighlightedLine } from "../../../../domain/codeHighlight/highlightedCode";
import {
  splitDiffRows,
  type DiffHunk,
  type SplitDiffCell,
} from "../../../../domain/diffView/diffHunks";
import type { DiffViewLayout } from "../../../../domain/diffView/diffViewPreferences";
import type { DiffLineKind } from "../../../../domain/diffView/lineDiff";
import { AgentDiffCode } from "./AgentDiffCode";
import { MAX_HIGHLIGHTED_HUNKS_PER_FILE } from "../../../../domain/diffView/diffSideText";
import { useDiffFileHighlight, type DiffHunkHighlight } from "./useDiffHunksHighlight";

export type AgentDiffLayout = DiffViewLayout;

export interface AgentDiffHunksProps {
  readonly label: string;
  readonly path: string;
  readonly hunks: ReadonlyArray<DiffHunk>;
  readonly layout: AgentDiffLayout;
}

export function AgentDiffHunks({ hunks, label, layout, path }: AgentDiffHunksProps) {
  const highlight = useDiffFileHighlight(path, hunks);
  return (
    <>
      <div aria-label={label} className="cv-diff-hunk" role="group">
        {hunks.map((hunk, index) =>
          layout === "split" ? (
            <SplitHunk highlight={highlight.hunk(index)} hunk={hunk} key={index} />
          ) : (
            <UnifiedHunk highlight={highlight.hunk(index)} hunk={hunk} key={index} />
          ),
        )}
      </div>
      {highlight.limited && (
        <p className="cv-diff-file__note">
          {`Highlighting is limited to the first ${MAX_HIGHLIGHTED_HUNKS_PER_FILE} hunks of this file.`}
        </p>
      )}
    </>
  );
}

interface HunkProps {
  readonly hunk: DiffHunk;
  readonly highlight: DiffHunkHighlight;
}

function UnifiedHunk({ highlight, hunk }: HunkProps) {
  return (
    <div className="cv-diff-grid cv-diff-grid--unified">
      <span className="cv-diff-cell cv-diff-cell--head">{hunk.header}</span>
      {hunk.lines.map((line, index) => (
        <Fragment key={index}>
          <span className={cellClass("cv-diff-ln", line.kind)}>{line.oldLine ?? ""}</span>
          <span className={cellClass("cv-diff-ln", line.kind)}>{line.newLine ?? ""}</span>
          <span className={cellClass("cv-diff-sign", line.kind)}>{sign(line.kind)}</span>
          <span className={cellClass("cv-diff-code", line.kind)}>
            <AgentDiffCode
              text={line.text}
              tokens={highlight.tokens(index, line.kind === "del" ? "old" : "new")}
            />
          </span>
        </Fragment>
      ))}
    </div>
  );
}

function SplitHunk({ highlight, hunk }: HunkProps) {
  return (
    <div className="cv-diff-grid cv-diff-grid--split">
      <span className="cv-diff-cell cv-diff-cell--head">{hunk.header}</span>
      {splitDiffRows(hunk).map((row, index) => (
        <Fragment key={index}>
          <SplitSide
            cell={row.left}
            start={false}
            tokens={row.left === null ? null : highlight.tokens(row.left.index, "old")}
          />
          <SplitSide
            cell={row.right}
            start
            tokens={row.right === null ? null : highlight.tokens(row.right.index, "new")}
          />
        </Fragment>
      ))}
    </div>
  );
}

function SplitSide({
  cell,
  start,
  tokens,
}: {
  readonly cell: SplitDiffCell | null;
  readonly start: boolean;
  readonly tokens: HighlightedLine | null;
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
        <AgentDiffCode text={cell.text} tokens={tokens} />
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

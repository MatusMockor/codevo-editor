import { ChevronRight, ExternalLink, FileDiff, FilePlus, FileMinus } from "lucide-react";
import type { AgentDiffFile } from "../../../../application/rightPanel/agentDiffSources";
import type { AgentDiffFileView } from "../../../../application/rightPanel/useAgentDiffSurface";
import { IconButton } from "../../../../ui/foundation/IconButton";
import { Spinner } from "../../../../ui/foundation/Spinner";
import { AgentDiffHunks, type AgentDiffLayout } from "./AgentDiffHunks";

export interface AgentDiffFileSectionProps {
  readonly view: AgentDiffFileView;
  readonly layout: AgentDiffLayout;
  onToggle(): void;
  onOpen(file: AgentDiffFile): void;
  sectionRef(node: HTMLDivElement | null): void;
}

export function AgentDiffFileSection({
  layout,
  onOpen,
  onToggle,
  sectionRef,
  view,
}: AgentDiffFileSectionProps) {
  const { body, file } = view;
  const expanded = body.kind !== "collapsed";
  const { directory, name } = splitDisplayPath(file.displayPath);
  return (
    <div className="cv-diff-file" ref={sectionRef}>
      <div className="cv-diff-file__head">
        <button
          aria-expanded={expanded}
          className="cv-diff-file__row"
          onClick={onToggle}
          title={file.displayPath}
          type="button"
        >
          <ChevronRight aria-hidden="true" className="cv-diff-file__chev" size={12} />
          <StatusGlyph status={file.status} />
          <span className="cv-diff-file__path">
            {directory.length > 0 && (
              <span className="cv-diff-file__dir">
                <bdi dir="ltr">{directory}</bdi>
              </span>
            )}
            <span className="cv-diff-file__name">{name}</span>
          </span>
          <DiffStat added={file.added} deleted={file.deleted} />
        </button>
        <IconButton
          disabled={file.repositoryRoot === null}
          icon={<ExternalLink size={14} />}
          label={`Open ${name} in editor`}
          onClick={() => onOpen(file)}
          size="xs"
          title={
            file.repositoryRoot === null
              ? "This file is not in a checkout on this machine."
              : undefined
          }
        />
      </div>
      {body.kind === "loading" && (
        <p className="cv-diff-file__note">
          <Spinner label="Loading diff" />
        </p>
      )}
      {body.kind === "unavailable" && <p className="cv-diff-file__note">{body.reason}</p>}
      {body.kind === "ready" && (
        <>
          <AgentDiffHunks hunks={body.hunks} label={`${file.displayPath} diff`} layout={layout} />
          {body.hiddenChangedLines > 0 && (
            <p className="cv-diff-file__note">
              {hiddenChangedLinesLabel(body.hiddenChangedLines)} not shown here. Open the diff in
              the editor.
            </p>
          )}
        </>
      )}
    </div>
  );
}

export function DiffStat({
  added,
  deleted,
}: {
  readonly added: number | null;
  readonly deleted: number | null;
}) {
  if (added === null && deleted === null) return null;
  return (
    <span className="cv-rp-stat">
      <span className="cv-rp-stat__add">+{added ?? 0}</span>
      <span className="cv-rp-stat__del">
        {"−"}
        {deleted ?? 0}
      </span>
    </span>
  );
}

function StatusGlyph({ status }: { readonly status: AgentDiffFile["status"] }) {
  if (status === "added" || status === "untracked") {
    return (
      <FilePlus
        aria-label="Added"
        className="cv-diff-file__glyph cv-diff-file__glyph--added"
        size={14}
      />
    );
  }
  if (status === "deleted") {
    return (
      <FileMinus
        aria-label="Deleted"
        className="cv-diff-file__glyph cv-diff-file__glyph--deleted"
        size={14}
      />
    );
  }
  return <FileDiff aria-label="Modified" className="cv-diff-file__glyph" size={14} />;
}

function hiddenChangedLinesLabel(count: number): string {
  if (count === 1) return "1 more changed line is";
  return `${count} more changed lines are`;
}

function splitDisplayPath(path: string): { readonly directory: string; readonly name: string } {
  const slash = path.lastIndexOf("/");
  if (slash < 0) return { directory: "", name: path };
  return { directory: path.slice(0, slash + 1), name: path.slice(slash + 1) };
}

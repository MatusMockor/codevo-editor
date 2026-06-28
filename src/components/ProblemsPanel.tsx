import { memo } from "react";
import { AlertCircle, Info, ListFilter, TriangleAlert } from "lucide-react";
import type { WorkbenchNotice } from "../application/workbenchNotice";

const ERROR_ICON = <AlertCircle aria-hidden="true" size={15} />;
const WARNING_ICON = <TriangleAlert aria-hidden="true" size={15} />;
const INFO_ICON = <Info aria-hidden="true" size={15} />;
const OVERFLOW_ICON = <ListFilter aria-hidden="true" size={15} />;

function isOverflowNotice(notice: WorkbenchNotice): boolean {
  return notice.kind === "overflow";
}

interface ProblemsPanelProps {
  isActive: boolean;
  notices: WorkbenchNotice[];
  onOpenNotice(notice: WorkbenchNotice): void;
}

function ProblemsPanelComponent({
  isActive,
  notices,
  onOpenNotice,
}: ProblemsPanelProps) {
  return (
    <div
      aria-label="Problems"
      className="problems-list"
      hidden={!isActive}
      role="tabpanel"
    >
      {notices.length === 0 ? (
        <p>No problems</p>
      ) : (
        notices.map((notice) => (
          <ProblemRow
            key={notice.id}
            notice={notice}
            onOpen={onOpenNotice}
          />
        ))
      )}
    </div>
  );
}

export const ProblemsPanel = memo(ProblemsPanelComponent);

interface ProblemRowProps {
  notice: WorkbenchNotice;
  onOpen(notice: WorkbenchNotice): void;
}

function ProblemRowComponent({ notice, onOpen }: ProblemRowProps) {
  if (isOverflowNotice(notice)) {
    return (
      <div className="problem-row overflow" data-testid="diagnostics-overflow">
        <ProblemRowContent notice={notice} />
      </div>
    );
  }

  if (notice.navigationTarget) {
    return (
      <button
        className={`problem-row ${notice.severity}`}
        onClick={() => onOpen(notice)}
        type="button"
      >
        <ProblemRowContent notice={notice} />
      </button>
    );
  }

  return (
    <div className={`problem-row ${notice.severity}`}>
      <ProblemRowContent notice={notice} />
    </div>
  );
}

const ProblemRow = memo(ProblemRowComponent);

function ProblemRowContent({ notice }: { notice: WorkbenchNotice }) {
  return (
    <>
      {isOverflowNotice(notice) ? OVERFLOW_ICON : getNoticeIcon(notice.severity)}
      <span>
        <strong>{notice.source}</strong>
        <small>{notice.message}</small>
      </span>
    </>
  );
}

function getNoticeIcon(severity: WorkbenchNotice["severity"]) {
  if (severity === "error") {
    return ERROR_ICON;
  }

  if (severity === "warning") {
    return WARNING_ICON;
  }

  return INFO_ICON;
}

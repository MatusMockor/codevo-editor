import { AlertCircle, Info, ListFilter, TriangleAlert } from "lucide-react";
import type { WorkbenchNotice } from "../application/workbenchNotice";

function isOverflowNotice(notice: WorkbenchNotice): boolean {
  return notice.kind === "overflow";
}

interface ProblemsPanelProps {
  isActive: boolean;
  notices: WorkbenchNotice[];
  onOpenNotice(notice: WorkbenchNotice): void;
}

export function ProblemsPanel({
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
        notices.map((notice) => {
          if (isOverflowNotice(notice)) {
            return (
              <div
                className="problem-row overflow"
                data-testid="diagnostics-overflow"
                key={notice.id}
              >
                <ProblemRowContent notice={notice} />
              </div>
            );
          }

          if (notice.navigationTarget) {
            return (
              <button
                className={`problem-row ${notice.severity}`}
                key={notice.id}
                onClick={() => onOpenNotice(notice)}
                type="button"
              >
                <ProblemRowContent notice={notice} />
              </button>
            );
          }

          return (
            <div className={`problem-row ${notice.severity}`} key={notice.id}>
              <ProblemRowContent notice={notice} />
            </div>
          );
        })
      )}
    </div>
  );
}

function ProblemRowContent({ notice }: { notice: WorkbenchNotice }) {
  return (
    <>
      {isOverflowNotice(notice) ? (
        <ListFilter aria-hidden="true" size={15} />
      ) : (
        getNoticeIcon(notice.severity)
      )}
      <span>
        <strong>{notice.source}</strong>
        <small>{notice.message}</small>
      </span>
    </>
  );
}

function getNoticeIcon(severity: WorkbenchNotice["severity"]) {
  if (severity === "error") {
    return <AlertCircle aria-hidden="true" size={15} />;
  }

  if (severity === "warning") {
    return <TriangleAlert aria-hidden="true" size={15} />;
  }

  return <Info aria-hidden="true" size={15} />;
}

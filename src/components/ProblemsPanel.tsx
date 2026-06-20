import { AlertCircle, Info, TriangleAlert } from "lucide-react";
import type { WorkbenchNotice } from "../application/workbenchNotice";

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
        notices.map((notice) =>
          notice.navigationTarget ? (
            <button
              className={`problem-row ${notice.severity}`}
              key={notice.id}
              onClick={() => onOpenNotice(notice)}
              type="button"
            >
              <ProblemRowContent notice={notice} />
            </button>
          ) : (
            <div className={`problem-row ${notice.severity}`} key={notice.id}>
              <ProblemRowContent notice={notice} />
            </div>
          ),
        )
      )}
    </div>
  );
}

function ProblemRowContent({ notice }: { notice: WorkbenchNotice }) {
  return (
    <>
      {getNoticeIcon(notice.severity)}
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

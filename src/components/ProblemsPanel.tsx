import { AlertCircle, Info, TriangleAlert, X } from "lucide-react";
import type { WorkbenchNotice } from "../application/workbenchNotice";

interface ProblemsPanelProps {
  notices: WorkbenchNotice[];
  onClear(): void;
}

export function ProblemsPanel({ notices, onClear }: ProblemsPanelProps) {
  return (
    <section aria-label="Problems" className="problems-panel">
      <header className="problems-header">
        <span>Problems</span>
        {notices.length > 0 ? (
          <button onClick={onClear} title="Clear problems" type="button">
            <X aria-hidden="true" size={14} />
          </button>
        ) : null}
      </header>
      <div className="problems-list">
        {notices.length === 0 ? (
          <p>No problems</p>
        ) : (
          notices.map((notice) => (
            <div className={`problem-row ${notice.severity}`} key={notice.id}>
              {getNoticeIcon(notice.severity)}
              <span>
                <strong>{notice.source}</strong>
                <small>{notice.message}</small>
              </span>
            </div>
          ))
        )}
      </div>
    </section>
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

import { memo, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Info,
  ListFilter,
  TriangleAlert,
  X,
} from "lucide-react";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import {
  buildProblemsView,
  type ProblemsFileView,
  type ProblemsSeverityVisibility,
} from "../domain/problemsView";

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
  workspaceRoot: string | null;
}

function ProblemsPanelComponent(props: ProblemsPanelProps) {
  return <ProblemsPanelWorkspace {...props} key={props.workspaceRoot ?? ""} />;
}

function ProblemsPanelWorkspace({
  isActive,
  notices,
  onOpenNotice,
  workspaceRoot,
}: ProblemsPanelProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [visibility, setVisibility] = useState<ProblemsSeverityVisibility>({
    errors: true,
    warnings: true,
  });
  const view = useMemo(
    () => buildProblemsView(notices, workspaceRoot, visibility, filterText),
    [filterText, notices, visibility, workspaceRoot],
  );

  const toggleCollapsed = (path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);

      if (next.has(path)) {
        next.delete(path);
        return next;
      }

      next.add(path);
      return next;
    });
  };

  const toggleSeverity = (severity: keyof ProblemsSeverityVisibility) => {
    setVisibility((current) => ({
      ...current,
      [severity]: !current[severity],
    }));
  };

  return (
    <div
      aria-label="Problems"
      className="problems-list"
      hidden={!isActive}
      role="tabpanel"
    >
      <div className="problems-toolbar">
        <div
          aria-label="Problem severities"
          className="problems-severity-toggles"
          role="group"
        >
          <button
            aria-label={`Errors (${view.totals.errors})`}
            aria-pressed={visibility.errors}
            className="problems-severity-toggle error"
            onClick={() => toggleSeverity("errors")}
            type="button"
          >
            {ERROR_ICON}
            <span>{view.totals.errors}</span>
          </button>
          <button
            aria-label={`Warnings (${view.totals.warnings})`}
            aria-pressed={visibility.warnings}
            className="problems-severity-toggle warning"
            onClick={() => toggleSeverity("warnings")}
            type="button"
          >
            {WARNING_ICON}
            <span>{view.totals.warnings}</span>
          </button>
        </div>
        <div className="problems-filter">
          <input
            aria-label="Filter problems"
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Filter problems"
            type="text"
            value={filterText}
          />
          {filterText ? (
            <button
              aria-label="Clear filter"
              onClick={() => setFilterText("")}
              type="button"
            >
              <X aria-hidden="true" size={13} />
            </button>
          ) : null}
        </div>
      </div>
      {notices.length === 0 ? <p>No problems</p> : null}
      {notices.length > 0 &&
      view.general.length === 0 &&
      view.files.length === 0 ? (
        <p>No problems match the current filters</p>
      ) : null}
      {view.general.length > 0 ? (
        <section aria-label="General problems" className="problems-general">
          {view.general.map((notice) => (
            <ProblemRow
              key={notice.id}
              notice={notice}
              onOpen={onOpenNotice}
            />
          ))}
        </section>
      ) : null}
      {view.files.map((file) => (
        <ProblemFileGroup
          collapsed={collapsedPaths.has(file.path)}
          file={file}
          key={file.path}
          onOpenNotice={onOpenNotice}
          onToggle={() => toggleCollapsed(file.path)}
        />
      ))}
    </div>
  );
}

export const ProblemsPanel = memo(ProblemsPanelComponent);

interface ProblemFileGroupProps {
  collapsed: boolean;
  file: ProblemsFileView;
  onOpenNotice(notice: WorkbenchNotice): void;
  onToggle(): void;
}

function ProblemFileGroup({
  collapsed,
  file,
  onOpenNotice,
  onToggle,
}: ProblemFileGroupProps) {
  return (
    <section className="problems-file-group">
      <button
        aria-expanded={!collapsed}
        className="problems-file-header"
        onClick={onToggle}
        title={file.path}
        type="button"
      >
        {collapsed ? (
          <ChevronRight aria-hidden="true" size={14} />
        ) : (
          <ChevronDown aria-hidden="true" size={14} />
        )}
        <span>{file.relativePath}</span>
        <small>
          {severityCountLabel(file.errorCount, "error")}
          {" · "}
          {severityCountLabel(file.warningCount, "warning")}
        </small>
      </button>
      {collapsed
        ? null
        : file.entries.map((notice) => (
            <ProblemRow
              key={notice.id}
              notice={notice}
              onOpen={onOpenNotice}
            />
          ))}
    </section>
  );
}

function severityCountLabel(count: number, severity: "error" | "warning") {
  return `${count} ${severity}${count === 1 ? "" : "s"}`;
}

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

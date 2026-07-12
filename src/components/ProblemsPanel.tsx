import { memo, useId, useMemo, useState } from "react";
import type { KeyboardEvent } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Copy,
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
  const [activeNoticeId, setActiveNoticeId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ProblemsSeverityVisibility>({
    errors: true,
    warnings: true,
  });
  const view = useMemo(
    () => buildProblemsView(notices, workspaceRoot, visibility, filterText),
    [filterText, notices, visibility, workspaceRoot],
  );
  const visibleOptions = useMemo(
    () => [
      ...view.general.filter((notice) => !isOverflowNotice(notice)),
      ...view.files.flatMap((file) =>
        collapsedPaths.has(file.path)
          ? []
          : file.entries.filter((notice) => !isOverflowNotice(notice)),
      ),
    ],
    [collapsedPaths, view],
  );
  const selectedNoticeId = visibleOptions.some(
    (notice) => notice.id === activeNoticeId,
  )
    ? activeNoticeId
    : (visibleOptions[0]?.id ?? null);
  const hasVisibleRows = view.general.length > 0 || view.files.length > 0;

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
      {notices.length > 0 && !hasVisibleRows ? (
        <p>No problems match the current filters</p>
      ) : null}
      {hasVisibleRows ? (
        <div aria-label="Problem list" role="listbox">
          {view.general.length > 0 ? (
            <section
              aria-label="General problems"
              className="problems-general"
              role="group"
            >
              {view.general.map((notice) => (
                <ProblemRow
                  isSelected={notice.id === selectedNoticeId}
                  key={notice.id}
                  notice={notice}
                  onOpen={onOpenNotice}
                  onSelect={setActiveNoticeId}
                />
              ))}
            </section>
          ) : null}
          {view.files.map((file) => (
            <ProblemFileGroup
              activeNoticeId={selectedNoticeId}
              collapsed={collapsedPaths.has(file.path)}
              file={file}
              key={file.path}
              onOpenNotice={onOpenNotice}
              onSelectNotice={setActiveNoticeId}
              onToggle={() => toggleCollapsed(file.path)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export const ProblemsPanel = memo(ProblemsPanelComponent);

interface ProblemFileGroupProps {
  activeNoticeId: string | null;
  collapsed: boolean;
  file: ProblemsFileView;
  onOpenNotice(notice: WorkbenchNotice): void;
  onSelectNotice(id: string): void;
  onToggle(): void;
}

function ProblemFileGroup({
  activeNoticeId,
  collapsed,
  file,
  onOpenNotice,
  onSelectNotice,
  onToggle,
}: ProblemFileGroupProps) {
  const headerId = useId();

  return (
    <section
      aria-labelledby={headerId}
      className="problems-file-group"
      role="group"
    >
      <button
        aria-expanded={!collapsed}
        className="problems-file-header"
        id={headerId}
        onClick={onToggle}
        tabIndex={-1}
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
              isSelected={notice.id === activeNoticeId}
              key={notice.id}
              notice={notice}
              onOpen={onOpenNotice}
              onSelect={onSelectNotice}
            />
          ))}
    </section>
  );
}

function severityCountLabel(count: number, severity: "error" | "warning") {
  return `${count} ${severity}${count === 1 ? "" : "s"}`;
}

interface ProblemRowProps {
  isSelected: boolean;
  notice: WorkbenchNotice;
  onOpen(notice: WorkbenchNotice): void;
  onSelect(id: string): void;
}

function ProblemRowComponent({
  isSelected,
  notice,
  onOpen,
  onSelect,
}: ProblemRowProps) {
  const overflow = isOverflowNotice(notice);
  const className = `problem-row ${overflow ? "overflow" : notice.severity}`;

  const copyMessage = () => {
    const write = navigator.clipboard?.writeText(notice.message);
    void write?.catch(() => undefined);
  };

  if (overflow) {
    return (
      <div className="problem-row-container">
        <div className={className} data-testid="diagnostics-overflow">
          <ProblemRowContent notice={notice} />
        </div>
        <button
          aria-label="Copy message"
          className="problem-row-copy"
          onClick={copyMessage}
          tabIndex={-1}
          title="Copy message"
          type="button"
        >
          <Copy aria-hidden="true" size={13} />
        </button>
      </div>
    );
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Enter" || event.key === " ") {
      if (!notice.navigationTarget) {
        return;
      }

      event.preventDefault();
      onOpen(notice);
      return;
    }

    const options = Array.from(
      event.currentTarget
        .closest('[role="listbox"]')
        ?.querySelectorAll<HTMLElement>('[role="option"]') ?? [],
    );
    const currentIndex = options.indexOf(event.currentTarget);
    let nextIndex = currentIndex;

    if (event.key === "ArrowDown") {
      nextIndex = Math.min(currentIndex + 1, options.length - 1);
    }

    if (event.key === "ArrowUp") {
      nextIndex = Math.max(currentIndex - 1, 0);
    }

    if (event.key === "Home") {
      nextIndex = 0;
    }

    if (event.key === "End") {
      nextIndex = options.length - 1;
    }

    if (nextIndex === currentIndex || nextIndex < 0) {
      return;
    }

    event.preventDefault();
    options[nextIndex].focus();
  };

  const rowProps = {
    "aria-selected": isSelected,
    className,
    onFocus: () => onSelect(notice.id),
    onKeyDown: handleKeyDown,
    role: "option",
    tabIndex: isSelected ? 0 : -1,
  };

  return (
    <div className="problem-row-container">
      {notice.navigationTarget ? (
        <button
          {...rowProps}
          onClick={() => onOpen(notice)}
          type="button"
        >
          <ProblemRowContent notice={notice} />
        </button>
      ) : (
        <div {...rowProps}>
          <ProblemRowContent notice={notice} />
        </div>
      )}
      <button
        aria-label="Copy message"
        className="problem-row-copy"
        onClick={copyMessage}
        tabIndex={-1}
        title="Copy message"
        type="button"
      >
        <Copy aria-hidden="true" size={13} />
      </button>
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

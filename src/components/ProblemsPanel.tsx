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
  problemFilePaths,
  type ProblemsFileView,
  type ProblemsPackageView,
  type ProblemsSeverityVisibility,
  type ProblemsViewRow,
} from "../domain/problemsView";
import {
  LOADING_PROBLEMS_PACKAGE,
  NO_PROBLEMS_PACKAGE,
  UNKNOWN_PROBLEMS_PACKAGE,
  createProblemsPackageAttribution,
} from "../domain/problemsPackageAttribution";
import type { WorkspacePackageManifestInput } from "../domain/workspacePackageGraph";
import type { WorkspacePackageAuthority } from "../application/useWorkspacePackageGraph";

const ERROR_ICON = <AlertCircle aria-hidden="true" size={15} />;
const WARNING_ICON = <TriangleAlert aria-hidden="true" size={15} />;
const INFO_ICON = <Info aria-hidden="true" size={15} />;
const OVERFLOW_ICON = <ListFilter aria-hidden="true" size={15} />;
export const MAX_RENDERED_PROBLEM_ROWS = 200;
const EMPTY_PACKAGE_MANIFESTS: readonly WorkspacePackageManifestInput[] = [];
const EMPTY_INCOMPLETE_DIRECTORIES: readonly string[] = [];

function isOverflowNotice(notice: WorkbenchNotice): boolean {
  return notice.kind === "overflow";
}

interface ProblemsPanelProps {
  isActive: boolean;
  notices: WorkbenchNotice[];
  onOpenNotice(notice: WorkbenchNotice): void;
  workspacePackageAuthority?: WorkspacePackageAuthority;
  workspacePackageIncompleteDirectories?: readonly string[];
  workspacePackageManifests?: readonly WorkspacePackageManifestInput[];
  workspacePackageUnscopedAuthorityUncertain?: boolean;
  workspaceRoot: string | null;
}

function ProblemsPanelComponent(props: ProblemsPanelProps) {
  return <ProblemsPanelWorkspace {...props} key={props.workspaceRoot ?? ""} />;
}

function ProblemsPanelWorkspace({
  isActive,
  notices,
  onOpenNotice,
  workspacePackageAuthority = "complete",
  workspacePackageIncompleteDirectories = EMPTY_INCOMPLETE_DIRECTORIES,
  workspacePackageManifests = EMPTY_PACKAGE_MANIFESTS,
  workspacePackageUnscopedAuthorityUncertain = false,
  workspaceRoot,
}: ProblemsPanelProps) {
  const [collapsedPaths, setCollapsedPaths] = useState<Set<string>>(new Set());
  const [collapsedPackages, setCollapsedPackages] = useState<Set<string>>(new Set());
  const [filterText, setFilterText] = useState("");
  const [grouping, setGrouping] = useState<"file" | "package">("file");
  const [packageFilterKey, setPackageFilterKey] = useState("");
  const [renderedLimit, setRenderedLimit] = useState(MAX_RENDERED_PROBLEM_ROWS);
  const [activeNoticeId, setActiveNoticeId] = useState<string | null>(null);
  const [visibility, setVisibility] = useState<ProblemsSeverityVisibility>({
    errors: true,
    warnings: true,
  });
  const attribution = useMemo(
    () =>
      createProblemsPackageAttribution({
        filePaths: problemFilePaths(notices),
        incompleteDirectories: workspacePackageIncompleteDirectories,
        packageManifests: workspacePackageManifests,
        unscopedAuthorityUncertain: workspacePackageUnscopedAuthorityUncertain,
        unscopedFallbackIdentity:
          workspacePackageAuthority === "loading" ? LOADING_PROBLEMS_PACKAGE : undefined,
        workspaceRoot,
      }),
    [
      notices,
      workspacePackageAuthority,
      workspacePackageIncompleteDirectories,
      workspacePackageManifests,
      workspacePackageUnscopedAuthorityUncertain,
      workspaceRoot,
    ],
  );
  const packageOptions = useMemo(() => {
    const synthesizedIdentity =
      workspacePackageAuthority === "loading"
        ? LOADING_PROBLEMS_PACKAGE
        : workspacePackageAuthority === "bounded"
          ? UNKNOWN_PROBLEMS_PACKAGE
          : NO_PROBLEMS_PACKAGE;
    if (attribution.identities.some(({ key }) => key === synthesizedIdentity.key)) {
      return attribution.identities;
    }
    return [...attribution.identities, synthesizedIdentity];
  }, [attribution.identities, workspacePackageAuthority]);
  const effectivePackageFilterKey = packageOptions.some(({ key }) => key === packageFilterKey)
    ? packageFilterKey
    : "";
  const view = useMemo(
    () =>
      buildProblemsView(notices, workspaceRoot, visibility, filterText, {
        attribution,
        packageFilterKey: effectivePackageFilterKey || null,
      }),
    [attribution, effectivePackageFilterKey, filterText, notices, visibility, workspaceRoot],
  );
  const orderedRows = useMemo(
    () =>
      grouping === "package"
        ? view.packages.flatMap((packageView) => packageView.files.flatMap((file) => file.entries))
        : view.files.flatMap((file) => file.entries),
    [grouping, view.files, view.packages],
  );
  const renderedRows = useMemo(
    () => orderedRows.slice(0, renderedLimit - Math.min(view.general.length, renderedLimit)),
    [orderedRows, renderedLimit, view.general.length],
  );
  const renderedRowSet = useMemo(() => new Set(renderedRows), [renderedRows]);
  const renderedGeneral = useMemo(
    () => view.general.slice(0, renderedLimit),
    [renderedLimit, view.general],
  );
  const visibleOptions = useMemo(
    () => [
      ...renderedGeneral.filter((notice) => !isOverflowNotice(notice)),
      ...(grouping === "package"
        ? view.packages.flatMap((packageView) =>
            collapsedPackages.has(packageView.identity.key)
              ? []
              : packageView.files.flatMap((file) =>
                  collapsedPaths.has(file.path)
                    ? []
                    : file.entries.filter(
                        (notice) => renderedRowSet.has(notice) && !isOverflowNotice(notice),
                      ),
                ),
          )
        : view.files.flatMap((file) =>
            collapsedPaths.has(file.path)
              ? []
              : file.entries.filter(
                  (notice) => renderedRowSet.has(notice) && !isOverflowNotice(notice),
                ),
          )),
    ],
    [
      collapsedPackages,
      collapsedPaths,
      grouping,
      renderedGeneral,
      renderedRowSet,
      view.files,
      view.packages,
    ],
  );
  const selectedNoticeId = visibleOptions.some((notice) => notice.id === activeNoticeId)
    ? activeNoticeId
    : (visibleOptions[0]?.id ?? null);
  const hasVisibleRows = view.general.length > 0 || view.files.length > 0;
  const renderedCount = renderedGeneral.length + renderedRows.length;
  const totalRowCount =
    view.general.length + view.files.reduce((total, file) => total + file.entries.length, 0);
  const fullyDroppedPackages = useMemo(
    () =>
      view.packages
        .filter((packageView) =>
          packageView.files.every((file) =>
            file.entries.every((entry) => !renderedRowSet.has(entry)),
          ),
        )
        .map(({ identity }) => identity.label),
    [renderedRowSet, view.packages],
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

  const togglePackageCollapsed = (key: string) => {
    setCollapsedPackages((current) => {
      const next = new Set(current);

      if (next.has(key)) {
        next.delete(key);
        return next;
      }

      next.add(key);
      return next;
    });
  };

  return (
    <div aria-label="Problems" className="problems-list" hidden={!isActive} role="tabpanel">
      <div className="problems-toolbar">
        <div aria-label="Problem severities" className="problems-severity-toggles" role="group">
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
        <div aria-label="Problem grouping" role="group">
          <button
            aria-label="Group by file"
            aria-pressed={grouping === "file"}
            onClick={() => setGrouping("file")}
            type="button"
          >
            File
          </button>
          <button
            aria-label="Group by package"
            aria-pressed={grouping === "package"}
            data-degraded={workspacePackageAuthority === "bounded" ? "true" : undefined}
            onClick={() => setGrouping("package")}
            title={
              workspacePackageAuthority === "bounded"
                ? "Package grouping degraded because the workspace scan was bounded"
                : undefined
            }
            type="button"
          >
            {workspacePackageAuthority === "bounded" ? "Package (degraded)" : "Package"}
          </button>
        </div>
        <label>
          <span>Package</span>
          <select
            aria-label="Filter by package"
            data-degraded={workspacePackageAuthority === "bounded" ? "true" : undefined}
            onChange={(event) => setPackageFilterKey(event.target.value)}
            title={
              workspacePackageAuthority === "bounded"
                ? "Package filter degraded because the workspace scan was bounded"
                : undefined
            }
            value={effectivePackageFilterKey}
          >
            <option value="">All packages</option>
            {packageOptions.map((identity) => (
              <option key={identity.key} value={identity.key}>
                {identity.label}
              </option>
            ))}
          </select>
        </label>
        <div className="problems-filter">
          <input
            aria-label="Filter problems"
            onChange={(event) => setFilterText(event.target.value)}
            placeholder="Filter problems"
            type="text"
            value={filterText}
          />
          {filterText ? (
            <button aria-label="Clear filter" onClick={() => setFilterText("")} type="button">
              <X aria-hidden="true" size={13} />
            </button>
          ) : null}
        </div>
      </div>
      {notices.length === 0 ? <p>No problems</p> : null}
      {notices.length > 0 && !hasVisibleRows ? <p>No problems match the current filters</p> : null}
      {hasVisibleRows ? (
        <div aria-label="Problem list" className="problems-list-rows">
          {renderedGeneral.length > 0 ? (
            <section aria-label="General problems" className="problems-general">
              {renderedGeneral.map((notice) => (
                <ProblemRow
                  isSelected={notice.id === selectedNoticeId}
                  key={notice.id}
                  notice={notice}
                  onOpen={onOpenNotice}
                  onSelect={setActiveNoticeId}
                  packageKey={notice.packageIdentity.key}
                />
              ))}
            </section>
          ) : null}
          {grouping === "file"
            ? view.files.map((file) => {
                const entries = file.entries.filter((entry) => renderedRowSet.has(entry));
                if (entries.length === 0) {
                  return null;
                }

                return (
                  <ProblemFileGroup
                    activeNoticeId={selectedNoticeId}
                    collapsed={collapsedPaths.has(file.path)}
                    entries={entries}
                    file={file}
                    key={file.path}
                    onOpenNotice={onOpenNotice}
                    onSelectNotice={setActiveNoticeId}
                    onToggle={() => toggleCollapsed(file.path)}
                  />
                );
              })
            : view.packages.map((packageView) => (
                <ProblemPackageGroup
                  activeNoticeId={selectedNoticeId}
                  collapsed={collapsedPackages.has(packageView.identity.key)}
                  collapsedPaths={collapsedPaths}
                  key={packageView.identity.key}
                  onOpenNotice={onOpenNotice}
                  onSelectNotice={setActiveNoticeId}
                  onToggle={() => togglePackageCollapsed(packageView.identity.key)}
                  onToggleFile={toggleCollapsed}
                  packageView={packageView}
                  renderedRowSet={renderedRowSet}
                />
              ))}
        </div>
      ) : null}
      {renderedCount < totalRowCount ? (
        <div>
          <p>
            Showing {renderedCount} of {totalRowCount} problem rows.
            {fullyDroppedPackages.length > 0
              ? ` Fully hidden packages: ${fullyDroppedPackages.join(", ")}.`
              : ""}
          </p>
          <button
            onClick={() =>
              setRenderedLimit((current) =>
                Math.min(totalRowCount, current + MAX_RENDERED_PROBLEM_ROWS),
              )
            }
            type="button"
          >
            Show more
          </button>
        </div>
      ) : null}
    </div>
  );
}

export const ProblemsPanel = memo(ProblemsPanelComponent);

interface ProblemFileGroupProps {
  activeNoticeId: string | null;
  collapsed: boolean;
  entries: readonly ProblemsViewRow[];
  file: ProblemsFileView;
  onOpenNotice(notice: WorkbenchNotice): void;
  onSelectNotice(id: string): void;
  onToggle(): void;
}

function ProblemFileGroup({
  activeNoticeId,
  collapsed,
  entries,
  file,
  onOpenNotice,
  onSelectNotice,
  onToggle,
}: ProblemFileGroupProps) {
  const headerId = useId();

  return (
    <section aria-labelledby={headerId} className="problems-file-group">
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
        : entries.map((notice) => (
            <ProblemRow
              isSelected={notice.id === activeNoticeId}
              key={notice.id}
              notice={notice}
              onOpen={onOpenNotice}
              onSelect={onSelectNotice}
              packageKey={notice.packageIdentity.key}
            />
          ))}
    </section>
  );
}

interface ProblemPackageGroupProps {
  activeNoticeId: string | null;
  collapsed: boolean;
  collapsedPaths: ReadonlySet<string>;
  onOpenNotice(notice: WorkbenchNotice): void;
  onSelectNotice(id: string): void;
  onToggle(): void;
  onToggleFile(path: string): void;
  packageView: ProblemsPackageView;
  renderedRowSet: ReadonlySet<ProblemsViewRow>;
}

function ProblemPackageGroup({
  activeNoticeId,
  collapsed,
  collapsedPaths,
  onOpenNotice,
  onSelectNotice,
  onToggle,
  onToggleFile,
  packageView,
  renderedRowSet,
}: ProblemPackageGroupProps) {
  const headerId = useId();
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    focusProblemItem(event);
  };
  const countLabel =
    packageView.count.kind === "bounded"
      ? `${packageView.count.value} problems shown, bounded result`
      : packageView.count.kind === "matching"
        ? `${packageView.count.value} matching problems`
        : `${packageView.count.value} problems`;
  const renderedCount = packageView.files.reduce(
    (total, file) => total + file.entries.filter((entry) => renderedRowSet.has(entry)).length,
    0,
  );
  const hiddenCount = packageView.count.value - renderedCount;

  return (
    <section aria-labelledby={headerId} className="problems-package-group">
      <button
        aria-expanded={!collapsed}
        aria-label={`${packageView.identity.label}, ${countLabel}`}
        className="problems-package-header problems-file-header"
        id={headerId}
        onClick={onToggle}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {collapsed ? (
          <ChevronRight aria-hidden="true" size={14} />
        ) : (
          <ChevronDown aria-hidden="true" size={14} />
        )}
        <span>{packageView.identity.label}</span>
        <small>{countLabel}</small>
      </button>
      {collapsed
        ? null
        : packageView.files.map((file) => {
            const entries = file.entries.filter((entry) => renderedRowSet.has(entry));
            if (entries.length === 0) {
              return null;
            }

            return (
              <ProblemFileGroup
                activeNoticeId={activeNoticeId}
                collapsed={collapsedPaths.has(file.path)}
                entries={entries}
                file={file}
                key={file.path}
                onOpenNotice={onOpenNotice}
                onSelectNotice={onSelectNotice}
                onToggle={() => onToggleFile(file.path)}
              />
            );
          })}
      {hiddenCount > 0 ? <small>{hiddenCount} more rows outside the current window</small> : null}
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
  packageKey?: string;
}

function ProblemRowComponent({
  isSelected,
  notice,
  onOpen,
  onSelect,
  packageKey,
}: ProblemRowProps) {
  const overflow = isOverflowNotice(notice);
  const className = `problem-row ${overflow ? "overflow" : notice.severity}`;

  const copyMessage = () => {
    const write = navigator.clipboard?.writeText(notice.message);
    void write?.catch(() => undefined);
  };

  if (overflow) {
    return (
      <div className="problem-row-container" data-package-key={packageKey}>
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

    focusProblemItem(event);
  };

  const rowProps = {
    "aria-current": isSelected ? ("true" as const) : undefined,
    className,
    onFocus: () => onSelect(notice.id),
    onKeyDown: handleKeyDown,
    tabIndex: isSelected ? 0 : -1,
  };

  return (
    <div className="problem-row-container" data-package-key={packageKey}>
      {notice.navigationTarget ? (
        <button {...rowProps} onClick={() => onOpen(notice)} type="button">
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

function focusProblemItem(event: KeyboardEvent<HTMLElement>) {
  const items = Array.from(
    event.currentTarget
      .closest(".problems-list-rows")
      ?.querySelectorAll<HTMLElement>(".problems-package-header, .problem-row[tabindex]") ?? [],
  );
  const currentIndex = items.indexOf(event.currentTarget);
  if (currentIndex < 0) return;
  let nextIndex = currentIndex;
  if (event.key === "ArrowDown") nextIndex = Math.min(currentIndex + 1, items.length - 1);
  if (event.key === "ArrowUp") nextIndex = Math.max(currentIndex - 1, 0);
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = items.length - 1;
  if (nextIndex === currentIndex) return;
  event.preventDefault();
  items[nextIndex]?.focus();
}

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

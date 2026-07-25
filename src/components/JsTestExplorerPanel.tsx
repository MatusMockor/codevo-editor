import {
  BarChart3,
  Bug,
  FileText,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { JsTestCoverageReport, JsTestFileCoverage } from "../domain/jsTestCoverage";
import {
  parseJsTestExplorerFilter,
  type JsTestExplorerCurrentFileIdentity,
  type JsTestExplorerOpenedFilesSnapshot,
} from "../domain/jsTestExplorerFilter";
import { jsTestRunScopeForExplorerNode, type JsTestRunScope } from "../domain/jsTestRunScope";
import {
  filterJsTestExplorerTree,
  type JsTestExplorerNode,
  type JsTestExplorerStatus,
  type JsTestExplorerTestNode,
  type JsTestExplorerWorkspaceNode,
} from "../domain/jsTestExplorerTree";
import type { JsTestTaskOutput } from "../domain/jsTestTask";
import { JsTestOutputView } from "./JsTestOutputView";

export interface JsTestExplorerPanelProps {
  readonly canCancelTestRun: boolean;
  readonly canCopyOutput?: boolean;
  readonly canRerunFailedTests: boolean;
  readonly canStartContinuousRun: boolean;
  readonly continuousRunEnabled: boolean;
  readonly continuousRunPending: boolean;
  readonly continuousRunRunning: boolean;
  readonly continuousRunStopping: boolean;
  readonly coverageError: string | null;
  readonly coverageReport: JsTestCoverageReport | null;
  readonly coverageRunning: boolean;
  readonly coverageUnavailable: string | null;
  readonly currentFileIdentity?: JsTestExplorerCurrentFileIdentity | null;
  readonly debugError: string | null;
  readonly debugging: boolean;
  readonly debugStartBlocked: boolean;
  readonly debugUnavailable: string | null;
  readonly error: string | null;
  readonly executionStartBlocked: boolean;
  readonly failedRunCompleted: number;
  readonly failedRunPhase: "idle" | "running" | "cancelling" | "invalidating";
  readonly failedRunTotal: number;
  readonly loading: boolean;
  readonly openedFilesSnapshot?: JsTestExplorerOpenedFilesSnapshot | null;
  readonly onCancelTestRun: () => void;
  readonly onClearCoverage: () => void;
  readonly onCopyOutput?: () => boolean | Promise<boolean>;
  readonly onDebugNode: (
    node: Exclude<JsTestExplorerNode, JsTestExplorerWorkspaceNode>,
  ) => Promise<void>;
  readonly onOpenCoverageFile: (file: JsTestFileCoverage) => void;
  readonly onOpenTest: (test: JsTestExplorerTestNode) => void;
  readonly onQueryChange: (query: string) => void;
  readonly onRefresh: () => void;
  readonly onRerunFailedTests: () => void;
  readonly onRunScope: (scope: JsTestRunScope) => void;
  readonly onRunCoverage: () => void;
  readonly onStartContinuousRun: () => void;
  readonly onStopContinuousRun: () => void;
  readonly output?: JsTestTaskOutput | null;
  readonly query: string;
  readonly running: boolean;
  readonly tree: JsTestExplorerWorkspaceNode | null;
  readonly truncated: boolean;
  readonly unavailable: string | null;
  readonly workspaceId?: string | null;
}

interface TreeNodeProps {
  readonly debugDisabled: boolean;
  readonly disabled: boolean;
  readonly level: number;
  readonly node: JsTestExplorerNode;
  readonly onOpenTest: (test: JsTestExplorerTestNode) => void;
  readonly onDebugNode: JsTestExplorerPanelProps["onDebugNode"];
  readonly onRunScope: (scope: JsTestRunScope) => void;
  readonly rootPath: string;
}

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    cursor: "pointer",
    display: "inline-flex",
    gap: 4,
    padding: "3px 5px",
  },
  children: { listStyle: "none", margin: 0, padding: 0 },
  coverage: { borderBottom: "1px solid var(--border-subtle)", padding: "7px 8px" },
  coverageFile: {
    alignItems: "center",
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    padding: "3px 0",
  },
  coverageFiles: { listStyle: "none", margin: "5px 0 0", padding: 0 },
  coverageSummary: { display: "flex", flexWrap: "wrap", gap: 10 },
  input: { background: "transparent", border: 0, color: "inherit", flex: 1, minWidth: 100 },
  label: {
    background: "transparent",
    border: 0,
    color: "inherit",
    font: "inherit",
    minWidth: 0,
    overflow: "hidden",
    padding: 0,
    textAlign: "left",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  message: { color: "var(--text-muted)", padding: 16 },
  node: { listStyle: "none" },
  panel: { height: "100%", overflow: "auto" },
  row: {
    alignItems: "center",
    display: "flex",
    gap: 6,
    minHeight: 26,
    paddingRight: 8,
  },
  run: { marginLeft: "auto" },
  status: { display: "inline-block", flex: "0 0 14px", textAlign: "center" },
  toolbar: {
    alignItems: "center",
    borderBottom: "1px solid var(--border-subtle)",
    display: "flex",
    gap: 6,
    padding: "6px 8px",
  },
  tree: { fontSize: 12, listStyle: "none", margin: 0, padding: "4px 0" },
  visuallyHidden: {
    clip: "rect(0 0 0 0)",
    clipPath: "inset(50%)",
    height: 1,
    overflow: "hidden",
    position: "absolute",
    whiteSpace: "nowrap",
    width: 1,
  },
};

export function JsTestExplorerPanel({
  canCancelTestRun,
  canCopyOutput = false,
  canRerunFailedTests,
  canStartContinuousRun,
  continuousRunEnabled,
  continuousRunPending,
  continuousRunRunning,
  continuousRunStopping,
  coverageError,
  coverageReport,
  coverageRunning,
  coverageUnavailable,
  currentFileIdentity = null,
  debugError,
  debugging,
  debugStartBlocked,
  debugUnavailable,
  error,
  executionStartBlocked,
  failedRunCompleted,
  failedRunPhase,
  failedRunTotal,
  loading,
  openedFilesSnapshot = null,
  onCancelTestRun,
  onClearCoverage,
  onCopyOutput = () => false,
  onDebugNode,
  onOpenCoverageFile,
  onOpenTest,
  onQueryChange,
  onRefresh,
  onRerunFailedTests,
  onRunScope,
  onRunCoverage,
  onStartContinuousRun,
  onStopContinuousRun,
  output = null,
  query,
  running,
  tree,
  truncated,
  unavailable,
  workspaceId = null,
}: JsTestExplorerPanelProps) {
  const filterHelpId = useId();
  const filterErrorId = useId();
  const outputViewId = useId();
  const filterInputRef = useRef<HTMLInputElement>(null);
  const showOutputButtonRef = useRef<HTMLButtonElement>(null);
  const previousFailedRunPhaseRef = useRef(failedRunPhase);
  const [outputOpen, setOutputOpen] = useState(false);
  const filterOptions = useMemo(
    () => ({
      currentFile: currentFileIdentity,
      openedFilesSnapshot,
      workspaceId,
    }),
    [currentFileIdentity, openedFilesSnapshot, workspaceId],
  );
  const filter = useMemo(
    () => parseJsTestExplorerFilter(query, filterOptions),
    [filterOptions, query],
  );
  const filteredTree = useMemo(
    () => (tree ? filterJsTestExplorerTree(tree, query, filterOptions) : null),
    [filterOptions, query, tree],
  );
  const filterInputError =
    filter.kind === "invalid" && filter.reason === "query-too-large"
      ? "JavaScript test filter is limited to 4 KiB."
      : filter.kind === "invalid" && filter.reason === "invalid-unicode"
        ? "JavaScript test filter contains invalid text."
        : null;
  const filterContextStatus =
    filter.kind === "invalid" && filter.reason === "current-file-unavailable"
      ? "No active workspace file is available for @doc."
      : filter.kind === "invalid" && filter.reason === "invalid-current-file"
        ? "The active workspace file cannot be used by @doc."
        : filter.kind === "invalid" && filter.reason === "opened-files-unavailable"
          ? "No authoritative open-editor snapshot is available for @openedFiles."
          : filter.kind === "invalid" && filter.reason === "opened-files-too-many"
            ? "Too many open editor resources are available for @openedFiles."
            : filter.kind === "invalid" && filter.reason === "invalid-opened-files"
              ? "The open editor resources cannot be used by @openedFiles."
              : null;
  const filterIssue = filterInputError ?? filterContextStatus;
  const failedFilterActive = filter.kind === "valid" && filter.statusFilters.includes("failed");
  const focusStableFilter = (): void => {
    if (failedFilterActive) filterInputRef.current?.focus();
  };
  const runScope = (scope: JsTestRunScope): void => {
    focusStableFilter();
    onRunScope(scope);
  };
  useLayoutEffect(() => {
    const previous = previousFailedRunPhaseRef.current;
    previousFailedRunPhaseRef.current = failedRunPhase;
    if (failedFilterActive && previous === "idle" && failedRunPhase !== "idle") {
      filterInputRef.current?.focus();
    }
  }, [failedFilterActive, failedRunPhase]);
  useEffect(() => {
    if (!output) setOutputOpen(false);
  }, [output]);
  const closeOutput = (): void => {
    setOutputOpen(false);
    showOutputButtonRef.current?.focus();
  };
  const failedRunBusy = failedRunPhase !== "idle";
  const showCancel = failedRunBusy || (running && canCancelTestRun);
  const busy = loading || running || coverageRunning || debugging || failedRunBusy;
  const canRun = Boolean(tree?.children.length) && !busy && !executionStartBlocked;
  const canRerunFailed = canRerunFailedTests && !busy && !executionStartBlocked;
  const continuousRunActive = continuousRunEnabled || continuousRunStopping;
  const continuousRunDisabled = continuousRunActive
    ? continuousRunStopping
    : !canStartContinuousRun || busy || executionStartBlocked;
  const continuousRunStatus = continuousRunStopping
    ? "Stopping Continuous Run…"
    : continuousRunRunning
      ? "Continuous Run is running all JavaScript tests…"
      : continuousRunPending
        ? "Continuous Run is queued…"
        : continuousRunEnabled
          ? "Continuous Run is watching for changes."
          : "";
  const showTree = Boolean(filteredTree?.children.length && !loading);

  return (
    <section
      aria-busy={busy || continuousRunPending || continuousRunRunning || continuousRunStopping}
      aria-label="JavaScript Test Explorer"
      role="tabpanel"
      style={styles.panel}
    >
      <div aria-label="JavaScript test actions" role="toolbar" style={styles.toolbar}>
        <button
          aria-label={continuousRunActive ? "Stop Continuous Run All" : "Start Continuous Run All"}
          aria-pressed={continuousRunActive}
          disabled={continuousRunDisabled}
          onClick={continuousRunActive ? onStopContinuousRun : onStartContinuousRun}
          style={styles.action}
          type="button"
        >
          {continuousRunActive ? (
            <Square aria-hidden="true" size={14} />
          ) : (
            <Play aria-hidden="true" size={14} />
          )}
          {continuousRunStopping
            ? "Stopping…"
            : continuousRunActive
              ? "Stop Continuous Run"
              : "Start Continuous Run"}
        </button>
        {showCancel ? (
          <button
            aria-label="Cancel JavaScript test run"
            disabled={!canCancelTestRun || (failedRunBusy && failedRunPhase !== "running")}
            onClick={onCancelTestRun}
            style={styles.action}
            type="button"
          >
            <Square aria-hidden="true" size={14} />
            Cancel
          </button>
        ) : (
          <>
            <button
              aria-label="Run all JavaScript tests"
              disabled={!canRun}
              onClick={() => runScope({ kind: "all" })}
              style={styles.action}
              type="button"
            >
              <Play aria-hidden="true" size={14} />
              Run All
            </button>
            <button
              aria-label="Rerun failed JavaScript tests"
              disabled={!canRerunFailed}
              onClick={() => {
                focusStableFilter();
                onRerunFailedTests();
              }}
              style={styles.action}
              type="button"
            >
              <RotateCcw aria-hidden="true" size={14} />
              Rerun Failed
            </button>
          </>
        )}
        <button
          aria-label="Run JavaScript test coverage"
          disabled={busy || executionStartBlocked}
          onClick={onRunCoverage}
          style={styles.action}
          type="button"
        >
          <BarChart3 aria-hidden="true" size={14} />
          Run Coverage
        </button>
        {coverageReport ? (
          <button
            aria-label="Clear JavaScript test coverage"
            disabled={busy}
            onClick={onClearCoverage}
            style={styles.action}
            type="button"
          >
            <X aria-hidden="true" size={14} />
            Clear Coverage
          </button>
        ) : null}
        <button
          aria-label="Refresh JavaScript tests"
          disabled={busy}
          onClick={onRefresh}
          style={styles.action}
          type="button"
        >
          <RefreshCw aria-hidden="true" size={14} />
          Refresh
        </button>
        <button
          aria-controls={outputViewId}
          aria-expanded={outputOpen && output !== null}
          aria-label="Show JavaScript test output"
          disabled={!output}
          onClick={() => setOutputOpen(true)}
          ref={showOutputButtonRef}
          style={styles.action}
          type="button"
        >
          <FileText aria-hidden="true" size={14} />
          Show Output
        </button>
        <Search aria-hidden="true" size={14} />
        <span id={filterHelpId} style={styles.visuallyHidden}>
          Add @failed to show only failed tests, @executed to show tests that have run, @doc to show
          tests in the active file, or @openedFiles to show tests in open editor resources.
        </span>
        <input
          aria-describedby={filterIssue ? `${filterHelpId} ${filterErrorId}` : filterHelpId}
          aria-errormessage={filterInputError ? filterErrorId : undefined}
          aria-invalid={Boolean(filterInputError)}
          aria-label="Filter JavaScript tests"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          placeholder="Filter tests, @failed, @executed, @doc, or @openedFiles"
          ref={filterInputRef}
          style={styles.input}
          value={query}
        />
      </div>

      {outputOpen && output ? (
        <JsTestOutputView
          canCopyOutput={canCopyOutput}
          id={outputViewId}
          onClose={closeOutput}
          onCopyOutput={onCopyOutput}
          output={output}
        />
      ) : (
        <>
          {loading ? (
            <div role="status" style={styles.message}>
              Loading JavaScript tests…
            </div>
          ) : null}
          {!loading && failedRunPhase === "running" ? (
            <div role="status" style={styles.message}>
              {failedRunStatus(failedRunCompleted, failedRunTotal)}
            </div>
          ) : null}
          {!loading && failedRunPhase === "cancelling" ? (
            <div role="status" style={styles.message}>
              Cancelling JavaScript test run…
            </div>
          ) : null}
          {!loading && failedRunPhase === "invalidating" ? (
            <div role="status" style={styles.message}>
              Invalidating JavaScript test run…
            </div>
          ) : null}
          {!loading && failedRunPhase === "idle" && running ? (
            <div role="status" style={styles.message}>
              Running JavaScript tests…
            </div>
          ) : null}
          {!loading && !running && !failedRunBusy && coverageRunning ? (
            <div role="status" style={styles.message}>
              Running JavaScript test coverage…
            </div>
          ) : null}
          {!loading && !running && !failedRunBusy && !coverageRunning && debugging ? (
            <div role="status" style={styles.message}>
              Starting selected JavaScript test debug…
            </div>
          ) : null}
          {!debugging && debugUnavailable ? (
            <div role="status" style={styles.message}>
              {debugUnavailable}
            </div>
          ) : null}
          {!debugging && !debugUnavailable && debugError ? (
            <div role="alert" style={styles.message}>
              {debugError}
            </div>
          ) : null}
          {!coverageRunning && coverageUnavailable ? (
            <div role="status" style={styles.message}>
              {coverageUnavailable}
            </div>
          ) : null}
          {!coverageRunning && !coverageUnavailable && coverageError ? (
            <div role="alert" style={styles.message}>
              {coverageError}
            </div>
          ) : null}
          {coverageReport ? (
            <CoverageReport report={coverageReport} onOpenFile={onOpenCoverageFile} />
          ) : null}
          {!loading && unavailable ? (
            <div role="status" style={styles.message}>
              {unavailable}
            </div>
          ) : null}
          {!loading && !unavailable && error ? (
            <div role="alert" style={styles.message}>
              {error}
            </div>
          ) : null}
          {!loading && !unavailable && !error && truncated ? (
            <div role="status" style={styles.message}>
              Results are truncated. Refine the filter or refresh discovery.
            </div>
          ) : null}
          {filterIssue ? (
            <div
              id={filterErrorId}
              role={filterInputError ? "alert" : "status"}
              style={styles.message}
            >
              {filterIssue}
            </div>
          ) : null}
          {!loading && !unavailable && !error && tree && tree.children.length === 0 ? (
            <div role="status" style={styles.message}>
              No JavaScript tests found.
            </div>
          ) : null}
          {!loading &&
          !unavailable &&
          !error &&
          !filterIssue &&
          tree?.children.length &&
          !filteredTree?.children.length ? (
            <div role="status" style={styles.message}>
              No JavaScript tests match the current filter.
            </div>
          ) : null}
          {!loading && !unavailable && !error && !tree ? (
            <div role="status" style={styles.message}>
              No JavaScript test discovery is available.
            </div>
          ) : null}

          {showTree && filteredTree ? (
            <ul aria-label="JavaScript tests" style={styles.tree}>
              <TreeNode
                debugDisabled={busy || debugStartBlocked}
                disabled={!canRun}
                level={1}
                node={filteredTree}
                onOpenTest={onOpenTest}
                onDebugNode={onDebugNode}
                onRunScope={runScope}
                rootPath={tree?.rootPath ?? filteredTree.rootPath}
              />
            </ul>
          ) : null}
        </>
      )}
      <div
        aria-atomic="true"
        aria-label="Continuous Run status"
        aria-live="polite"
        role="status"
        style={styles.visuallyHidden}
      >
        {continuousRunStatus}
      </div>
    </section>
  );
}

function CoverageReport({
  onOpenFile,
  report,
}: {
  readonly onOpenFile: (file: JsTestFileCoverage) => void;
  readonly report: JsTestCoverageReport;
}): ReactNode {
  return (
    <section aria-label="JavaScript test coverage summary" style={styles.coverage}>
      <div style={styles.coverageSummary}>
        <strong>Coverage</strong>
        <span aria-label="Covered lines">
          {report.summary.covered}/{report.summary.total} lines
        </span>
        <span aria-label="Line coverage percentage">
          {coveragePercentage(report.summary.percentage)}
        </span>
        <span aria-label="Covered branches">
          {report.branches.covered}/{report.branches.total} branches
        </span>
        <span aria-label="Branch coverage percentage">
          {coveragePercentage(report.branches.percentage)}
        </span>
        <span aria-label="Covered functions">
          {report.functions.covered}/{report.functions.total} functions
        </span>
        <span aria-label="Function coverage percentage">
          {coveragePercentage(report.functions.percentage)}
        </span>
      </div>
      {report.truncated ? (
        <span aria-label="Coverage truncation status" role="status">
          Coverage details are truncated.
        </span>
      ) : null}
      {report.files.length > 0 ? (
        <ul aria-label="JavaScript coverage files" style={styles.coverageFiles}>
          {report.files.map((file) => (
            <li key={file.path} style={styles.coverageFile}>
              <button
                aria-label={`Open first uncovered line in ${file.path}`}
                disabled={file.firstUncoveredLine === null}
                onClick={() => onOpenFile(file)}
                style={{
                  ...styles.label,
                  cursor: file.firstUncoveredLine === null ? "default" : "pointer",
                }}
                type="button"
              >
                {file.path}
              </button>
              <span style={styles.muted}>
                Lines {file.summary.covered}/{file.summary.total} ·{" "}
                {coveragePercentage(file.summary.percentage)} · Branches {file.branches.covered}/
                {file.branches.total} · {coveragePercentage(file.branches.percentage)} · Functions{" "}
                {file.functions.covered}/{file.functions.total} ·{" "}
                {coveragePercentage(file.functions.percentage)}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function coveragePercentage(percentage: number | null): string {
  return percentage === null ? "—" : `${percentage.toFixed(1)}%`;
}

function failedRunStatus(completed: number, total: number): string {
  return completed > 0
    ? `Rerunning failed JavaScript tests (${completed}/${total})…`
    : `Rerunning ${total} failed JavaScript tests…`;
}

function TreeNode({
  debugDisabled,
  disabled,
  level,
  node,
  onOpenTest,
  onDebugNode,
  onRunScope,
  rootPath,
}: TreeNodeProps): ReactNode {
  const children = node.kind === "test" ? [] : node.children;
  const fullName = nodeFullName(node);
  const scope =
    node.kind === "workspace"
      ? { kind: "all" as const }
      : jsTestRunScopeForExplorerNode(rootPath, node);
  const label = node.kind === "workspace" ? node.rootPath : node.label;

  return (
    <li aria-label={`${nodeKindLabel(node.kind)} ${label}`} style={styles.node}>
      <div style={{ ...styles.row, paddingLeft: (level - 1) * 16 + 8 }}>
        <StatusIndicator status={node.status} />
        {node.kind === "test" ? (
          <button
            aria-label={`Open test ${fullName}`}
            onClick={() => onOpenTest(node)}
            style={{ ...styles.label, cursor: "pointer" }}
            type="button"
          >
            {node.label}
          </button>
        ) : (
          <span style={styles.label} title={label}>
            {label}
          </span>
        )}
        <button
          aria-label={runButtonLabel(node, fullName, scope)}
          disabled={disabled}
          onClick={() => onRunScope(scope)}
          style={{ ...styles.action, ...styles.run }}
          type="button"
        >
          <Play aria-hidden="true" size={12} />
          Run
        </button>
        {node.kind !== "workspace" ? (
          <button
            aria-label={debugButtonLabel(node, fullName, scope)}
            disabled={debugDisabled}
            onClick={() => void onDebugNode(node)}
            style={styles.action}
            type="button"
          >
            <Bug aria-hidden="true" size={12} />
            Debug
          </button>
        ) : null}
      </div>
      {children.length > 0 ? (
        <ul style={styles.children}>
          {children.map((child) => (
            <TreeNode
              debugDisabled={debugDisabled}
              disabled={disabled}
              key={child.id}
              level={level + 1}
              node={child}
              onOpenTest={onOpenTest}
              onDebugNode={onDebugNode}
              onRunScope={onRunScope}
              rootPath={rootPath}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function StatusIndicator({ status }: { readonly status: JsTestExplorerStatus }) {
  return (
    <span aria-label={`Status: ${status}`} role="img" style={styles.status} title={status}>
      {statusGlyph[status]}
    </span>
  );
}

const statusGlyph: Readonly<Record<JsTestExplorerStatus, string>> = {
  failed: "×",
  idle: "○",
  passed: "✓",
  running: "◌",
  skipped: "–",
};

function nodeFullName(node: JsTestExplorerNode): string {
  if (node.kind === "suite") return node.suitePath.join(" ");
  if (node.kind === "test") return [...node.suitePath, node.label].join(" ");
  return "";
}

function runButtonLabel(node: JsTestExplorerNode, fullName: string, scope: JsTestRunScope): string {
  if (node.kind === "workspace") return `Run workspace ${node.rootPath}`;
  if (scope.kind === "file") return `Run tests in ${fileName(node.filePath)}`;
  if (node.kind === "suite") return `Run suite ${fullName}`;
  return `Run test ${fullName}`;
}

function debugButtonLabel(
  node: Exclude<JsTestExplorerNode, JsTestExplorerWorkspaceNode>,
  fullName: string,
  scope: JsTestRunScope,
): string {
  if (scope.kind === "file") return `Debug tests in ${fileName(node.filePath)}`;
  if (node.kind === "suite") return `Debug suite ${fullName}`;
  return `Debug test ${fullName}`;
}

function nodeKindLabel(kind: JsTestExplorerNode["kind"]): string {
  if (kind === "workspace") return "Workspace";
  if (kind === "file") return "File";
  if (kind === "suite") return "Suite";
  return "Test";
}

function fileName(path: string): string {
  const segments = path.split("\\").join("/").split("/").filter(Boolean);
  return segments[segments.length - 1] ?? path;
}

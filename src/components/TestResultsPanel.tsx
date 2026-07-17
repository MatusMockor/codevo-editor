import { Play, RefreshCw } from "lucide-react";
import { useState, type CSSProperties } from "react";
import {
  sortTestCasesFailedFirst,
  testCaseCanNavigate,
  testCaseCanRun,
  testStatusRank,
  testSuiteStatus,
  testTotalsSummary,
  type TestCase,
  type TestRunOk,
  type TestStatus,
} from "../domain/testResults";

export interface TestResultsPanelCopy {
  emptyMessage: string;
  noSuitesMessage: string;
  panelLabel: string;
  runAllLabel: string;
  runLabel: string;
  runningMessage: string;
  testIdPrefix: string;
  title: string;
  totalsLabel: string;
}

export interface TestResultsPanelProps {
  copy: TestResultsPanelCopy;
  error: string | null;
  filter: string | null;
  isRunning: boolean;
  onOpenCase(testCase: TestCase): void;
  onRun(): void;
  onRunCase(testCase: TestCase): void;
  result: TestRunOk | null;
  rootPath: string | null;
  unavailable: string | null;
}

const styles: Record<string, CSSProperties> = {
  action: { background: "transparent", border: 0, color: "inherit" },
  badge: {
    border: "1px solid currentColor",
    borderRadius: 4,
    display: "inline-block",
    fontSize: 10,
    marginRight: 6,
    padding: "1px 5px",
    textTransform: "uppercase",
  },
  case: {
    borderTop: "1px solid var(--border-subtle)",
    display: "grid",
    gap: 8,
    gridTemplateColumns:
      "80px minmax(180px, 1fr) minmax(180px, 2fr) 70px 24px",
    padding: "6px 10px 6px 26px",
  },
  chip: {
    background: "transparent",
    border: "1px solid var(--border-subtle)",
    borderRadius: 999,
    color: "inherit",
    padding: "2px 8px",
  },
  chipActive: { background: "var(--background-active, rgba(127, 127, 127, 0.2))" },
  filtered: {
    maxWidth: 320,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  header: { alignItems: "center", display: "flex", gap: 8, padding: "6px 8px" },
  message: { padding: 16 },
  muted: { color: "var(--text-muted)" },
  panel: { height: "100%", overflow: "auto" },
  suite: { borderBottom: "1px solid var(--border-subtle)" },
  suiteHeader: { alignItems: "center", display: "flex", gap: 8, padding: "7px 10px" },
  summary: { marginLeft: "auto" },
  text: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
};

const statusColors: Record<TestStatus, string> = {
  error: "var(--status-error, #ef4444)",
  failed: "var(--status-error, #ef4444)",
  passed: "var(--status-success, #22c55e)",
  skipped: "var(--text-muted)",
};

type StatusFilter = "all" | "failed" | "skipped" | "passed";

const statusFilters: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Failed", value: "failed" },
  { label: "Skipped", value: "skipped" },
  { label: "Passed", value: "passed" },
];

export function TestResultsPanel({
  copy,
  error,
  filter,
  isRunning,
  onOpenCase,
  onRun,
  onRunCase,
  result,
  rootPath,
  unavailable,
}: TestResultsPanelProps) {
  const [filterState, setFilterState] = useState<{
    result: TestRunOk | null;
    status: StatusFilter;
  }>({ result, status: "all" });
  const statusFilter = filterState.result === result ? filterState.status : "all";
  const visibleSuites = result
    ? result.suites
        .map((suite, index) => ({ index, suite }))
        .sort(
          (left, right) =>
            testStatusRank(testSuiteStatus(left.suite)) -
              testStatusRank(testSuiteStatus(right.suite)) ||
            left.index - right.index,
        )
        .map(({ suite }) => ({
          cases: sortTestCasesFailedFirst(suite.cases).filter((testCase) =>
            statusMatchesFilter(testCase.status, statusFilter),
          ),
          suite,
        }))
        .filter(({ cases }) => statusFilter === "all" || cases.length > 0)
    : [];

  return (
    <div aria-label={copy.panelLabel} role="tabpanel" style={styles.panel}>
      <div style={styles.header}>
        <strong>{copy.title}</strong>
        {filter ? (
          <span
            data-testid={`${copy.testIdPrefix}-filter`}
            style={styles.filtered}
            title={filter}
          >
            Filtered: {filter}
          </span>
        ) : null}
        {filter ? (
          <button
            aria-label={copy.runAllLabel}
            disabled={isRunning}
            onClick={onRun}
            style={styles.action}
            type="button"
          >
            Run all
          </button>
        ) : null}
        {result
          ? statusFilters.map(({ label, value }) => (
              <button
                aria-label={`Show ${value} tests`}
                aria-pressed={statusFilter === value}
                key={value}
                onClick={() => setFilterState({ result, status: value })}
                style={{
                  ...styles.chip,
                  ...(statusFilter === value ? styles.chipActive : {}),
                }}
                type="button"
              >
                {label}
              </button>
            ))
          : null}
        {result ? (
          <span aria-label={copy.totalsLabel} style={styles.summary}>
            {testTotalsSummary(result.totals)}
          </span>
        ) : (
          <span style={styles.summary} />
        )}
        <button
          aria-label={copy.runLabel}
          disabled={isRunning}
          onClick={onRun}
          style={styles.action}
          type="button"
        >
          {result ? (
            <RefreshCw aria-hidden="true" size={14} />
          ) : (
            <Play aria-hidden="true" size={14} />
          )}
        </button>
      </div>
      {isRunning ? (
        <div role="status" style={styles.message}>
          {copy.runningMessage}
        </div>
      ) : null}
      {!isRunning && unavailable ? (
        <div style={styles.message}>{unavailable}</div>
      ) : null}
      {!isRunning && error ? (
        <div role="alert" style={styles.message}>
          {error}
        </div>
      ) : null}
      {!isRunning && !unavailable && !error && !result ? (
        <div style={styles.message}>{copy.emptyMessage}</div>
      ) : null}
      {!isRunning && result && result.suites.length === 0 ? (
        <div style={styles.message}>{copy.noSuitesMessage}</div>
      ) : null}
      {!isRunning && result && statusFilter !== "all" && visibleSuites.length === 0 ? (
        <div style={styles.message}>No {statusFilter} tests</div>
      ) : null}
      {visibleSuites.map(({ cases, suite }, suiteIndex) => {
        const suiteStatus = testSuiteStatus(suite);

        return (
          <section
            key={`${suite.name ?? "suite"}:${suiteIndex}`}
            style={styles.suite}
          >
            <div style={styles.suiteHeader}>
              <StatusBadge status={suiteStatus} />
              <strong data-testid={`${copy.testIdPrefix}-suite-name`}>
                {suite.name ?? "Unnamed suite"}
              </strong>
              <span style={styles.muted}>
                {(suite.tests ?? 0).toLocaleString("en-US")} tests
              </span>
            </div>
            {cases.map((testCase, caseIndex) => {
              const navigable = rootPath
                ? testCaseCanNavigate(rootPath, testCase)
                : false;
              const runnable = testCaseCanRun(testCase);

              return (
                <div
                  aria-disabled={!navigable || undefined}
                  data-testid={`${copy.testIdPrefix}-case`}
                  key={`${testCase.classname ?? ""}:${testCase.name ?? "case"}:${caseIndex}`}
                  onClick={navigable ? () => onOpenCase(testCase) : undefined}
                  style={{
                    ...styles.case,
                    ...(!navigable ? styles.muted : { cursor: "pointer" }),
                  }}
                >
                  <StatusBadge status={testCase.status} />
                  <span
                    data-testid={`${copy.testIdPrefix}-case-name`}
                    style={styles.text}
                    title={testCase.name ?? undefined}
                  >
                    {testCase.name ?? "Unnamed test"}
                  </span>
                  <span
                    data-testid={
                      testCase.message
                        ? `${copy.testIdPrefix}-message`
                        : undefined
                    }
                    style={styles.text}
                    title={testCase.message ?? testCase.classname ?? undefined}
                  >
                    {testCase.message ?? testCase.classname ?? testCase.file ?? "—"}
                  </span>
                  <span style={styles.muted}>
                    {testCase.time === null ? "—" : `${testCase.time}s`}
                  </span>
                  {testCase.status === "failed" || testCase.status === "error" ? (
                    <button
                      aria-label={`Run ${testCase.name ?? "unnamed test"}`}
                      disabled={isRunning || !runnable}
                      onClick={(event) => {
                        event.stopPropagation();
                        onRunCase(testCase);
                      }}
                      style={styles.action}
                      type="button"
                    >
                      <Play aria-hidden="true" size={14} />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

function statusMatchesFilter(
  status: TestStatus,
  filter: StatusFilter,
): boolean {
  if (filter === "all") {
    return true;
  }

  if (filter === "failed") {
    return status === "failed" || status === "error";
  }

  return status === filter;
}

function StatusBadge({ status }: { status: TestStatus }) {
  return (
    <span style={{ ...styles.badge, color: statusColors[status] }}>{status}</span>
  );
}

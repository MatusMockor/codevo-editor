import { Play, RefreshCw } from "lucide-react";
import { useState, type CSSProperties } from "react";
import {
  phpTestCaseCanRun,
  phpTestCaseCanNavigate,
  phpTestStatusRank,
  phpTestSuiteStatus,
  phpTestTotalsSummary,
  sortPhpTestCasesFailedFirst,
  type PhpTestCase,
  type PhpTestRunOk,
  type PhpTestStatus,
} from "../domain/phpTestResults";

interface PhpTestResultsPanelProps {
  error: string | null;
  filter: string | null;
  isRunning: boolean;
  onOpenCase(testCase: PhpTestCase): void;
  onRun(): void;
  onRunCase(testCase: PhpTestCase): void;
  result: PhpTestRunOk | null;
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

const statusColors: Record<PhpTestStatus, string> = {
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

export function PhpTestResultsPanel({
  error,
  filter,
  isRunning,
  onOpenCase,
  onRun,
  onRunCase,
  result,
  rootPath,
  unavailable,
}: PhpTestResultsPanelProps) {
  const [filterState, setFilterState] = useState<{
    result: PhpTestRunOk | null;
    status: StatusFilter;
  }>({ result, status: "all" });
  const statusFilter = filterState.result === result ? filterState.status : "all";
  const visibleSuites = result
    ? result.suites
        .map((suite, index) => ({ index, suite }))
        .sort(
          (left, right) =>
            phpTestStatusRank(phpTestSuiteStatus(left.suite)) -
              phpTestStatusRank(phpTestSuiteStatus(right.suite)) ||
            left.index - right.index,
        )
        .map(({ suite }) => ({
          cases: sortPhpTestCasesFailedFirst(suite.cases).filter((testCase) =>
            statusMatchesFilter(testCase.status, statusFilter),
          ),
          suite,
        }))
        .filter(({ cases }) => statusFilter === "all" || cases.length > 0)
    : [];

  return (
    <div aria-label="PHP test results" role="tabpanel" style={styles.panel}>
      <div style={styles.header}>
        <strong>PHP Tests</strong>
        {filter ? (
          <span
            data-testid="php-test-filter"
            style={styles.filtered}
            title={filter}
          >
            Filtered: {filter}
          </span>
        ) : null}
        {filter ? (
          <button
            aria-label="Run all PHP tests"
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
          <span aria-label="PHP test totals" style={styles.summary}>
            {phpTestTotalsSummary(result.totals)}
          </span>
        ) : (
          <span style={styles.summary} />
        )}
        <button
          aria-label="Run PHP tests"
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
          Running PHP tests…
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
        <div style={styles.message}>Run PHP tests to see results.</div>
      ) : null}
      {!isRunning && result && result.suites.length === 0 ? (
        <div style={styles.message}>No PHP test suites were reported.</div>
      ) : null}
      {!isRunning && result && statusFilter !== "all" && visibleSuites.length === 0 ? (
        <div style={styles.message}>No {statusFilter} tests</div>
      ) : null}
      {visibleSuites.map(({ cases, suite }, suiteIndex) => {
        const suiteStatus = phpTestSuiteStatus(suite);

        return (
          <section
            key={`${suite.name ?? "suite"}:${suiteIndex}`}
            style={styles.suite}
          >
            <div style={styles.suiteHeader}>
              <StatusBadge status={suiteStatus} />
              <strong data-testid="php-test-suite-name">
                {suite.name ?? "Unnamed suite"}
              </strong>
              <span style={styles.muted}>
                {(suite.tests ?? 0).toLocaleString("en-US")} tests
              </span>
            </div>
            {cases.map((testCase, caseIndex) => {
              const navigable = rootPath
                ? phpTestCaseCanNavigate(rootPath, testCase)
                : false;
              const runnable = phpTestCaseCanRun(testCase);

              return (
                <div
                  aria-disabled={!navigable || undefined}
                  data-testid="php-test-case"
                  key={`${testCase.classname ?? ""}:${testCase.name ?? "case"}:${caseIndex}`}
                  onClick={navigable ? () => onOpenCase(testCase) : undefined}
                  style={{
                    ...styles.case,
                    ...(!navigable ? styles.muted : { cursor: "pointer" }),
                  }}
                >
                  <StatusBadge status={testCase.status} />
                  <span
                    data-testid="php-test-case-name"
                    style={styles.text}
                    title={testCase.name ?? undefined}
                  >
                    {testCase.name ?? "Unnamed test"}
                  </span>
                  <span
                    data-testid={testCase.message ? "php-test-message" : undefined}
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
  status: PhpTestStatus,
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

function StatusBadge({ status }: { status: PhpTestStatus }) {
  return (
    <span style={{ ...styles.badge, color: statusColors[status] }}>{status}</span>
  );
}

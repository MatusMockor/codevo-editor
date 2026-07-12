import { Play, RefreshCw } from "lucide-react";
import type { CSSProperties } from "react";
import {
  phpTestCaseCanRun,
  phpTestCaseCanNavigate,
  phpTestSuiteStatus,
  phpTestTotalsSummary,
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
  return (
    <div aria-label="PHP test results" role="tabpanel" style={styles.panel}>
      <div style={styles.header}>
        <strong>PHP Tests</strong>
        {filter ? <span>Filtered: {filter}</span> : null}
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
      {result?.suites.map((suite, suiteIndex) => {
        const suiteStatus = phpTestSuiteStatus(suite);

        return (
          <section
            key={`${suite.name ?? "suite"}:${suiteIndex}`}
            style={styles.suite}
          >
            <div style={styles.suiteHeader}>
              <StatusBadge status={suiteStatus} />
              <strong>{suite.name ?? "Unnamed suite"}</strong>
              <span style={styles.muted}>
                {(suite.tests ?? 0).toLocaleString("en-US")} tests
              </span>
            </div>
            {suite.cases.map((testCase, caseIndex) => {
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
                  <span style={styles.text} title={testCase.name ?? undefined}>
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

function StatusBadge({ status }: { status: PhpTestStatus }) {
  return (
    <span style={{ ...styles.badge, color: statusColors[status] }}>{status}</span>
  );
}

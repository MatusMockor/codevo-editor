import { Play, Trash2 } from "lucide-react";
import type { CSSProperties } from "react";
import type { PhpCoverageMetric } from "../domain/phpCloverCoverage";
import {
  TestResultsPanel,
  type TestResultsPanelCopy,
  type TestResultsPanelProps,
} from "./TestResultsPanel";

export interface PhpTestResultsPanelProps extends Omit<TestResultsPanelProps, "copy"> {
  readonly canRunCoverage?: boolean;
  readonly coverageError?: string | null;
  readonly coverageRunning?: boolean;
  readonly coverageSummary?: PhpCoverageMetric | null;
  readonly coverageUnavailable?: string | null;
  onClearCoverage?(): void;
  onRunCoverage?(): void;
}

const phpTestResultsCopy: TestResultsPanelCopy = {
  emptyMessage: "Run PHP tests to see results.",
  noSuitesMessage: "No PHP test suites were reported.",
  panelLabel: "PHP test results",
  runAllLabel: "Run all PHP tests",
  runLabel: "Run PHP tests",
  runningMessage: "Running PHP tests…",
  testIdPrefix: "php-test",
  title: "PHP Tests",
  totalsLabel: "PHP test totals",
};

const styles: Record<string, CSSProperties> = {
  action: {
    alignItems: "center",
    background: "transparent",
    border: 0,
    color: "inherit",
    display: "inline-flex",
    gap: 4,
  },
  message: { padding: "4px 8px" },
  summary: { color: "var(--text-muted)", whiteSpace: "nowrap" },
};

export function PhpTestResultsPanel({
  canRunCoverage = false,
  coverageError = null,
  coverageRunning = false,
  coverageSummary = null,
  coverageUnavailable = null,
  onClearCoverage = () => undefined,
  onRunCoverage = () => undefined,
  ...props
}: PhpTestResultsPanelProps) {
  const coverageStatePresent = Boolean(coverageSummary || coverageError || coverageUnavailable);
  const headerActions = (
    <>
      <button
        aria-busy={coverageRunning || undefined}
        aria-label="Run PHP tests with coverage"
        disabled={!canRunCoverage || coverageRunning || props.isRunning}
        onClick={onRunCoverage}
        style={styles.action}
        type="button"
      >
        <Play aria-hidden="true" size={14} />
        Run with Coverage
      </button>
      <button
        aria-label="Clear PHP test coverage"
        disabled={coverageRunning || !coverageStatePresent}
        onClick={onClearCoverage}
        style={styles.action}
        type="button"
      >
        <Trash2 aria-hidden="true" size={14} />
        Clear Coverage
      </button>
      {coverageSummary ? (
        <span aria-label="PHP coverage summary" style={styles.summary}>
          {coverageSummary.covered.toLocaleString("en-US")}/
          {coverageSummary.total.toLocaleString("en-US")} lines covered
          {coverageSummary.percentage === null
            ? ""
            : ` · ${coverageSummary.percentage.toFixed(1)}%`}
        </span>
      ) : null}
    </>
  );
  const supplementalStatus = coverageRunning ? (
    <div aria-live="polite" role="status" style={styles.message}>
      Running PHP test coverage…
    </div>
  ) : coverageUnavailable ? (
    <div style={styles.message}>{coverageUnavailable}</div>
  ) : coverageError ? (
    <div role="alert" style={styles.message}>
      {coverageError}
    </div>
  ) : null;
  return (
    <TestResultsPanel
      {...props}
      actionsDisabled={coverageRunning}
      copy={phpTestResultsCopy}
      headerActions={headerActions}
      supplementalStatus={supplementalStatus}
    />
  );
}

import {
  TestResultsPanel,
  type TestResultsPanelCopy,
  type TestResultsPanelProps,
} from "./TestResultsPanel";

export type PhpTestResultsPanelProps = Omit<TestResultsPanelProps, "copy">;

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

export function PhpTestResultsPanel(props: PhpTestResultsPanelProps) {
  return <TestResultsPanel {...props} copy={phpTestResultsCopy} />;
}

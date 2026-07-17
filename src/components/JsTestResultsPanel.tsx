import {
  TestResultsPanel,
  type TestResultsPanelCopy,
  type TestResultsPanelProps,
} from "./TestResultsPanel";

export type JsTestResultsPanelProps = Omit<TestResultsPanelProps, "copy">;

const jsTestResultsCopy: TestResultsPanelCopy = {
  emptyMessage: "Run JavaScript tests to see results.",
  noSuitesMessage: "No JavaScript test suites were reported.",
  panelLabel: "JavaScript test results",
  runAllLabel: "Run all JavaScript tests",
  runLabel: "Run JavaScript tests",
  runningMessage: "Running JavaScript tests…",
  testIdPrefix: "js-test",
  title: "JavaScript Tests",
  totalsLabel: "JavaScript test totals",
};

export function JsTestResultsPanel(props: JsTestResultsPanelProps) {
  return <TestResultsPanel {...props} copy={jsTestResultsCopy} />;
}

import type { Command } from "./commandRegistry";

interface WorkbenchJsTestCommandsOptions {
  hasJsWorkspace: boolean;
  isActiveDocumentJsTest: boolean;
  runTestForActiveDocument: Command["run"];
  runAllTestsForActiveDocument: Command["run"];
  openTestResultsPanel: Command["run"];
}

export function workbenchJsTestCommands({
  hasJsWorkspace,
  isActiveDocumentJsTest,
  runTestForActiveDocument,
  runAllTestsForActiveDocument,
  openTestResultsPanel,
}: WorkbenchJsTestCommandsOptions): Command[] {
  return [
    {
      id: "js.runTest",
      title: "Run Test Under Cursor",
      category: "JavaScript",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentJsTest,
      run: runTestForActiveDocument,
    },
    {
      id: "js.runTestFile",
      title: "Run All Tests in File",
      category: "JavaScript",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentJsTest,
      run: runAllTestsForActiveDocument,
    },
    {
      id: "js.runTestsWithResultsPanel",
      title: "JavaScript: Run Tests with Results Panel",
      category: "JavaScript",
      isEnabled: (context) => context.hasWorkspace && hasJsWorkspace,
      run: openTestResultsPanel,
    },
  ];
}

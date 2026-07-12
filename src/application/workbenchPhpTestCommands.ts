import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchPhpTestCommandsOptions {
  shortcut(commandId: KeymapCommandId): string;
  isActiveDocumentPhp: boolean;
  isActiveDocumentPhpTest: boolean;
  generateTestForActiveDocument: Command["run"];
  goToTestForActiveDocument: Command["run"];
  runTestForActiveDocument: Command["run"];
  runAllTestsForActiveDocument: Command["run"];
  hasPhpWorkspace: boolean;
  openTestResultsPanel: Command["run"];
}

export function workbenchPhpTestCommands({
  shortcut,
  isActiveDocumentPhp,
  isActiveDocumentPhpTest,
  generateTestForActiveDocument,
  goToTestForActiveDocument,
  runTestForActiveDocument,
  runAllTestsForActiveDocument,
  hasPhpWorkspace,
  openTestResultsPanel,
}: WorkbenchPhpTestCommandsOptions): Command[] {
  return [
    {
      id: "php.generateTest",
      title: "Generate Test",
      category: "PHP",
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentPhp,
      run: generateTestForActiveDocument,
    },
    {
      id: "php.goToTest",
      title: "Go to Test / Test Subject",
      category: "PHP",
      shortcut: shortcut("php.goToTest"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentPhp,
      run: goToTestForActiveDocument,
    },
    {
      id: "php.runTest",
      title: "Run Test Under Cursor",
      category: "PHP",
      shortcut: shortcut("php.runTest"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentPhp,
      run: runTestForActiveDocument,
    },
    {
      id: "php.runTestFile",
      title: "Run All Tests in File",
      category: "PHP",
      shortcut: shortcut("php.runTestFile"),
      isEnabled: (context) =>
        context.hasWorkspace &&
        context.hasActiveDocument &&
        isActiveDocumentPhpTest,
      run: runAllTestsForActiveDocument,
    },
    {
      id: "php.runTestsWithResultsPanel",
      title: "PHP: Run Tests with Results Panel",
      category: "PHP",
      shortcut: shortcut("php.runTestsWithResultsPanel"),
      isEnabled: (context) => context.hasWorkspace && hasPhpWorkspace,
      run: openTestResultsPanel,
    },
  ];
}

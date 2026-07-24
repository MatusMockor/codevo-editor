import type { KeymapCommandId } from "../domain/keymap";
import type { Command } from "./commandRegistry";

interface WorkbenchJsTestCommandsOptions {
  canCancelTestRun?: () => boolean;
  canDebugAtCursor?: () => boolean;
  canRerunFailedTests?: () => boolean;
  canRerunLastRun?: () => boolean;
  canRunAtCursor?: () => boolean;
  canRunCurrentFile?: () => boolean;
  cancelTestRun?: () => boolean | Promise<boolean>;
  debugAtCursor?: Command["run"];
  hasJsWorkspace: boolean;
  isActiveDocumentJsTest: boolean;
  runAtCursor?: Command["run"];
  runCurrentFile?: Command["run"];
  runTestForActiveDocument: Command["run"];
  runAllTestsForActiveDocument: Command["run"];
  openTestResultsPanel: Command["run"];
  rerunFailedTests?: () => boolean | Promise<boolean>;
  rerunLastRun?: () => boolean | Promise<boolean>;
  shortcut?: (commandId: KeymapCommandId) => string;
}

export function workbenchJsTestCommands({
  canCancelTestRun = () => false,
  canDebugAtCursor = () => false,
  canRerunFailedTests = () => false,
  canRerunLastRun = () => false,
  canRunAtCursor = () => false,
  canRunCurrentFile = () => false,
  cancelTestRun = () => false,
  debugAtCursor = () => undefined,
  hasJsWorkspace,
  isActiveDocumentJsTest,
  runAtCursor = () => undefined,
  runCurrentFile = () => undefined,
  runTestForActiveDocument,
  runAllTestsForActiveDocument,
  openTestResultsPanel,
  rerunFailedTests = () => false,
  rerunLastRun = () => false,
  shortcut = () => "",
}: WorkbenchJsTestCommandsOptions): Command[] {
  return [
    {
      id: "testing.runAtCursor",
      title: "Run Test at Cursor",
      category: "Test",
      shortcut: shortcut("testing.runAtCursor"),
      visibleInCommandPalette: true,
      isEnabled: (context) =>
        context.hasWorkspace &&
        hasJsWorkspace &&
        context.hasActiveDocument &&
        !context.activeDocumentDirty &&
        isActiveDocumentJsTest &&
        canRunAtCursor(),
      run: runAtCursor,
    },
    {
      id: "testing.debugAtCursor",
      title: "Debug Test at Cursor",
      category: "Test",
      isEnabled: (context) =>
        context.hasWorkspace &&
        hasJsWorkspace &&
        context.hasActiveDocument &&
        !context.activeDocumentDirty &&
        isActiveDocumentJsTest &&
        canDebugAtCursor(),
      run: debugAtCursor,
    },
    {
      id: "testing.runCurrentFile",
      title: "Run Tests in Current File",
      category: "Test",
      shortcut: shortcut("testing.runCurrentFile"),
      visibleInCommandPalette: true,
      isEnabled: (context) =>
        context.hasWorkspace &&
        hasJsWorkspace &&
        context.hasActiveDocument &&
        !context.activeDocumentDirty &&
        isActiveDocumentJsTest &&
        canRunCurrentFile(),
      run: runCurrentFile,
    },
    {
      id: "testing.reRunFailTests",
      title: "Rerun Failed Tests",
      category: "Test",
      shortcut: shortcut("testing.reRunFailTests"),
      visibleInCommandPalette: true,
      isEnabled: (context) => context.hasWorkspace && hasJsWorkspace && canRerunFailedTests(),
      run: async () => {
        await rerunFailedTests();
      },
    },
    {
      id: "testing.reRunLastRun",
      title: "Rerun Last Run",
      category: "Test",
      shortcut: shortcut("testing.reRunLastRun"),
      visibleInCommandPalette: true,
      isEnabled: (context) => context.hasWorkspace && hasJsWorkspace && canRerunLastRun(),
      run: async () => {
        await rerunLastRun();
      },
    },
    {
      id: "testing.cancelRun",
      title: "Cancel Test Run",
      category: "Test",
      shortcut: shortcut("testing.cancelRun"),
      visibleInCommandPalette: false,
      isEnabled: () => canCancelTestRun(),
      run: async () => {
        await cancelTestRun();
      },
    },
    {
      id: "js.runTest",
      title: "Run Test Under Cursor",
      category: "JavaScript",
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument && isActiveDocumentJsTest,
      run: runTestForActiveDocument,
    },
    {
      id: "js.runTestFile",
      title: "Run All Tests in File",
      category: "JavaScript",
      isEnabled: (context) =>
        context.hasWorkspace && context.hasActiveDocument && isActiveDocumentJsTest,
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

import { useRef, useState } from "react";
import { useJsTestExplorer } from "../application/useJsTestExplorer";
import { useJsTestCoverage } from "../application/useJsTestCoverage";
import { useJsTestExplorerDebug } from "../application/useJsTestExplorerDebug";
import { useJsTestExplorerScopeRunnerPort } from "../application/useJsTestExplorerScopeRunnerPort";
import type { JsTestExplorerScopeRunnerPort } from "../application/useJsTestRunSelectionCommands";
import type { DebugLaunchTarget } from "../domain/debug";
import type { JsTestCoverageGateway } from "../domain/jsTestCoverage";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import type { JsTestGateway } from "../domain/jsTestRunScope";
import type { JsTestTaskGateway } from "../domain/jsTestTask";
import type { JsTestProblemsSnapshot } from "../domain/jsTestProblems";
import { formatJsTestOutput } from "../domain/jsTestOutput";
import type { TextClipboardGateway } from "../domain/textClipboard";
import type {
  JsTestExplorerCurrentFileIdentity,
  JsTestExplorerOpenedFilesSnapshot,
} from "../domain/jsTestExplorerFilter";
import { validatedJsTestRunScope } from "../domain/jsTestRunScope";
import { joinWorkspacePath } from "../domain/workspace";
import type { JsTestExplorerPanelProps } from "./JsTestExplorerPanel";

interface UseJsTestExplorerPanelControllerOptions {
  readonly activeDocumentIdentity?: JsTestExplorerCurrentFileIdentity | null;
  readonly discoveryGateway: WorkspaceTestDiscoveryGateway;
  readonly coverageGateway: JsTestCoverageGateway;
  readonly coverageInvalidationVersion: number;
  readonly continuousRunVersion?: number;
  readonly discoveryVersion: number;
  readonly debugStartBlocked: boolean;
  readonly isDebugStartBlocked: () => boolean;
  readonly isOpen: boolean;
  readonly openedFilesSnapshot?: JsTestExplorerOpenedFilesSnapshot | null;
  readonly outputClipboard?: TextClipboardGateway | null;
  readonly onOpenLocation: (path: string, lineNumber: number) => void;
  readonly openDebugPanel: () => void;
  readonly rootPath: string | null;
  readonly runGateway: JsTestGateway;
  readonly taskGateway?: JsTestTaskGateway | null;
  readonly runRequestVersion: number;
  readonly workspaceId: string | null;
  readonly workspaceTrusted: boolean;
  readonly startDebug: (launch: DebugLaunchTarget) => Promise<void>;
}

export type JsTestExplorerPanelController = JsTestExplorerPanelProps & {
  readonly currentFileIdentity: JsTestExplorerCurrentFileIdentity | null;
  readonly problemSnapshot: JsTestProblemsSnapshot | null;
  readonly scopeRunner: JsTestExplorerScopeRunnerPort;
};

export function useJsTestExplorerPanelController({
  activeDocumentIdentity = null,
  coverageGateway,
  coverageInvalidationVersion,
  continuousRunVersion = 0,
  discoveryGateway,
  discoveryVersion,
  debugStartBlocked,
  isDebugStartBlocked,
  isOpen,
  openedFilesSnapshot = null,
  outputClipboard = null,
  onOpenLocation,
  openDebugPanel,
  rootPath,
  runGateway,
  runRequestVersion,
  taskGateway = null,
  workspaceId,
  workspaceTrusted,
  startDebug,
}: UseJsTestExplorerPanelControllerOptions): JsTestExplorerPanelController {
  const [query, setQuery] = useState("");
  const competingStartRef = useRef<"continuous" | "coverage" | "debug" | null>(null);
  const coverage = useJsTestCoverage({
    gateway: coverageGateway,
    invalidationVersion: coverageInvalidationVersion,
    rootPath,
    workspaceId,
    workspaceTrusted,
  });
  const selectedDebug = useJsTestExplorerDebug({
    debugStartBlocked,
    discoveryGateway,
    isDebugStartBlocked,
    openDebugPanel,
    rootPath,
    startDebug,
    workspaceId,
    workspaceTrusted,
  });
  const explorer = useJsTestExplorer({
    continuousRunBlocked: coverage.isRunning || selectedDebug.isDebugging || debugStartBlocked,
    continuousRunVersion,
    discoveryGateway,
    discoveryVersion,
    isOpen,
    rootPath,
    resultInvalidationVersion: coverageInvalidationVersion,
    runGateway,
    runRequestVersion,
    taskGateway,
    workspaceId,
    workspaceTrusted,
  });
  const scopeRunner = useJsTestExplorerScopeRunnerPort(explorer);
  if (coverage.isRunning) {
    competingStartRef.current = "coverage";
  } else if (selectedDebug.isDebugging) {
    competingStartRef.current = "debug";
  } else if (explorer.continuousRunEnabled || explorer.continuousRunStopping) {
    competingStartRef.current = "continuous";
  } else {
    competingStartRef.current = null;
  }
  const output = explorer.outputSnapshot?.output ?? null;
  const canCopyOutput = output !== null && canWriteTestOutput(outputClipboard);

  return {
    canCancelTestRun: explorer.canCancelTestRun(),
    canCopyOutput,
    canRerunFailedTests: explorer.canRerunFailedTests(),
    canStartContinuousRun: explorer.canStartContinuousRun(),
    continuousRunEnabled: explorer.continuousRunEnabled,
    continuousRunPending: explorer.continuousRunPending,
    continuousRunRunning: explorer.continuousRunRunning,
    continuousRunStopping: explorer.continuousRunStopping,
    coverageError: coverage.error,
    coverageReport: coverage.report,
    coverageRunning: coverage.isRunning,
    coverageUnavailable: coverage.unavailable,
    currentFileIdentity: activeDocumentIdentity,
    debugError: selectedDebug.error,
    debugging: selectedDebug.isDebugging,
    debugStartBlocked: selectedDebug.blocked,
    debugUnavailable: selectedDebug.unavailable ?? selectedDebug.blockedReason,
    error: explorer.error,
    executionStartBlocked: !workspaceTrusted,
    failedRunCompleted: explorer.failedRunCompleted,
    failedRunPhase: explorer.failedRunPhase,
    failedRunTotal: explorer.failedRunTotal,
    loading: explorer.isLoading,
    onCancelTestRun: () => void explorer.cancelTestRun(),
    onOpenTest: (test) => {
      if (!rootPath) return;
      const path = safeJsTestNavigationPath(rootPath, test.filePath);
      if (path) onOpenLocation(path, test.target.position.lineNumber);
    },
    onClearCoverage: coverage.clear,
    onCopyOutput: async () => {
      if (!output || !canCopyOutput || !outputClipboard) return false;
      try {
        await outputClipboard.writeText(formatJsTestOutput(output));
        return true;
      } catch {
        return false;
      }
    },
    onOpenCoverageFile: (file) => {
      if (!rootPath || file.firstUncoveredLine === null) return;
      const path = safeJsTestNavigationPath(rootPath, file.path);
      if (path) onOpenLocation(path, file.firstUncoveredLine);
    },
    onDebugNode: async (node) => {
      if (
        competingStartRef.current !== null ||
        coverage.isRunning ||
        explorer.continuousRunEnabled ||
        explorer.continuousRunStopping ||
        isDebugStartBlocked()
      ) {
        return;
      }
      competingStartRef.current = "debug";
      try {
        await selectedDebug.debug(node);
      } finally {
        if (!selectedDebug.isDebugging) competingStartRef.current = null;
      }
    },
    openedFilesSnapshot,
    output,
    onQueryChange: setQuery,
    onRefresh: () => void explorer.refresh(),
    onRerunFailedTests: () => void explorer.rerunFailedTests(),
    onRunScope: (scope) => void explorer.run(scope),
    onRunCoverage: () => {
      if (
        competingStartRef.current !== null ||
        explorer.continuousRunEnabled ||
        explorer.continuousRunStopping ||
        selectedDebug.isDebugging ||
        isDebugStartBlocked()
      ) {
        return;
      }
      competingStartRef.current = "coverage";
      void coverage.run().finally(() => {
        if (!coverage.isRunning) competingStartRef.current = null;
      });
    },
    onStartContinuousRun: () => {
      if (
        competingStartRef.current !== null ||
        coverage.isRunning ||
        selectedDebug.isDebugging ||
        isDebugStartBlocked()
      ) {
        return;
      }
      competingStartRef.current = "continuous";
      if (!explorer.startContinuousRun()) competingStartRef.current = null;
    },
    onStopContinuousRun: () => void explorer.stopContinuousRun(),
    problemSnapshot: explorer.problemSnapshot,
    query,
    running: explorer.isRunning,
    scopeRunner,
    tree: explorer.tree,
    truncated: explorer.truncated,
    unavailable: explorer.unavailable,
    workspaceId,
  };
}

function canWriteTestOutput(clipboard: TextClipboardGateway | null): boolean {
  if (!clipboard) return false;
  try {
    return clipboard.canWriteText();
  } catch {
    return false;
  }
}

function safeJsTestNavigationPath(rootPath: string, filePath: string): string | null {
  try {
    const scope = validatedJsTestRunScope({ kind: "file", relativeFilePath: filePath });
    if (scope.kind !== "file") return null;
    return joinWorkspacePath(rootPath, scope.relativeFilePath);
  } catch {
    return null;
  }
}

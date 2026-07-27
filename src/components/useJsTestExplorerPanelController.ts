import { useEffect, useMemo, useRef, useState } from "react";
import { useJsTestExplorer } from "../application/useJsTestExplorer";
import { useJsTestCoverage } from "../application/useJsTestCoverage";
import { useJsTestExplorerDebug } from "../application/useJsTestExplorerDebug";
import { detectJsTestRunnerContext } from "../application/jsTestRunnerDetection";
import { createJsTestExecutionRootResolver } from "../application/jsTestExecutionRootResolver";
import { useJsTestExplorerScopeRunnerPort } from "../application/useJsTestExplorerScopeRunnerPort";
import type { JsTestExplorerScopeRunnerPort } from "../application/useJsTestRunSelectionCommands";
import type { DebugLaunchTarget } from "../domain/debug";
import type { JsTestWatchCommand, JsTestWatchGateway } from "../domain/jsTestCommand";
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
import { joinWorkspacePath, workspaceRelativePath } from "../domain/workspace";
import { workspaceRootKeysEqual } from "../domain/workspaceRootKey";
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
  readonly watchGateway?: JsTestWatchGateway | null;
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

interface ContinuousRunWatchCommandState {
  readonly authority: object;
  readonly available: boolean;
  readonly command: JsTestWatchCommand | null;
}

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
  watchGateway = null,
  workspaceId,
  workspaceTrusted,
  startDebug,
}: UseJsTestExplorerPanelControllerOptions): JsTestExplorerPanelController {
  const [query, setQuery] = useState("");
  const continuousRunWatchAuthority = useMemo(
    () =>
      Object.freeze({ discoveryGateway, rootPath, watchGateway, workspaceId, workspaceTrusted }),
    [discoveryGateway, rootPath, watchGateway, workspaceId, workspaceTrusted],
  );
  const [continuousRunWatchCommandState, setContinuousRunWatchCommandState] =
    useState<ContinuousRunWatchCommandState | null>(null);
  const continuousRunWatchCommand =
    continuousRunWatchCommandState?.authority === continuousRunWatchAuthority
      ? continuousRunWatchCommandState.command
      : null;
  const continuousRunAvailable =
    continuousRunWatchCommandState?.authority === continuousRunWatchAuthority &&
    continuousRunWatchCommandState.available;
  const competingStartRef = useRef<"continuous" | "coverage" | "debug" | null>(null);
  const resolveExecutionRoot = useMemo(
    () =>
      rootPath
        ? createJsTestExecutionRootResolver(rootPath, (path) =>
            readRunnerDetectionFile(discoveryGateway, rootPath, path),
          )
        : workspaceExecutionRoot,
    [discoveryGateway, rootPath],
  );
  const coverageExecutionScope = useMemo(
    () =>
      activeDocumentIdentity
        ? validatedJsTestRunScope({
            kind: "file",
            relativeFilePath: activeDocumentIdentity.relativeFilePath,
          })
        : ({ kind: "all" } as const),
    [activeDocumentIdentity],
  );
  useEffect(() => {
    let current = true;
    if (!rootPath || !workspaceId || !workspaceTrusted || !watchGateway) {
      setContinuousRunWatchCommandState(null);
      return () => {
        current = false;
      };
    }
    void detectJsTestRunnerContext(rootPath, (path) =>
      readRunnerDetectionFile(discoveryGateway, rootPath, path),
    ).then((context) => {
      if (!current) return;
      if (context?.continuousRunStrategy !== "native-watch") {
        setContinuousRunWatchCommandState((previous) =>
          sameContinuousRunWatchCommandState(
            previous,
            continuousRunWatchAuthority,
            context !== null && workspaceRootKeysEqual(context.rootPath, rootPath),
            null,
          )
            ? previous
            : {
                authority: continuousRunWatchAuthority,
                available: context !== null && workspaceRootKeysEqual(context.rootPath, rootPath),
                command: null,
              },
        );
        return;
      }
      const packageRootRelativePath = workspaceRootKeysEqual(context.rootPath, rootPath)
        ? ""
        : workspaceRelativePath(rootPath, context.rootPath);
      if (packageRootRelativePath === null) {
        setContinuousRunWatchCommandState((previous) =>
          sameContinuousRunWatchCommandState(previous, continuousRunWatchAuthority, false, null)
            ? previous
            : { authority: continuousRunWatchAuthority, available: false, command: null },
        );
        return;
      }
      const next: JsTestWatchCommand = {
        kind: context.runner === "vitest" ? "vitest-watch" : "jest-watch",
        packageRootRelativePath,
        scope: { kind: "all" },
      };
      setContinuousRunWatchCommandState((previous) =>
        sameContinuousRunWatchCommandState(previous, continuousRunWatchAuthority, true, next)
          ? previous
          : { authority: continuousRunWatchAuthority, available: true, command: next },
      );
    });
    return () => {
      current = false;
    };
  }, [
    continuousRunWatchAuthority,
    discoveryGateway,
    discoveryVersion,
    rootPath,
    watchGateway,
    workspaceId,
    workspaceTrusted,
  ]);
  const coverage = useJsTestCoverage({
    executionScope: coverageExecutionScope,
    gateway: coverageGateway,
    invalidationVersion: coverageInvalidationVersion,
    rootPath,
    resolveExecutionRoot,
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
    continuousRunBlocked:
      !continuousRunAvailable ||
      coverage.isRunning ||
      selectedDebug.isDebugging ||
      debugStartBlocked,
    continuousRunVersion,
    continuousRunWatchCommand: workspaceTrusted ? continuousRunWatchCommand : null,
    discoveryGateway,
    discoveryVersion,
    isOpen,
    rootPath,
    resultInvalidationVersion: coverageInvalidationVersion,
    runGateway,
    resolveExecutionRoot,
    runRequestVersion,
    taskGateway,
    watchGateway: workspaceTrusted ? watchGateway : null,
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

async function workspaceExecutionRoot(): Promise<{ readonly packageRootRelativePath: "" }> {
  return Object.freeze({ packageRootRelativePath: "" });
}

async function readRunnerDetectionFile(
  gateway: WorkspaceTestDiscoveryGateway,
  rootPath: string,
  path: string,
): Promise<string | null> {
  const relativePath = workspaceRelativePath(rootPath, path);
  if (relativePath === null) return null;
  try {
    const result = await gateway.readTextFileBounded(rootPath, relativePath, 1_024 * 1_024);
    return result.status === "ok" ? result.content : null;
  } catch {
    return null;
  }
}

function canWriteTestOutput(clipboard: TextClipboardGateway | null): boolean {
  if (!clipboard) return false;
  try {
    return clipboard.canWriteText();
  } catch {
    return false;
  }
}

function sameJsTestWatchCommand(
  previous: JsTestWatchCommand | null,
  next: JsTestWatchCommand | null,
): boolean {
  if (previous === next) return true;
  if (!previous || !next) return false;
  return (
    previous.kind === next.kind &&
    previous.packageRootRelativePath === next.packageRootRelativePath &&
    sameJsTestRunScope(previous.scope, next.scope)
  );
}

function sameContinuousRunWatchCommandState(
  previous: ContinuousRunWatchCommandState | null,
  authority: object,
  available: boolean,
  command: JsTestWatchCommand | null,
): boolean {
  return (
    previous?.authority === authority &&
    previous.available === available &&
    sameJsTestWatchCommand(previous.command, command)
  );
}

function sameJsTestRunScope(
  previous: JsTestWatchCommand["scope"],
  next: JsTestWatchCommand["scope"],
): boolean {
  if (previous.kind !== next.kind) return false;
  if (previous.kind === "all" && next.kind === "all") return true;
  if (previous.kind === "file" && next.kind === "file") {
    return previous.relativeFilePath === next.relativeFilePath;
  }
  if (previous.kind === "suite" && next.kind === "suite") {
    return (
      previous.relativeFilePath === next.relativeFilePath && previous.fullName === next.fullName
    );
  }
  if (previous.kind !== "test" || next.kind !== "test") return false;
  return (
    previous.relativeFilePath === next.relativeFilePath &&
    previous.fullName === next.fullName &&
    previous.nameMatch === next.nameMatch
  );
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

import { useEffect, useMemo } from "react";
import { useJsTestProblemNoticeComposition } from "../application/useJsTestProblemNoticeComposition";
import type { useWorkbenchController } from "../application/useWorkbenchController";
import { usePhpTestResults } from "../application/usePhpTestResults";
import {
  usePhpCloverCoverage,
  type PhpCloverCoveragePort,
  type PhpCloverCoveragePortResult,
} from "../application/usePhpCloverCoverage";
import { createWorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import type { JsTestCoverageGateway } from "../domain/jsTestCoverage";
import type { JsTestWatchGateway } from "../domain/jsTestCommand";
import type { WorkspaceTestDiscoveryGateway } from "../domain/jsTestDiscovery";
import type { JsTestGateway } from "../domain/jsTestRunScope";
import type { JsTestTaskGateway } from "../domain/jsTestTask";
import type { JsTestBatchGateway } from "../domain/jsTestBatch";
import { jsTestProblemSnapshotToNotices } from "../domain/jsTestProblems";
import type { WorkbenchNotice } from "../application/workbenchNotice";
import type { PhpTestGateway } from "../domain/phpTestResults";
import type { TextClipboardGateway } from "../domain/textClipboard";
import { useJsTestExplorerPanelController } from "./useJsTestExplorerPanelController";
import type { JsTestExplorerScopeRunnerBridge } from "../application/jsTestExplorerScopeRunnerBridge";
import { usePhpCoverageInvalidationVersion } from "../application/usePhpCoverageInvalidationVersion";
import {
  createPhpTestCoverageInvalidationStore,
  type PhpTestCoverageInvalidationStore,
} from "../application/phpTestCoverageInvalidationStore";
import { editorGroupsUniquePaths, type EditorGroupsState } from "../domain/editorGroups";
import {
  jsTestExplorerActiveDocumentIdentity,
  jsTestExplorerOpenedDocumentIdentitySnapshot,
} from "./jsTestExplorerActiveDocumentOwnership";

const EMPTY_JS_TEST_PROBLEM_NOTICES: readonly WorkbenchNotice[] = Object.freeze([]);
const unavailablePhpCoveragePort: PhpCloverCoveragePort = Object.freeze({
  runAndReadReport: async (): Promise<PhpCloverCoveragePortResult> => ({
    status: "unavailable",
  }),
});
const unavailablePhpCoverageInvalidationStore: PhpTestCoverageInvalidationStore =
  createPhpTestCoverageInvalidationStore();

export function useAppTestPanels({
  jsTestCoverageGateway,
  jsTestExplorerScopeRunnerBind,
  jsTestGateway,
  jsTestWatchGateway,
  phpTestGateway,
  phpCloverCoveragePort = unavailablePhpCoveragePort,
  textClipboard = null,
  workbench,
  workspaceTestDiscoveryGateway,
  workspaceTrusted,
}: {
  readonly jsTestCoverageGateway: JsTestCoverageGateway;
  readonly jsTestExplorerScopeRunnerBind?: JsTestExplorerScopeRunnerBridge["bind"];
  readonly jsTestGateway: JsTestGateway & JsTestTaskGateway & JsTestBatchGateway;
  readonly jsTestWatchGateway: JsTestWatchGateway;
  readonly phpTestGateway: PhpTestGateway;
  readonly phpCloverCoveragePort?: PhpCloverCoveragePort;
  readonly textClipboard?: TextClipboardGateway | null;
  readonly workbench: ReturnType<typeof useWorkbenchController>;
  readonly workspaceTestDiscoveryGateway: WorkspaceTestDiscoveryGateway;
  readonly workspaceTrusted: boolean;
}) {
  const testResultsPanelOpen =
    workbench.bottomPanelVisible && String(workbench.bottomPanelView) === "testResults";
  const phpTestResults = usePhpTestResults({
    gateway: phpTestGateway,
    isOpen: testResultsPanelOpen,
    rootPath: workbench.workspaceRoot,
    runRequestVersion: workbench.phpTestRunRequestVersion,
    workspaceTrusted,
  });
  const phpCoverageWorkspaceOwner = useMemo(() => {
    const workspaceId = workbench.workspaceIdentityDescriptor?.workspaceId;
    return workspaceId && workbench.workspaceRoot
      ? createWorkspaceRuntimeOwner(workspaceId, workbench.workspaceRoot)
      : null;
  }, [workbench.workspaceIdentityDescriptor?.workspaceId, workbench.workspaceRoot]);
  const phpCoverageInvalidationVersion = usePhpCoverageInvalidationVersion({
    documents: workbench.openDocuments ?? [],
    fileChangeStore: validPhpCoverageInvalidationStore(workbench.phpTestCoverageInvalidationStore),
    runRequestVersion: workbench.phpTestRunRequestVersion,
  });
  const phpCloverCoverage = usePhpCloverCoverage({
    invalidationVersion: phpCoverageInvalidationVersion,
    isWorkspaceCurrent: (owner) =>
      workbench.workspaceIdentityDescriptor?.workspaceId === owner.ownerKey &&
      workbench.workspaceRoot === owner.executionRoot,
    port: phpCloverCoveragePort,
    workspaceOwner: phpCoverageWorkspaceOwner,
    workspaceTrusted,
  });
  const { scopeRunner: jsTestExplorerScopeRunner, ...jsTestExplorerPanel } =
    useJsTestExplorerPanelController({
      activeDocumentIdentity: jsTestExplorerActiveDocumentIdentity({
        activeDocument: workbench.activeDocument,
        workspace: workbench.workspaceIdentityDescriptor,
        workspaceRoot: workbench.workspaceRoot,
      }),
      batchGateway: jsTestGateway,
      coverageGateway: jsTestCoverageGateway,
      coverageInvalidationVersion: workbench.jsTestCoverageVersion,
      continuousRunVersion: workbench.jsTestContinuousRunVersion,
      discoveryGateway: workspaceTestDiscoveryGateway,
      discoveryVersion: workbench.jsTestDiscoveryVersion,
      isOpen: testResultsPanelOpen && !!workbench.workspaceDescriptor?.javaScriptTypeScript,
      openedFilesSnapshot: jsTestExplorerOpenedDocumentIdentitySnapshot({
        openedEditorResourcePaths: safeEditorGroupResourcePaths(workbench.editorGroups),
        workspace: workbench.workspaceIdentityDescriptor,
        workspaceRoot: workbench.workspaceRoot,
      }),
      outputClipboard: textClipboard,
      onOpenLocation: workbench.openSourceLocation,
      rootPath: workbench.workspaceRoot,
      runGateway: jsTestGateway,
      runRequestVersion: workbench.jsTestRunRequestVersion,
      taskGateway: jsTestGateway,
      watchGateway: jsTestWatchGateway,
      workspaceId: workbench.workspaceIdentityDescriptor?.workspaceId ?? null,
      workspaceTrusted,
    });
  useEffect(
    () => jsTestExplorerScopeRunnerBind?.(jsTestExplorerScopeRunner),
    [jsTestExplorerScopeRunner, jsTestExplorerScopeRunnerBind],
  );
  const jsTestProblemNotices = useMemo(() => {
    if (!jsTestExplorerPanel.problemSnapshot || !workbench.workspaceRoot) {
      return EMPTY_JS_TEST_PROBLEM_NOTICES;
    }
    return jsTestProblemSnapshotToNotices(
      jsTestExplorerPanel.problemSnapshot,
      workbench.workspaceRoot,
    );
  }, [jsTestExplorerPanel.problemSnapshot, workbench.workspaceRoot]);
  const jsTestProblemGroupKey = jsTestProblemNotices[0]?.groupKey;
  const jsTestProblemNoticesPublished = Boolean(
    jsTestProblemGroupKey &&
    workbench.notices.some(({ groupKey }) => groupKey === jsTestProblemGroupKey),
  );
  useJsTestProblemNoticeComposition(
    jsTestProblemNotices,
    jsTestProblemNoticesPublished,
    workbench.replaceJavaScriptTestProblemNotices,
  );
  return { jsTestExplorerPanel, phpCloverCoverage, phpTestResults };
}

function validPhpCoverageInvalidationStore(candidate: unknown): PhpTestCoverageInvalidationStore {
  return candidate !== null &&
    typeof candidate === "object" &&
    typeof (candidate as Partial<PhpTestCoverageInvalidationStore>).getSnapshot === "function" &&
    typeof (candidate as Partial<PhpTestCoverageInvalidationStore>).subscribe === "function" &&
    typeof (candidate as Partial<PhpTestCoverageInvalidationStore>).handleWorkspaceFileChange ===
      "function"
    ? (candidate as PhpTestCoverageInvalidationStore)
    : unavailablePhpCoverageInvalidationStore;
}

function safeEditorGroupResourcePaths(candidate: unknown): readonly string[] {
  if (!candidate || typeof candidate !== "object") return Object.freeze([]);
  try {
    return Object.freeze(editorGroupsUniquePaths(candidate as EditorGroupsState));
  } catch {
    return Object.freeze([]);
  }
}

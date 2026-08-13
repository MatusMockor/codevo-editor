import type { AgentRootLeaseGateway } from "../domain/agentProject";
import type { AgentTaskGateway } from "../domain/agentTask";
import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type { EditorSurfaceCommandRunner } from "../domain/editorSurfaceCommand";
import type { NodeRunTaskGateway } from "../domain/nodeRunTask";
import type { PrettierFormattingGateway } from "../domain/prettierFormatting";
import type { VscodeProcessTasksGateway } from "../domain/vscodeProcessTasksGateway";
import type {
  FileSearchGateway,
  PhpToolGateway,
  TextSearchGateway,
  WorkspaceDetectionGateway,
  WorkspaceFileGateway,
  WorkspaceOwnerFileGateway,
  WorkspaceOwnerRelativeFileGateway,
} from "../domain/workspace";
import type { WorkspaceFileChangeGateway } from "../domain/workspaceFileChange";
import type { WorkspaceSourceDiscoveryGateway } from "../domain/workspaceSourceDiscovery";
import type { DiagnosticsFlushScheduler } from "../domain/diagnosticsCoalescer";
import type { ProjectSymbolSearchGateway } from "../domain/projectSymbols";
import type { DirtyCloseDecisionPort } from "./dirtyCloseDecisionPort";
import type { EditorGroupFocusRunner } from "./editorGroupFocusPort";
import type { NpmOpenScriptNavigationGatewayBinder } from "./useNpmOpenScriptNavigation";
import type { NodePackageScriptsWorkbenchGateway } from "./useNodePackageScriptWorkbench";
import type { WorkbenchDebugControllerOptions } from "./workbenchDebugControllerOptions";
import type { EditorSurfaceEslintDisableRunner } from "./workbenchEslintDisableCommand";
import type {
  EditorSurfaceBufferFixRunner,
  EditorSurfacePhpstanIgnoreRunner,
} from "./useWorkbenchCodeQualityDiagnostics";
import type { WorkspaceIdentityGateway } from "./workspaceIdentityGatewayPort";
import type { DirtyTextSearchComputationGateway } from "./dirtyTextSearchComputation";
import type { EditorCursorStorePort } from "./editorCursorStore";
import type { IncrementalLanguageServerDocumentSyncGateway } from "../domain/incrementalLanguageServerDocumentSync";
import type { EditorActiveLiveDocumentSaveAdmissionPort } from "./editorActiveLiveDocumentSaveCoordinator";

export interface WorkbenchWorkspaceGateways {
  detection: WorkspaceDetectionGateway;
  dirtyTextSearch: DirtyTextSearchComputationGateway;
  fileChanges: WorkspaceFileChangeGateway;
  fileSearch: FileSearchGateway;
  files: WorkspaceFileGateway;
  ownerFiles?: WorkspaceOwnerFileGateway & WorkspaceOwnerRelativeFileGateway;
  identity: WorkspaceIdentityGateway;
  phpTools: PhpToolGateway;
  projectSymbols: ProjectSymbolSearchGateway;
  textSearch: TextSearchGateway;
}

export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {
  activeLiveDocumentSaveCoordinator?: EditorActiveLiveDocumentSaveAdmissionPort;
  agentRootLeaseGateway?: AgentRootLeaseGateway;
  agentTaskGateway?: AgentTaskGateway;
  gitWorktreeGateway?: GitWorktreeGateway;
  javaScriptTypeScriptIncrementalLanguageServerDocumentSyncGateway?: IncrementalLanguageServerDocumentSyncGateway;
  editorCursorStore?: EditorCursorStorePort;
  cancelJavaScriptTypeScriptLanguageServerRequest?(
    rootPath: string,
    sessionId: number,
    requestId: number,
  ): Promise<void>;
  /**
   * Strategy that defers the coalesced diagnostics flush. Production omits this
   * to use one flush per animation frame (with a `setTimeout(0)` fallback);
   * tests inject a deterministic scheduler so flushes can be driven explicitly.
   */
  diagnosticsFlushScheduler?: DiagnosticsFlushScheduler;
  editorSurfaceBufferFixRunner?: EditorSurfaceBufferFixRunner | null;
  editorSurfaceEslintDisableRunner?: EditorSurfaceEslintDisableRunner | null;
  editorSurfacePhpstanIgnoreRunner?: EditorSurfacePhpstanIgnoreRunner | null;
  editorSurfaceCommandRunner?: EditorSurfaceCommandRunner | null;
  editorMenuCommandRunner?: EditorMenuCommandRunner | null;
  editorGroupFocusRunner?: EditorGroupFocusRunner | null;
  markdownPreviewRenderer?: (markdown: string) => Promise<string>;
  dirtyCloseDecisionPort?: DirtyCloseDecisionPort;
  onDidCloseEditorPaths?: (paths: readonly string[]) => void;
  prettierFormattingGateway?: PrettierFormattingGateway;
  nodePackageScriptsGateway?: NodePackageScriptsWorkbenchGateway;
  nodeRunTaskGateway?: NodeRunTaskGateway;
  vscodeProcessTasksGateway?: VscodeProcessTasksGateway;
  workspaceSourceDiscoveryGateway?: WorkspaceSourceDiscoveryGateway &
    NpmOpenScriptNavigationGatewayBinder;
}

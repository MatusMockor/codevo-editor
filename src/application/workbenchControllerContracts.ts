import type { EditorMenuCommandRunner } from "../domain/editorMenuCommand";
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
} from "../domain/workspace";
import type { WorkspaceFileChangeGateway } from "../domain/workspaceFileChange";
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

export interface WorkbenchWorkspaceGateways {
  detection: WorkspaceDetectionGateway;
  fileChanges: WorkspaceFileChangeGateway;
  fileSearch: FileSearchGateway;
  files: WorkspaceFileGateway;
  ownerFiles?: WorkspaceOwnerFileGateway;
  identity: WorkspaceIdentityGateway;
  phpTools: PhpToolGateway;
  projectSymbols: ProjectSymbolSearchGateway;
  textSearch: TextSearchGateway;
}

export interface WorkbenchControllerOptions extends WorkbenchDebugControllerOptions {
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
  workspaceSourceDiscoveryGateway?: NpmOpenScriptNavigationGatewayBinder;
}

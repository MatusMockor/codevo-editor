import { useCallback, useMemo } from "react";
import type { ArtisanControllerAction } from "../../domain/artisanRoutes";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import { quoteShellArgument, terminalDirectoryForEntry } from "../../domain/pathDerivation";
import type { EditorDocument, FileEntry } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { navigateToArtisanController } from "../artisanRouteNavigation";
import { useConfigureVscodeProcessTasks } from "../useConfigureVscodeProcessTasks";
import { useDebugBreakpointNavigation } from "../useDebugBreakpointNavigation";
import { useDebugCallStackNavigation } from "../useDebugCallStackNavigation";
import { useDebugEvaluateInConsole } from "../useDebugEvaluateInConsole";
import { useDebugInlineBreakpoint } from "../useDebugInlineBreakpoint";
import { useDebugRestartFrame } from "../useDebugRestartFrame";
import { useNodeLaunchConfigurationsSurface } from "../useNodeLaunchConfigurationsSurface";
import { createNodeLaunchPickerCoordinator } from "../useNodeLaunchConfigurationPicker";
import { useNodeLaunchWorkspaceCurrent } from "../useNodeLaunchWorkspaceCurrent";
import { useWorkbenchNodePackageScripts } from "../useNodePackageScriptWorkbench";
import { usePhpTestCaseNavigation } from "../usePhpTestCaseNavigation";
import { useTerminalTestRunner } from "../useTerminalTestRunner";
import { useWorkbenchDebugOrchestration } from "../useWorkbenchDebugOrchestration";
import { useWorkbenchFrameworkPanels } from "../useWorkbenchFrameworkPanels";
import { useWorkbenchJsTestCursorDebugging } from "../useWorkbenchJsTestCursorDebugging";
import { useWorkbenchNodeRunWithoutDebugging } from "../useWorkbenchNodeRunWithoutDebugging";
import { useWorkbenchNpmOpenScriptNavigation } from "../useWorkbenchNpmOpenScriptNavigation";
import type { useWorkbenchNavigation } from "../useWorkbenchNavigation";
import { useWorkbenchVscodeProcessTasks } from "../useWorkbenchVscodeProcessTasks";
import { unavailableNodeRunTaskGateway } from "../workbenchUnavailableTaskGateways";
import type { WorkbenchControllerOptions } from "../workbenchControllerContracts";

type TerminalTestRunnerDependencies = Parameters<typeof useTerminalTestRunner>[0];
type ConfigureVscodeProcessTasksDependencies = Parameters<typeof useConfigureVscodeProcessTasks>[0];
type DebugOrchestrationDependencies = Parameters<typeof useWorkbenchDebugOrchestration>[0];
type NodePackageScriptDependencies = Parameters<typeof useWorkbenchNodePackageScripts>[0];
type FrameworkPanelDependencies = Parameters<typeof useWorkbenchFrameworkPanels>[0];
type NodeRunDependencies = Parameters<typeof useWorkbenchNodeRunWithoutDebugging>[0];
type VscodeProcessTaskDependencies = Parameters<typeof useWorkbenchVscodeProcessTasks>[0];
type ArtisanNavigationDependencies = Parameters<typeof navigateToArtisanController>[0];

interface WorkspaceDiscoveryVersions {
  readonly nodeLaunchConfigurationVersion: number;
  readonly nodePackageScriptDiscoveryVersion: number;
  readonly vscodeProcessTasksVersion: number;
}

type WorkbenchTaskDebugOptions = Pick<
  WorkbenchControllerOptions,
  | "debugAddToWatchCommands"
  | "debugBreakpointNavigationCaptureReader"
  | "debugBreakpointStorage"
  | "debugCopyEvaluatePathOnce"
  | "debugCopyValueCommands"
  | "debugEvaluateInConsoleCaptureReader"
  | "debugInlineBreakpointCaptureReader"
  | "debugSetVariableCommands"
  | "debugTextClipboard"
  | "debugWatchAtCursorCaptureReader"
  | "jsTestExplorerScopeRunner"
  | "nodeDebugAttachCandidateGateway"
  | "nodeDebugAttachCandidateStart"
  | "nodePackageScriptsGateway"
  | "nodeRunTaskGateway"
  | "serverReadyExternalUrlOpener"
  | "vscodeProcessTasksGateway"
  | "workspaceSourceDiscoveryGateway"
>;

export interface WorkbenchTaskDebugCoordinatorDependencies {
  activeDocument: NodeRunDependencies["activeDocument"];
  activeDocumentRef: TerminalTestRunnerDependencies["activeDocumentRef"];
  activeEditorPositionRef: TerminalTestRunnerDependencies["activeEditorPositionRef"];
  currentEditorSessionOwnerKeyRef: { readonly current: EditorSessionOwnerKey | null };
  currentWorkspaceRootRef: TerminalTestRunnerDependencies["currentWorkspaceRootRef"];
  debugGateway: DebugOrchestrationDependencies["debugGateway"];
  editorSessionOwnerKey: EditorSessionOwnerKey | null;
  invalidateJsTestCoverageAndResults: TerminalTestRunnerDependencies["invalidateJsTestCoverageAndResults"];
  isActiveDocumentJsTest: DebugOrchestrationDependencies["isActiveDocumentJsTest"];
  isActiveDocumentPhpTest: DebugOrchestrationDependencies["isActiveDocumentPhpTest"];
  isWorkspaceTrusted: DebugOrchestrationDependencies["isWorkspaceTrusted"];
  openDocuments: readonly EditorDocument[];
  openFile: ConfigureVscodeProcessTasksDependencies["openFile"];
  openNavigationTarget: ReturnType<typeof useWorkbenchNavigation>["openNavigationTarget"];
  options: WorkbenchTaskDebugOptions;
  prompter: DebugOrchestrationDependencies["prompter"];
  readTestFileIfExists: TerminalTestRunnerDependencies["readTestFileIfExists"];
  reportErrorForActiveWorkspaceRoot: TerminalTestRunnerDependencies["reportErrorForActiveWorkspaceRoot"];
  setBottomPanelView: FrameworkPanelDependencies["setBottomPanelView"];
  setBottomPanelVisible: TerminalTestRunnerDependencies["setBottomPanelVisible"];
  setMessage: TerminalTestRunnerDependencies["setMessage"];
  setNotices: VscodeProcessTaskDependencies["setNotices"];
  terminalGateway: TerminalTestRunnerDependencies["terminalGateway"];
  workspaceDescriptor: TerminalTestRunnerDependencies["workspaceDescriptor"];
  workspaceDiscoveryVersions: WorkspaceDiscoveryVersions;
  workspaceFiles: ConfigureVscodeProcessTasksDependencies["workspaceFiles"] &
    DebugOrchestrationDependencies["workspaceFiles"];
  workspaceIdentityDescriptor: ConfigureVscodeProcessTasksDependencies["workspaceIdentity"];
  workspaceOwnerFiles: ConfigureVscodeProcessTasksDependencies["workspaceOwnerFiles"];
  workspaceRoot: TerminalTestRunnerDependencies["workspaceRoot"];
  workspaceRuntimeOwner: TerminalTestRunnerDependencies["workspaceRuntimeOwner"];
  workspaceRuntimeOwnerClaimsRef: ConfigureVscodeProcessTasksDependencies["workspaceRuntimeOwnerClaimsRef"];
  workspaceRuntimeOwnerRef: TerminalTestRunnerDependencies["workspaceRuntimeOwnerRef"];
  workspaceTrusted: NodePackageScriptDependencies["trusted"];
  workspaceTrustedRef: ConfigureVscodeProcessTasksDependencies["workspaceTrustedRef"];
}

export function useWorkbenchTaskDebugCoordinator({
  activeDocument,
  activeDocumentRef,
  activeEditorPositionRef,
  currentEditorSessionOwnerKeyRef,
  currentWorkspaceRootRef,
  debugGateway,
  editorSessionOwnerKey,
  invalidateJsTestCoverageAndResults,
  isActiveDocumentJsTest,
  isActiveDocumentPhpTest,
  isWorkspaceTrusted,
  openDocuments,
  openFile,
  openNavigationTarget,
  options,
  prompter,
  readTestFileIfExists,
  reportErrorForActiveWorkspaceRoot,
  setBottomPanelView,
  setBottomPanelVisible,
  setMessage,
  setNotices,
  terminalGateway,
  workspaceDescriptor,
  workspaceDiscoveryVersions,
  workspaceFiles,
  workspaceIdentityDescriptor,
  workspaceOwnerFiles,
  workspaceRoot,
  workspaceRuntimeOwner,
  workspaceRuntimeOwnerClaimsRef,
  workspaceRuntimeOwnerRef,
  workspaceTrusted,
  workspaceTrustedRef,
}: WorkbenchTaskDebugCoordinatorDependencies) {
  const openNodePackageScript = useWorkbenchNpmOpenScriptNavigation({
    discoveryVersion: workspaceDiscoveryVersions.nodePackageScriptDiscoveryVersion,
    documents: openDocuments,
    gateway: options.workspaceSourceDiscoveryGateway,
    identity: workspaceIdentityDescriptor,
    openNavigationTarget,
    rootPath: workspaceRoot,
  });
  const terminal = useTerminalTestRunner({
    activeDocumentRef,
    activeEditorPositionRef,
    currentWorkspaceRootRef,
    invalidateJsTestCoverageAndResults,
    workspaceRuntimeOwnerRef,
    readTestFileIfExists,
    reportErrorForActiveWorkspaceRoot,
    setBottomPanelView,
    setBottomPanelVisible,
    setMessage,
    terminalGateway,
    workspaceDescriptor,
    workspaceRoot,
    workspaceRuntimeOwner,
  });
  const configureTasks = useConfigureVscodeProcessTasks({
    currentWorkspaceRootRef,
    openFile,
    workspaceFiles,
    workspaceOwnerFiles,
    workspaceIdentity: workspaceIdentityDescriptor,
    workspaceRoot,
    workspaceRuntimeOwner,
    workspaceRuntimeOwnerClaimsRef,
    workspaceRuntimeOwnerRef,
    workspaceTrustedRef,
  });
  const vscodeProcessTaskComposition = useWorkbenchVscodeProcessTasks({
    configurationVersion: workspaceDiscoveryVersions.vscodeProcessTasksVersion,
    configureTasks,
    gateway: options.vscodeProcessTasksGateway,
    requestTerminalSession: terminal.requestActiveTerminalSession,
    rootPath: workspaceRoot,
    setNotices,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceTrusted,
  });
  const nodePackageScripts = useWorkbenchNodePackageScripts({
    currentWorkspaceRootRef,
    discoveryVersion: workspaceDiscoveryVersions.nodePackageScriptDiscoveryVersion,
    gateway: options.nodePackageScriptsGateway,
    hasJavaScriptTypeScriptWorkspace: !!workspaceDescriptor?.javaScriptTypeScript,
    identity: workspaceIdentityDescriptor,
    reportErrorForActiveWorkspaceRoot,
    requestTerminalSession: terminal.requestActiveTerminalSession,
    rootPath: workspaceRoot,
    setNotices,
    trusted: workspaceTrusted,
  });
  const nodeLaunchPickerCoordinator = useMemo(createNodeLaunchPickerCoordinator, []);
  const isNodeLaunchWorkspaceCurrent = useNodeLaunchWorkspaceCurrent(
    currentWorkspaceRootRef,
    workspaceRuntimeOwnerRef,
  );
  const debug = useWorkbenchDebugOrchestration({
    activeDocumentRef,
    activeEditorPositionRef,
    configurationPickerCoordinator: nodeLaunchPickerCoordinator,
    currentWorkspaceRootRef,
    debugBreakpointStorage: options.debugBreakpointStorage,
    debugTextClipboard: options.debugTextClipboard,
    debugAddToWatchCommands: options.debugAddToWatchCommands,
    debugCopyValueCommands: options.debugCopyValueCommands,
    debugSetVariableCommands: options.debugSetVariableCommands,
    debugCopyEvaluatePathOnce: options.debugCopyEvaluatePathOnce,
    debugGateway,
    serverReadyExternalUrlOpener: options.serverReadyExternalUrlOpener,
    hasJavaScriptTypeScriptWorkspace: () => !!workspaceDescriptor?.javaScriptTypeScript,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    isWorkspaceTrusted,
    isWorkspaceCurrent: isNodeLaunchWorkspaceCurrent,
    nodeDebugAttachCandidateGateway: options.nodeDebugAttachCandidateGateway,
    nodeDebugAttachCandidateStart: options.nodeDebugAttachCandidateStart,
    nodeLaunchConfigurationVersion: workspaceDiscoveryVersions.nodeLaunchConfigurationVersion,
    openDocuments,
    openNavigationTarget,
    prompter,
    readTestFileIfExists,
    reportWarning: setMessage,
    setBottomPanelView,
    setBottomPanelVisible,
    workspaceFiles,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceRoot,
    vscodeProcessTasks: vscodeProcessTaskComposition.state,
  });
  const isCurrentEditorWorkspaceOwner = (rootPath: string, ownerKey: string) =>
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
    currentEditorSessionOwnerKeyRef.current === ownerKey;
  const isCurrentJavaScriptEditorWorkspaceOwner = (rootPath: string, ownerKey: string) =>
    !!workspaceDescriptor?.javaScriptTypeScript &&
    isCurrentEditorWorkspaceOwner(rootPath, ownerKey);
  const cursorDebug = useWorkbenchJsTestCursorDebugging({
    activeDocument: () => activeDocumentRef.current,
    captureReader: options.debugWatchAtCursorCaptureReader,
    isDebugStartBlocked: debug.debugSession.isDebugStartBlocked,
    isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,
    isWorkspaceTrusted,
    openDebugPanel: debug.openDebugPanel,
    ownerKey: editorSessionOwnerKey,
    readTextFileBounded: workspaceFiles.readTextFileBounded,
    reportWarning: setMessage,
    runner: options.jsTestExplorerScopeRunner,
    startDebugAccepted: debug.debugSession.startDebugAccepted,
    watches: debug.debugSession.watches,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceRoot,
  });
  const debugEvaluateInConsole = useDebugEvaluateInConsole({
    captureReader: options.debugEvaluateInConsoleCaptureReader,
    focusConsole: debug.debugSession.consoleSurface.focus,
    getDebugContext: () => {
      const state = debug.debugSession.snapshot.state;
      const sessionId = state.kind === "inactive" ? null : state.sessionId;
      const owner = debug.debugSession.inspectionOwner;
      const frameId =
        debug.debugSession.selectedFrameId ??
        (state.kind === "stopped" ? (state.topFrame?.frameId ?? null) : null);
      const exactOwner =
        state.kind === "stopped" &&
        owner?.sessionId === state.sessionId &&
        frameId === owner.frameId;
      return {
        adapterKind: debug.debugSession.debugAdapterKind,
        frameId: exactOwner ? owner.frameId : null,
        pauseGeneration: exactOwner ? owner.pauseGeneration : null,
        rootPath: exactOwner ? owner.rootKey : null,
        sessionId,
        stateKind: state.kind,
      };
    },
    isWorkspaceCurrent: isCurrentEditorWorkspaceOwner,
    isWorkspaceTrusted,
    submit: debug.debugSession.console.submit,
  });
  const debugBreakpointNavigation = useDebugBreakpointNavigation({
    captureReader: options.debugBreakpointNavigationCaptureReader,
    getBreakpoints: () => debug.debugSession.breakpoints,
    isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,
    openDebugLocation: debug.openDebugLocation,
  });
  const debugCallStackNavigation = useDebugCallStackNavigation({
    getPauseOwner: () => debug.debugSession.pauseOwner,
    getSelectedFrameId: () => debug.debugSession.selectedFrameId,
    getSnapshot: () => debug.debugSession.snapshot,
    selectFrame: debug.debugSession.selectFrame,
  });
  const debugRestartFrame = useDebugRestartFrame({
    canRestartFrame: debug.debugSession.canRestartFrame,
    getDebugAdapterKind: () => debug.debugSession.debugAdapterKind,
    getPauseOwner: () => debug.debugSession.pauseOwner,
    getSelectedFrameId: () => debug.debugSession.selectedFrameId,
    getSnapshot: () => debug.debugSession.snapshot,
    isWorkspaceTrusted,
    restartFrame: debug.debugSession.restartFrame,
  });
  const debugInlineBreakpoint = useDebugInlineBreakpoint({
    addBreakpoint: debug.debugSession.addInlineBreakpoint,
    captureReader: options.debugInlineBreakpointCaptureReader,
    getBreakpoints: () => debug.debugSession.breakpoints,
    isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,
  });
  const reportNodeRunError = useCallback(
    (error: unknown) =>
      reportErrorForActiveWorkspaceRoot(
        currentWorkspaceRootRef.current,
        "Run Without Debugging",
        error,
      ),
    [currentWorkspaceRootRef, reportErrorForActiveWorkspaceRoot],
  );
  const nodeRunWithoutDebugging = useWorkbenchNodeRunWithoutDebugging({
    activeDocument,
    configurationPickerCoordinator: nodeLaunchPickerCoordinator,
    configurationVersion: workspaceDiscoveryVersions.nodeLaunchConfigurationVersion,
    debugSession: debug.debugSession,
    gateway: options.nodeRunTaskGateway ?? unavailableNodeRunTaskGateway,
    hasJavaScriptTypeScriptWorkspace: !!workspaceDescriptor?.javaScriptTypeScript,
    isActiveDocumentJsTest,
    isWorkspaceCurrent: isNodeLaunchWorkspaceCurrent,
    isWorkspaceTrusted,
    readFileIfExists: readTestFileIfExists,
    reportError: reportNodeRunError,
    reportWarning: setMessage,
    requestTerminalSession: terminal.requestActiveTerminalSession,
    workspaceFiles,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceRoot,
    workspaceTrusted,
  });
  const nodeLaunchConfigurationsSurface = useNodeLaunchConfigurationsSurface({
    available: Boolean(
      workspaceRoot &&
      workspaceRuntimeOwner &&
      workspaceDescriptor?.javaScriptTypeScript &&
      workspaceRootKeysEqual(workspaceRoot, workspaceDescriptor.rootPath),
    ),
    closeDebugPicker: debug.debugSession.configurationLauncher.closePicker,
    closeRunPicker: nodeRunWithoutDebugging.configurationLauncher.closePicker,
    ownerKey: workspaceRuntimeOwner?.ownerKey ?? null,
  });

  return {
    ...cursorDebug,
    ...debug,
    ...terminal,
    debugBreakpointNavigation,
    debugCallStackNavigation,
    debugEvaluateInConsole,
    debugInlineBreakpoint,
    debugRestartFrame,
    nodeLaunchConfigurationsSurface,
    nodePackageScripts,
    nodeRunWithoutDebugging,
    openNodePackageScript,
    vscodeProcessTaskComposition,
  };
}

export interface WorkbenchTaskDebugNavigationCoordinatorDependencies {
  activeDocumentRef: TerminalTestRunnerDependencies["activeDocumentRef"];
  currentWorkspaceRootRef: TerminalTestRunnerDependencies["currentWorkspaceRootRef"];
  openNavigationTarget: ReturnType<typeof useWorkbenchNavigation>["openNavigationTarget"];
  projectSymbolSearch: ArtisanNavigationDependencies["projectSymbolSearch"];
  runInActiveTerminal: ReturnType<typeof useTerminalTestRunner>["runInActiveTerminal"];
  setBottomPanelView: FrameworkPanelDependencies["setBottomPanelView"];
  setBottomPanelVisible: FrameworkPanelDependencies["setBottomPanelVisible"];
  setJsTestRunRequestVersion: FrameworkPanelDependencies["setJsTestRunRequestVersion"];
  setMessage: TerminalTestRunnerDependencies["setMessage"];
  setPhpTestRunRequestVersion: FrameworkPanelDependencies["setPhpTestRunRequestVersion"];
  workspaceDescriptor: TerminalTestRunnerDependencies["workspaceDescriptor"];
  workspaceRoot: TerminalTestRunnerDependencies["workspaceRoot"];
}

export function useWorkbenchTaskDebugNavigationCoordinator({
  activeDocumentRef,
  currentWorkspaceRootRef,
  openNavigationTarget,
  projectSymbolSearch,
  runInActiveTerminal,
  setBottomPanelView,
  setBottomPanelVisible,
  setJsTestRunRequestVersion,
  setMessage,
  setPhpTestRunRequestVersion,
  workspaceDescriptor,
  workspaceRoot,
}: WorkbenchTaskDebugNavigationCoordinatorDependencies) {
  const openEntryInTerminal = useCallback(
    (entry: FileEntry) => {
      const requestedRoot = currentWorkspaceRootRef.current;

      if (!requestedRoot) {
        return;
      }

      const directory = terminalDirectoryForEntry(requestedRoot, entry);

      if (!directory) {
        return;
      }

      runInActiveTerminal(`cd -- ${quoteShellArgument(directory)}`);
    },
    [currentWorkspaceRootRef, runInActiveTerminal],
  );
  const frameworkPanels = useWorkbenchFrameworkPanels({
    currentWorkspaceRootRef,
    setBottomPanelView,
    setBottomPanelVisible,
    setJsTestRunRequestVersion,
    setPhpTestRunRequestVersion,
    workspaceDescriptor,
  });
  const openPhpTestCase = usePhpTestCaseNavigation({
    currentWorkspaceRootRef,
    openNavigationTarget,
  });
  const openArtisanController = useCallback(
    (action: ArtisanControllerAction) =>
      navigateToArtisanController(
        {
          activePath: activeDocumentRef.current?.path ?? "",
          currentRootPath: () => currentWorkspaceRootRef.current,
          openNavigationTarget,
          projectSymbolSearch,
          rootPath: workspaceRoot,
          setMessage,
        },
        action,
      ),
    [
      activeDocumentRef,
      currentWorkspaceRootRef,
      openNavigationTarget,
      projectSymbolSearch,
      setMessage,
      workspaceRoot,
    ],
  );

  return {
    ...frameworkPanels,
    openArtisanController,
    openEntryInTerminal,
    openPhpTestCase,
  };
}

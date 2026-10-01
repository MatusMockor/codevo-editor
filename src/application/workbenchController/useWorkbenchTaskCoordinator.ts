import { useCallback } from "react";
import type { ArtisanControllerAction } from "../../domain/artisanRoutes";
import type { EditorSessionOwnerKey } from "../../domain/editorSessionOwnerKey";
import {
  quoteShellArgument,
  terminalDirectoryForEntry,
  workspaceRelativePath,
} from "../../domain/pathDerivation";
import type { EditorDocument, FileEntry } from "../../domain/workspace";
import { workspaceRootKeysEqual } from "../../domain/workspaceRootKey";
import { navigateToArtisanController } from "../artisanRouteNavigation";
import { useConfigureVscodeProcessTasks } from "../useConfigureVscodeProcessTasks";
import { useWorkbenchNodePackageScripts } from "../useNodePackageScriptWorkbench";
import { usePhpTestCaseNavigation } from "../usePhpTestCaseNavigation";
import { useSourceLocationOpener } from "../useSourceLocationOpener";
import { useTerminalTestRunner } from "../useTerminalTestRunner";
import { useWorkbenchFrameworkPanels } from "../useWorkbenchFrameworkPanels";
import { useWorkbenchJsTestRunSelection } from "../useWorkbenchJsTestRunSelection";
import { useWorkbenchNpmOpenScriptNavigation } from "../useWorkbenchNpmOpenScriptNavigation";
import type { useWorkbenchNavigation } from "../useWorkbenchNavigation";
import { useWorkbenchVscodeProcessTasks } from "../useWorkbenchVscodeProcessTasks";
import type { WorkbenchControllerOptions } from "../workbenchControllerContracts";

type TerminalTestRunnerDependencies = Parameters<typeof useTerminalTestRunner>[0];
type ConfigureVscodeProcessTasksDependencies = Parameters<typeof useConfigureVscodeProcessTasks>[0];
type NodePackageScriptDependencies = Parameters<typeof useWorkbenchNodePackageScripts>[0];
type FrameworkPanelDependencies = Parameters<typeof useWorkbenchFrameworkPanels>[0];
type VscodeProcessTaskDependencies = Parameters<typeof useWorkbenchVscodeProcessTasks>[0];
type ArtisanNavigationDependencies = Parameters<typeof navigateToArtisanController>[0];

interface WorkspaceDiscoveryVersions {
  readonly nodePackageScriptDiscoveryVersion: number;
  readonly vscodeProcessTasksVersion: number;
}

type WorkbenchTaskOptions = Pick<
  WorkbenchControllerOptions,
  | "editorCursorCaptureReader"
  | "jsTestExplorerScopeRunner"
  | "nodePackageScriptsGateway"
  | "vscodeProcessTasksGateway"
  | "workspaceSourceDiscoveryGateway"
>;

export interface WorkbenchTaskCoordinatorDependencies {
  activeDocumentRef: TerminalTestRunnerDependencies["activeDocumentRef"];
  activeEditorPositionRef: TerminalTestRunnerDependencies["activeEditorPositionRef"];
  currentEditorSessionOwnerKeyRef: { readonly current: EditorSessionOwnerKey | null };
  currentWorkspaceRootRef: TerminalTestRunnerDependencies["currentWorkspaceRootRef"];
  editorSessionOwnerKey: EditorSessionOwnerKey | null;
  invalidateJsTestCoverageAndResults: TerminalTestRunnerDependencies["invalidateJsTestCoverageAndResults"];
  isWorkspaceTrusted: () => boolean;
  openDocuments: readonly EditorDocument[];
  openFile: ConfigureVscodeProcessTasksDependencies["openFile"];
  openNavigationTarget: ReturnType<typeof useWorkbenchNavigation>["openNavigationTarget"];
  options: WorkbenchTaskOptions;
  readTestFileIfExists: TerminalTestRunnerDependencies["readTestFileIfExists"];
  reportErrorForActiveWorkspaceRoot: TerminalTestRunnerDependencies["reportErrorForActiveWorkspaceRoot"];
  setBottomPanelView: FrameworkPanelDependencies["setBottomPanelView"];
  setBottomPanelVisible: TerminalTestRunnerDependencies["setBottomPanelVisible"];
  setMessage: TerminalTestRunnerDependencies["setMessage"];
  setNotices: VscodeProcessTaskDependencies["setNotices"];
  terminalGateway: TerminalTestRunnerDependencies["terminalGateway"];
  workspaceDescriptor: TerminalTestRunnerDependencies["workspaceDescriptor"];
  workspaceDiscoveryVersions: WorkspaceDiscoveryVersions;
  workspaceFiles: ConfigureVscodeProcessTasksDependencies["workspaceFiles"];
  workspaceIdentityDescriptor: ConfigureVscodeProcessTasksDependencies["workspaceIdentity"];
  workspaceOwnerFiles: ConfigureVscodeProcessTasksDependencies["workspaceOwnerFiles"];
  workspaceRoot: TerminalTestRunnerDependencies["workspaceRoot"];
  workspaceRuntimeOwner: TerminalTestRunnerDependencies["workspaceRuntimeOwner"];
  workspaceRuntimeOwnerClaimsRef: ConfigureVscodeProcessTasksDependencies["workspaceRuntimeOwnerClaimsRef"];
  workspaceRuntimeOwnerRef: TerminalTestRunnerDependencies["workspaceRuntimeOwnerRef"];
  workspaceTrusted: NodePackageScriptDependencies["trusted"];
  workspaceTrustedRef: ConfigureVscodeProcessTasksDependencies["workspaceTrustedRef"];
}

export function useWorkbenchTaskCoordinator({
  activeDocumentRef,
  activeEditorPositionRef,
  currentEditorSessionOwnerKeyRef,
  currentWorkspaceRootRef,
  editorSessionOwnerKey,
  invalidateJsTestCoverageAndResults,
  isWorkspaceTrusted,
  openDocuments,
  openFile,
  openNavigationTarget,
  options,
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
}: WorkbenchTaskCoordinatorDependencies) {
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
  const openSourceLocation = useSourceLocationOpener(openNavigationTarget);
  const isCurrentJavaScriptEditorWorkspaceOwner = (rootPath: string, ownerKey: string) =>
    !!workspaceDescriptor?.javaScriptTypeScript &&
    workspaceRootKeysEqual(currentWorkspaceRootRef.current, rootPath) &&
    currentEditorSessionOwnerKeyRef.current === ownerKey;
  const jsTestRunSelection = useWorkbenchJsTestRunSelection({
    activeDocument: () => activeDocumentRef.current,
    captureReader: options.editorCursorCaptureReader,
    isWorkspaceCurrent: isCurrentJavaScriptEditorWorkspaceOwner,
    isWorkspaceTrusted,
    ownerKey: editorSessionOwnerKey,
    readTextFileBounded: workspaceFiles.readTextFileBounded,
    runner: options.jsTestExplorerScopeRunner,
    workspaceId: workspaceIdentityDescriptor?.workspaceId ?? null,
    workspaceRoot,
  });

  return {
    ...terminal,
    jsTestRunSelection,
    nodePackageScripts,
    openNodePackageScript,
    openSourceLocation,
    vscodeProcessTaskComposition,
  };
}

export interface WorkbenchTaskNavigationCoordinatorDependencies {
  activeDocumentRef: TerminalTestRunnerDependencies["activeDocumentRef"];
  currentWorkspaceRootRef: TerminalTestRunnerDependencies["currentWorkspaceRootRef"];
  openNavigationTarget: ReturnType<typeof useWorkbenchNavigation>["openNavigationTarget"];
  projectSymbolSearch: ArtisanNavigationDependencies["projectSymbolSearch"];
  reportErrorForActiveWorkspaceRoot: TerminalTestRunnerDependencies["reportErrorForActiveWorkspaceRoot"];
  revealPathGateway: WorkbenchRevealPathPort | null;
  runInActiveTerminal: ReturnType<typeof useTerminalTestRunner>["runInActiveTerminal"];
  setBottomPanelView: FrameworkPanelDependencies["setBottomPanelView"];
  setBottomPanelVisible: FrameworkPanelDependencies["setBottomPanelVisible"];
  setJsTestRunRequestVersion: FrameworkPanelDependencies["setJsTestRunRequestVersion"];
  setMessage: TerminalTestRunnerDependencies["setMessage"];
  setPhpTestRunRequestVersion: FrameworkPanelDependencies["setPhpTestRunRequestVersion"];
  workspaceDescriptor: TerminalTestRunnerDependencies["workspaceDescriptor"];
  workspaceRoot: TerminalTestRunnerDependencies["workspaceRoot"];
  workspaceRuntimeOwnerRef: TerminalTestRunnerDependencies["workspaceRuntimeOwnerRef"];
}

export interface WorkbenchRevealPathPort {
  revealPath(request: { readonly path: string; readonly rootPath: string }): Promise<void>;
}

export interface WorkbenchRevealPathCommandPort {
  (
    command: "reveal_item_in_dir",
    request: { readonly path: string; readonly rootPath: string },
  ): Promise<unknown>;
}

export function createWorkbenchRevealPathPort(
  invokeCommand: WorkbenchRevealPathCommandPort,
): WorkbenchRevealPathPort {
  return Object.freeze<WorkbenchRevealPathPort>({
    revealPath: async (request) => {
      await invokeCommand("reveal_item_in_dir", request);
    },
  });
}

export function useWorkbenchTaskNavigationCoordinator({
  activeDocumentRef,
  currentWorkspaceRootRef,
  openNavigationTarget,
  projectSymbolSearch,
  reportErrorForActiveWorkspaceRoot,
  revealPathGateway,
  runInActiveTerminal,
  setBottomPanelView,
  setBottomPanelVisible,
  setJsTestRunRequestVersion,
  setMessage,
  setPhpTestRunRequestVersion,
  workspaceDescriptor,
  workspaceRoot,
  workspaceRuntimeOwnerRef,
}: WorkbenchTaskNavigationCoordinatorDependencies) {
  const revealEntry = useCallback(
    (entry: FileEntry) => {
      const requestedRoot = currentWorkspaceRootRef.current;
      const runtimeOwner = workspaceRuntimeOwnerRef.current;

      if (
        !requestedRoot ||
        !runtimeOwner ||
        !workspaceRootKeysEqual(runtimeOwner.executionRoot, requestedRoot) ||
        workspaceRelativePath(requestedRoot, entry.path) === null
      ) {
        return;
      }

      if (!revealPathGateway) {
        return;
      }

      void revealPathGateway
        .revealPath({
          path: entry.path,
          rootPath: requestedRoot,
        })
        .catch((error) => {
          if (workspaceRuntimeOwnerRef.current !== runtimeOwner) return;
          if (!workspaceRootKeysEqual(currentWorkspaceRootRef.current, requestedRoot)) return;
          reportErrorForActiveWorkspaceRoot(requestedRoot, "Reveal", error);
        });
    },
    [
      currentWorkspaceRootRef,
      reportErrorForActiveWorkspaceRoot,
      revealPathGateway,
      workspaceRuntimeOwnerRef,
    ],
  );
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
    revealEntry,
  };
}

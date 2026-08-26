import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { DebugGateway, DebugLaunchTarget } from "../domain/debug";
import {
  loadPersistedBreakpoints,
  savePersistedBreakpoints,
  type BreakpointStorage,
} from "../domain/debugBreakpointPersistence";
import { isDirty, type EditorDocument, type WorkspaceFileGateway } from "../domain/workspace";
import type { WorkspaceRuntimeOwner } from "../domain/workspaceRuntimeOwner";
import { normalizedWorkspaceRootKey, workspaceRootKeysEqual } from "../domain/workspaceRootKey";
import { detectJsTestRunnerContext } from "./jsTestRunnerDetection";
import { createDebugInlineValueContext } from "./debugInlineValueContext";
import { useConfiguredNodeLaunchStarter } from "./useConfiguredNodeLaunchStarter";
import { useDebugBreakpointAtCursor } from "./useDebugBreakpointAtCursor";
import { useDebugHoverEvaluation } from "./useDebugHoverEvaluation";
import { useDebugInlineVariableLoading } from "./useDebugInlineVariableLoading";
import { useDebugLocationOpener, useOpenDebugPanel } from "./useDebugLocationOpener";
import { useWorkbenchDebugSession } from "./useDebugSession";
import { useDebugRunToCursor } from "./useDebugRunToCursor";
import { useDebugWatchExpressions } from "./useDebugWatchExpressions";
import { useDebugWatchExpressionMutations } from "./useDebugWatchExpressionMutations";
import { useDebugConsole } from "./useDebugConsole";
import { useDebugConsoleSurfaceCommands } from "./useDebugConsoleSurfaceCommands";
import { useDebugConsoleCompletions } from "./useDebugConsoleCompletions";
import { useDebugCopyStackTrace } from "./useDebugCopyStackTrace";
import { useNodeDebugAttach } from "./useNodeDebugAttach";
import {
  useNodeDebugAttachProcessPicker,
  type NodeDebugAttachCandidateListGateway,
} from "./useNodeDebugAttachProcessPicker";
import {
  useNodeDebugConfigurationLauncher,
  type PreparedNodeDebugCompoundLaunch,
  type PreparedNodeDebugLaunch,
} from "./useNodeDebugConfigurationLauncher";
import { useNodeDebugCompoundComposition } from "./useNodeDebugCompoundComposition";
import { useNodeDebugPreLaunchComposition } from "./useNodeDebugPreLaunchComposition";
import type { NodeLaunchPickerCoordinator } from "./useNodeLaunchConfigurationPicker";
import type { VscodeProcessTasksState } from "./useVscodeProcessTasks";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import { isDebuggableNodeScriptPath, isDebuggablePhpScriptPath } from "./workbenchDebugCommands";
import type { TextClipboardGateway } from "../domain/textClipboard";
import {
  unavailableDebugCopyValueCommands,
  type DebugCopyValueSafeCommands,
} from "./debugCopyValueCommandBridge";
import type { DebugCopyEvaluatePathTarget } from "./useDebugCopyValueComposition";
import {
  unavailableDebugSetVariableCommands,
  type DebugSetVariableSafeCommands,
} from "./debugSetVariableCommandBridge";
import {
  unavailableDebugAddToWatchCommands,
  type DebugAddToWatchSafeCommands,
} from "./debugAddToWatchCommandBridge";
import { createDebugStartGate } from "./debugStartGate";
import type { DebugServerReadyExternalUrlOpener } from "../domain/debugServerReadyUrl";
import type { NodeDebugAttachCandidateStartPort } from "./debugSessionContracts";
import type { NativeNodeWatchDebugGateway } from "../domain/nativeNodeWatchDebugGateway";
import { nativeNodeWatchDebugStartDescriptor } from "./debugStartDescriptor";
import { createNativeNodeWatchCleanTargetLease } from "./nativeNodeWatchCleanTargetLease";

interface EditorPositionRef {
  readonly lineNumber: number;
  readonly column: number;
}

type OpenNavigationTarget = Parameters<typeof useDebugLocationOpener>[0];

interface WorkbenchDebugOrchestrationOptions {
  activeDocumentRef: RefObject<EditorDocument | null>;
  activeEditorPositionRef: RefObject<EditorPositionRef | null>;
  captureDocumentDebugAuthority(
    document: Pick<EditorDocument, "path">,
    requestedRoot: string,
    requestedWorkspaceId: string | null,
  ): WorkbenchDocumentDebugAuthority | null;
  currentWorkspaceRootRef: RefObject<string | null>;
  configurationPickerCoordinator?: NodeLaunchPickerCoordinator;
  debugBreakpointStorage?: BreakpointStorage;
  debugTextClipboard?: TextClipboardGateway | null;
  debugCopyValueCommands?: DebugCopyValueSafeCommands;
  debugAddToWatchCommands?: DebugAddToWatchSafeCommands;
  debugSetVariableCommands?: DebugSetVariableSafeCommands;
  debugCopyEvaluatePathOnce?(target: DebugCopyEvaluatePathTarget): Promise<boolean>;
  debugGateway: DebugGateway & Partial<NativeNodeWatchDebugGateway>;
  openDocuments?: readonly EditorDocument[];
  serverReadyExternalUrlOpener?: DebugServerReadyExternalUrlOpener;
  isActiveDocumentJsTest: boolean;
  isActiveDocumentPhpTest: boolean;
  isWorkspaceTrusted(): boolean;
  isWorkspaceCurrent(rootPath: string, workspaceId: string): boolean;
  nodeLaunchConfigurationVersion: number;
  nodeDebugAttachCandidateGateway?: NodeDebugAttachCandidateListGateway;
  nodeDebugAttachCandidateStart?: NodeDebugAttachCandidateStartPort;
  hasJavaScriptTypeScriptWorkspace(): boolean;
  openNavigationTarget: OpenNavigationTarget;
  readTestFileIfExists(path: string): Promise<string | null>;
  reportWarning(message: string): void;
  prompter: Pick<WorkbenchPrompter, "prompt">;
  setBottomPanelView(view: "debug"): void;
  setBottomPanelVisible(visible: boolean): void;
  workspaceFiles: Pick<
    WorkspaceFileGateway,
    "readDirectory" | "readTextFile" | "readTextFileBounded"
  >;
  workspaceRoot: string | null;
  workspaceId: string | null;
  vscodeProcessTasks: VscodeProcessTasksState;
}

const unavailableNodeDebugAttachCandidateGateway: NodeDebugAttachCandidateListGateway =
  Object.freeze({
    list: () => Promise.resolve(Object.freeze({ status: "unavailable" as const })),
  });

export interface WorkbenchDocumentDebugAuthority {
  isCurrent(): boolean;
}

interface StartDocumentDebugOptions {
  activeDocumentPath(): string | null;
  authority: WorkbenchDocumentDebugAuthority;
  document: Pick<EditorDocument, "path">;
  isJsTest: boolean;
  isPhpTest: boolean;
  openDebugPanel(): void;
  readTestFileIfExists(path: string): Promise<string | null>;
  reportWarning(message: string): void;
  requestedRoot: string;
  startDebugSessionAccepted(launch: DebugLaunchTarget): Promise<number | null>;
  stopExactDebugSession(sessionId: number): Promise<boolean>;
}

export function isNodeDebugConfigurationWorkspaceCurrent(
  currentRoot: string | null,
  currentOwner: WorkspaceRuntimeOwner | null,
  requestedRoot: string,
  requestedWorkspaceId: string,
): boolean {
  return (
    currentOwner?.ownerKey === requestedWorkspaceId &&
    workspaceRootKeysEqual(currentOwner.executionRoot, requestedRoot) &&
    workspaceRootKeysEqual(currentRoot, requestedRoot)
  );
}

export async function startWorkbenchDocumentDebug({
  activeDocumentPath,
  authority,
  document,
  isJsTest,
  isPhpTest,
  openDebugPanel,
  readTestFileIfExists,
  reportWarning,
  requestedRoot,
  startDebugSessionAccepted,
  stopExactDebugSession,
}: StartDocumentDebugOptions): Promise<void> {
  if (!authority.isCurrent()) {
    return;
  }

  if (isJsTest) {
    let runnerContext;
    try {
      runnerContext = await detectJsTestRunnerContext(
        requestedRoot,
        readTestFileIfExists,
        document.path,
      );
    } catch (error) {
      if (!authority.isCurrent()) {
        return;
      }
      throw error;
    }

    if (!authority.isCurrent() || activeDocumentPath() !== document.path) {
      return;
    }

    if (!runnerContext) {
      reportWarning("Debug: no vitest or jest setup detected in this workspace.");
      return;
    }

    await startAuthorizedDocumentDebug(
      authority,
      {
        kind: "js-test-file",
        runner: runnerContext.runner,
        filePath: document.path,
        packageRootPath: runnerContext.rootPath,
      },
      openDebugPanel,
      startDebugSessionAccepted,
      stopExactDebugSession,
    );
    if (!authority.isCurrent()) {
      return;
    }
    return;
  }

  if (isPhpTest) {
    await startAuthorizedDocumentDebug(
      authority,
      { kind: "php-test-file", filePath: document.path },
      openDebugPanel,
      startDebugSessionAccepted,
      stopExactDebugSession,
    );
    if (!authority.isCurrent()) {
      return;
    }
    return;
  }

  if (isDebuggablePhpScriptPath(document.path)) {
    await startAuthorizedDocumentDebug(
      authority,
      { kind: "php-script", scriptPath: document.path },
      openDebugPanel,
      startDebugSessionAccepted,
      stopExactDebugSession,
    );
    if (!authority.isCurrent()) {
      return;
    }
    return;
  }

  if (!isDebuggableNodeScriptPath(document.path)) return;

  await startAuthorizedDocumentDebug(
    authority,
    { kind: "node-script", scriptPath: document.path },
    openDebugPanel,
    startDebugSessionAccepted,
    stopExactDebugSession,
  );
  if (!authority.isCurrent()) {
    return;
  }
}

async function startAuthorizedDocumentDebug(
  authority: WorkbenchDocumentDebugAuthority,
  launch: DebugLaunchTarget,
  openDebugPanel: () => void,
  startDebugSessionAccepted: (launch: DebugLaunchTarget) => Promise<number | null>,
  stopExactDebugSession: (sessionId: number) => Promise<boolean>,
): Promise<void> {
  if (!authority.isCurrent()) {
    return;
  }

  openDebugPanel();
  if (!authority.isCurrent()) {
    return;
  }
  let sessionId: number | null;
  try {
    sessionId = await startDebugSessionAccepted(launch);
  } catch (error) {
    if (!authority.isCurrent()) {
      return;
    }
    throw error;
  }

  if (authority.isCurrent() || sessionId === null) {
    return;
  }

  try {
    await stopExactDebugSession(sessionId);
  } catch {
    return;
  }
}

function exactDebugDocumentIsClean(
  path: string,
  activeDocument: EditorDocument | null,
  openDocuments: readonly EditorDocument[],
): boolean {
  const matching = [
    ...(activeDocument?.path === path ? [activeDocument] : []),
    ...openDocuments.filter((document) => document.path === path),
  ];
  return matching.every((document) => !isDirty(document));
}

export function useWorkbenchDebugOrchestration({
  activeDocumentRef,
  activeEditorPositionRef,
  captureDocumentDebugAuthority,
  currentWorkspaceRootRef,
  configurationPickerCoordinator,
  debugBreakpointStorage,
  debugTextClipboard = null,
  debugCopyValueCommands = unavailableDebugCopyValueCommands,
  debugAddToWatchCommands = unavailableDebugAddToWatchCommands,
  debugSetVariableCommands = unavailableDebugSetVariableCommands,
  debugCopyEvaluatePathOnce,
  debugGateway,
  serverReadyExternalUrlOpener,
  hasJavaScriptTypeScriptWorkspace,
  isActiveDocumentJsTest,
  isActiveDocumentPhpTest,
  isWorkspaceTrusted,
  isWorkspaceCurrent,
  nodeDebugAttachCandidateGateway = unavailableNodeDebugAttachCandidateGateway,
  nodeDebugAttachCandidateStart,
  nodeLaunchConfigurationVersion,
  openNavigationTarget,
  prompter,
  readTestFileIfExists,
  reportWarning,
  setBottomPanelView,
  setBottomPanelVisible,
  workspaceFiles,
  workspaceId,
  workspaceRoot,
  vscodeProcessTasks,
  openDocuments = [],
}: WorkbenchDebugOrchestrationOptions) {
  const workspaceFilesRef = useRef(workspaceFiles);
  workspaceFilesRef.current = workspaceFiles;
  const hasBoundedNodeLaunchConfigurationRead = workspaceFiles.readTextFileBounded !== undefined;
  const debugDocumentsRef = useRef({ activeDocumentRef, openDocuments });
  debugDocumentsRef.current = { activeDocumentRef, openDocuments };
  const isExactDebugDocumentClean = useCallback(
    (path: string) =>
      exactDebugDocumentIsClean(
        path,
        debugDocumentsRef.current.activeDocumentRef.current,
        debugDocumentsRef.current.openDocuments,
      ),
    [],
  );
  const isWorkspaceTrustedRef = useRef(isWorkspaceTrusted);
  isWorkspaceTrustedRef.current = isWorkspaceTrusted;
  const isDebugWorkspaceTrusted = useCallback(() => isWorkspaceTrustedRef.current(), []);
  let debugInlineWorkspaceTrusted = false;
  try {
    debugInlineWorkspaceTrusted = isDebugWorkspaceTrusted();
  } catch {
    // Trust failures disable paused-value loading and presentation.
  }
  const {
    session: debugSession,
    startDebugCompoundAccepted: startDebugCompound,
    startNodeAttachCandidateAccepted,
  } = useWorkbenchDebugSession({
    gateway: debugGateway,
    isWorkspaceCurrent,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
    nodeDebugAttachCandidateStart,
    workspaceId,
    workspaceRoot,
  });
  const debugSessionRef = useRef(debugSession);
  debugSessionRef.current = debugSession;
  const [debugStartGate] = useState(createDebugStartGate);
  const debugCopyStackTrace = useDebugCopyStackTrace({
    clipboard: debugTextClipboard,
    getContext: () => {
      const state = debugSession.snapshot.state;
      const owner = debugSession.pauseOwner;
      return state.kind === "stopped" && owner && owner.sessionId === state.sessionId
        ? {
            frames: state.frames,
            framesTruncated: state.framesTruncated === true,
            pauseGeneration: owner.pauseGeneration,
            rootKey: owner.rootKey,
            sessionId: owner.sessionId,
            workspaceOwnerKey: owner.workspaceOwnerKey,
          }
        : null;
    },
  });
  const debugRunToCursor = useDebugRunToCursor({
    activeDocumentRef,
    activeEditorPositionRef,
    canRunToLocation: debugSession.canRunToLocation,
    currentWorkspaceRootRef,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
    reportWarning,
    runToLocation: debugSession.runToLocation,
    workspaceId,
  });
  const { breakpoints, restoreBreakpoints, snapshot, stepDebug, toggleBreakpoint } = debugSession;
  const debugHover = useDebugHoverEvaluation({
    copyEvaluatePathOnce: debugCopyEvaluatePathOnce,
    debugAdapterKind: debugSession.debugAdapterKind,
    evaluateWatch: debugSession.evaluateWatch,
    inspectionOwner: debugSession.inspectionOwner,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
  });
  useDebugInlineVariableLoading({
    debugAdapterKind: debugSession.debugAdapterKind,
    inspectionOwner: debugSession.inspectionOwner,
    isWorkspaceTrusted: debugInlineWorkspaceTrusted,
    loadVariablePage: debugSession.loadVariablePage,
    scopes: debugSession.scopes,
    selectedFrameId: debugSession.selectedFrameId,
    selectFrame: debugSession.selectFrame,
    variablePages: debugSession.variablePages,
  });
  const debugWatches = useDebugWatchExpressions({
    debugAdapterKind: debugSession.debugAdapterKind,
    evaluateWatch: debugSession.evaluateWatch,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
    inspectionOwner: debugSession.inspectionOwner,
    selectedFrameId: debugSession.selectedFrameId,
    snapshot,
    workspaceRoot,
    refreshVersion: debugSession.debugInspectionRevision,
  });
  const debugWatchExpressionMutations = useDebugWatchExpressionMutations({
    definitions: debugWatches.definitions,
    evaluations: debugWatches.evaluations,
    setExpression: debugSession.setWatchExpression,
  });
  const debugSessionState = snapshot.state;
  const debugConsole = useDebugConsole({
    evaluate: debugSession.evaluate,
    output: debugSession.output,
    owner: debugSession.inspectionOwner
      ? {
          sessionId: debugSession.inspectionOwner.sessionId,
          pauseGeneration: debugSession.inspectionOwner.pauseGeneration,
        }
      : null,
    resultOwner:
      debugSession.inspectionOwner &&
      debugSession.pauseOwner &&
      debugSession.inspectionOwner.rootKey === debugSession.pauseOwner.rootKey &&
      debugSession.inspectionOwner.sessionId === debugSession.pauseOwner.sessionId &&
      debugSession.inspectionOwner.pauseGeneration === debugSession.pauseOwner.pauseGeneration
        ? {
            ...debugSession.inspectionOwner,
            workspaceOwnerKey: debugSession.pauseOwner.workspaceOwnerKey,
          }
        : null,
    sessionId: debugSessionState.kind === "inactive" ? null : debugSessionState.sessionId,
    workspaceRoot,
  });
  const debugConsoleCompletions = useDebugConsoleCompletions({
    complete: debugSession.completeDebugConsole,
    debugAdapterKind: debugSession.debugAdapterKind,
    inspectionOwner: debugSession.inspectionOwner,
    workspaceOwnerKey: workspaceId,
  });
  const debugInlineValueContext = useMemo(
    () =>
      createDebugInlineValueContext({
        debugAdapterKind: debugSession.debugAdapterKind,
        inspectionOwner: debugSession.inspectionOwner,
        isWorkspaceTrusted: debugInlineWorkspaceTrusted,
        scopes: debugSession.scopes,
        snapshot,
        variablePages: debugSession.variablePages,
      }),
    [
      debugInlineWorkspaceTrusted,
      debugSession.debugAdapterKind,
      debugSession.inspectionOwner,
      debugSession.scopes,
      debugSession.variablePages,
      snapshot,
    ],
  );
  const debugStoppedFrame =
    debugSessionState.kind === "stopped"
      ? (debugSessionState.frames.find(
          ({ frameId }) => frameId === debugSession.inspectionOwner?.frameId,
        ) ?? debugSessionState.topFrame)
      : null;
  const debugStoppedFilePath = debugStoppedFrame?.filePath ?? null;
  const debugStoppedLineNumber = debugStoppedFrame?.lineNumber ?? null;
  const debugStoppedLocation = useMemo(() => {
    if (debugStoppedFilePath === null || debugStoppedLineNumber === null) return null;
    return { filePath: debugStoppedFilePath, lineNumber: debugStoppedLineNumber };
  }, [debugStoppedFilePath, debugStoppedLineNumber]);

  const openDebugPanel = useOpenDebugPanel(setBottomPanelView, setBottomPanelVisible);
  const debugConsoleSurface = useDebugConsoleSurfaceCommands({
    console: debugConsole,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
    openDebugPanel,
    workspaceOwnerKey: workspaceId,
  });
  const nodeLaunchConfigurationReads = useMemo(
    () => ({
      readDirectory: (path: string) => workspaceFilesRef.current.readDirectory(path),
      readFile: (path: string) => workspaceFilesRef.current.readTextFile(path),
      ...(hasBoundedNodeLaunchConfigurationRead
        ? {
            readFileBounded: (path: string, maxBytes: number) =>
              workspaceFilesRef.current.readTextFileBounded!(path, maxBytes),
          }
        : {}),
    }),
    [hasBoundedNodeLaunchConfigurationRead],
  );
  const configuredDocumentDebugAuthorityRef = useRef<WorkbenchDocumentDebugAuthority | null>(null);
  const isConfiguredDocumentDebugWorkspaceCurrent = useCallback(
    (rootPath: string, ownerKey: string) =>
      isWorkspaceCurrent(rootPath, ownerKey) &&
      (configuredDocumentDebugAuthorityRef.current?.isCurrent() ?? true),
    [isWorkspaceCurrent],
  );
  const nodeDebugTaskComposition = useNodeDebugPreLaunchComposition({
    debugGateway,
    disconnectExactDebugSession: debugSession.disconnectExactDebugSession,
    isWorkspaceCurrent: isConfiguredDocumentDebugWorkspaceCurrent,
    launchConfigurationVersion: nodeLaunchConfigurationVersion,
    serverReadyExternalUrlOpener:
      serverReadyExternalUrlOpener ?? unavailableServerReadyExternalUrlOpener,
    processTasks: vscodeProcessTasks,
    reportWarning,
    rootPath: workspaceRoot,
    startDebug: debugSession.startDebugSessionAccepted,
    ...(debugGateway.startNativeNodeWatch
      ? {
          startNativeNodeWatch: async (prepared: PreparedNodeDebugLaunch) => {
            const nativeWatch = prepared.nativeWatch;
            if (!nativeWatch) return null;
            const documents = debugDocumentsRef.current;
            const cleanTarget = createNativeNodeWatchCleanTargetLease(
              nativeWatch.scriptPath,
              documents.activeDocumentRef.current,
              documents.openDocuments,
            );
            if (!cleanTarget) return null;
            const justMyCode =
              "justMyCode" in prepared.launch ? prepared.launch.justMyCode : undefined;
            const sourceMaps =
              "sourceMaps" in prepared.launch ? prepared.launch.sourceMaps : undefined;
            const smartStep =
              "smartStep" in prepared.launch ? prepared.launch.smartStep : undefined;
            return debugSessionRef.current.startDebugDescriptorSessionAccepted(
              nativeNodeWatchDebugStartDescriptor(
                debugGateway as NativeNodeWatchDebugGateway,
                {
                  scriptPath: nativeWatch.scriptPath,
                  watch: true,
                  ...(nativeWatch.preserveOutput ? { preserveOutput: true } : {}),
                  ...(justMyCode ? { justMyCode } : {}),
                  ...(sourceMaps !== undefined ? { sourceMaps } : {}),
                  ...(smartStep !== undefined ? { smartStep } : {}),
                },
                () => {
                  const current = debugDocumentsRef.current;
                  return cleanTarget.isCurrent(
                    current.activeDocumentRef.current,
                    current.openDocuments,
                  );
                },
              ),
            );
          },
        }
      : {}),
    stopExactDebugSession: debugSession.stopExactDebugSession,
    workspaceId,
    workspaceTrusted: debugInlineWorkspaceTrusted,
  });
  const nodeDebugTaskCompositionRef = useRef(nodeDebugTaskComposition);
  nodeDebugTaskCompositionRef.current = nodeDebugTaskComposition;
  const stopAcceptedDocumentDebugSession = useCallback(
    async (sessionId: number) => {
      if (workspaceRoot) {
        nodeDebugTaskCompositionRef.current.cancelServerReadyActionForSession(
          workspaceRoot,
          sessionId,
        );
      }
      return debugSessionRef.current.stopExactDebugSession(sessionId);
    },
    [workspaceRoot],
  );
  const nodeDebugCompoundComposition = useNodeDebugCompoundComposition({
    isWorkspaceCurrent,
    launchConfigurationVersion: nodeLaunchConfigurationVersion,
    processTasks: vscodeProcessTasks,
    reportWarning,
    rootPath: workspaceRoot,
    startCompound: startDebugCompound,
    stopAcceptedCompound: () => debugSessionRef.current.stopDebug(),
    workspaceId,
    workspaceTrusted: debugInlineWorkspaceTrusted,
  });
  const nodeDebugCompoundCompositionRef = useRef(nodeDebugCompoundComposition);
  nodeDebugCompoundCompositionRef.current = nodeDebugCompoundComposition;
  const postTaskBlocksStart = useCallback(
    () =>
      nodeDebugTaskCompositionRef.current.isPostTaskActive() ||
      nodeDebugCompoundCompositionRef.current.isBusy() ||
      debugSessionRef.current.debugCompoundActive ||
      debugSessionRef.current.isDebugStartBlocked(),
    [],
  );
  const isDebugStartBlocked = useCallback(
    () => debugStartGate.occupied() || postTaskBlocksStart(),
    [debugStartGate, postTaskBlocksStart],
  );
  const startPreparedNodeDebug = useCallback(
    async (prepared: PreparedNodeDebugLaunch) => {
      const result = await debugStartGate.run(postTaskBlocksStart, () =>
        nodeDebugTaskCompositionRef.current.start(prepared),
      );
      return result.kind === "completed" && result.value;
    },
    [debugStartGate, postTaskBlocksStart],
  );
  const startPreparedNodeDebugCompound = useCallback(
    async (prepared: PreparedNodeDebugCompoundLaunch) => {
      const result = await debugStartGate.run(postTaskBlocksStart, () =>
        nodeDebugCompoundCompositionRef.current.start(prepared),
      );
      return result.kind === "completed" && result.value;
    },
    [debugStartGate, postTaskBlocksStart],
  );
  const startDebugAccepted = useCallback(
    async (launch: DebugLaunchTarget) => {
      const result = await debugStartGate.run(postTaskBlocksStart, () =>
        debugSessionRef.current.startDebugAccepted(launch),
      );
      return result.kind === "completed" && result.value;
    },
    [debugStartGate, postTaskBlocksStart],
  );
  const startDebugSessionAccepted = useCallback(
    async (launch: DebugLaunchTarget) => {
      const result = await debugStartGate.run(postTaskBlocksStart, () =>
        debugSessionRef.current.startDebugSessionAccepted(launch),
      );
      return result.kind === "completed" ? result.value : null;
    },
    [debugStartGate, postTaskBlocksStart],
  );
  const startDebug = useCallback(
    async (launch: DebugLaunchTarget) => {
      await debugStartGate.run(postTaskBlocksStart, () =>
        debugSessionRef.current.startDebug(launch),
      );
    },
    [debugStartGate, postTaskBlocksStart],
  );
  const configurationLauncher = useNodeDebugConfigurationLauncher({
    coordinator: configurationPickerCoordinator,
    configurationVersion: nodeLaunchConfigurationVersion,
    debugStartBlocked: isDebugStartBlocked(),
    isDebugStartBlocked,
    isDocumentClean: isExactDebugDocumentClean,
    isWorkspaceCurrent,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
    openDebugPanel,
    rootPath: workspaceRoot,
    ...(debugGateway.startCompound ? { startCompoundDebug: startPreparedNodeDebugCompound } : {}),
    startDebug: startPreparedNodeDebug,
    workspaceId,
    workspaceReads: nodeLaunchConfigurationReads,
    workspaceTrusted: debugInlineWorkspaceTrusted,
  });
  const attachGuardsRef = useRef({
    hasJavaScriptTypeScriptWorkspace,
    isWorkspaceTrusted,
  });
  attachGuardsRef.current = { hasJavaScriptTypeScriptWorkspace, isWorkspaceTrusted };
  const getAttachWorkspaceRoot = useCallback(
    () => currentWorkspaceRootRef.current,
    [currentWorkspaceRootRef],
  );
  const hasAttachWorkspace = useCallback(
    () => attachGuardsRef.current.hasJavaScriptTypeScriptWorkspace(),
    [],
  );
  const isAttachWorkspaceTrusted = useCallback(
    () => attachGuardsRef.current.isWorkspaceTrusted(),
    [],
  );
  const attachNodeDebugByPort = useNodeDebugAttach({
    getWorkspaceRoot: getAttachWorkspaceRoot,
    hasJavaScriptTypeScriptWorkspace: hasAttachWorkspace,
    isDebugSessionBusy: isDebugStartBlocked,
    isWorkspaceTrusted: isAttachWorkspaceTrusted,
    openDebugPanel,
    prompter,
    reportWarning,
    startDebug,
  });
  const startListedNodeAttach = useCallback(
    async (requestedRoot: string, candidateLeaseId: string) => {
      if (!workspaceRootKeysEqual(requestedRoot, currentWorkspaceRootRef.current)) {
        return { kind: "error" as const, message: "Node attach could not be started." };
      }
      const result = await debugStartGate.run(postTaskBlocksStart, () =>
        startNodeAttachCandidateAccepted(candidateLeaseId),
      );
      const sessionId = result.kind === "completed" ? result.value : null;
      if (sessionId === null) {
        return { kind: "error" as const, message: "Node attach could not be started." };
      }
      openDebugPanel();
      return { kind: "ok" as const, sessionId };
    },
    [
      currentWorkspaceRootRef,
      debugStartGate,
      openDebugPanel,
      postTaskBlocksStart,
      startNodeAttachCandidateAccepted,
    ],
  );
  let attachPickerRoot: string | null = null;
  try {
    if (workspaceRoot && debugInlineWorkspaceTrusted && hasJavaScriptTypeScriptWorkspace()) {
      attachPickerRoot = workspaceRoot;
    }
  } catch {
    // Workspace capability failures close and invalidate the picker.
  }
  const nodeDebugAttachProcessPicker = useNodeDebugAttachProcessPicker({
    enabled: attachPickerRoot !== null && !isDebugStartBlocked(),
    listGateway: nodeDebugAttachCandidateGateway,
    onManualAttach: attachNodeDebugByPort,
    rootPath: attachPickerRoot,
    startCandidate: startListedNodeAttach,
  });
  const openNodeDebugAttachProcessPicker = nodeDebugAttachProcessPicker.open;
  const attachNodeDebug = useCallback(() => {
    if (!attachPickerRoot || isDebugStartBlocked()) return;
    openNodeDebugAttachProcessPicker();
  }, [attachPickerRoot, isDebugStartBlocked, openNodeDebugAttachProcessPicker]);
  const openDebugLocation = useDebugLocationOpener(openNavigationTarget);
  const toggleDebugBreakpointAtCursor = useDebugBreakpointAtCursor(
    activeDocumentRef,
    activeEditorPositionRef,
    toggleBreakpoint,
  );
  const startNodeLaunch = useConfiguredNodeLaunchStarter({
    getActiveDocumentPath: () => activeDocumentRef.current?.path ?? null,
    isDebugStartBlocked,
    isWorkspaceCurrent: isConfiguredDocumentDebugWorkspaceCurrent,
    isWorkspaceTrusted: isDebugWorkspaceTrusted,
    openDebugPanel,
    reportWarning,
    startDebug: startPreparedNodeDebug,
    workspaceFiles,
  });
  const startNodeLaunchWithAuthority = useCallback(
    async (
      requestedRoot: string,
      documentPath: string,
      requestedWorkspaceId: string | null,
      authority: WorkbenchDocumentDebugAuthority,
    ) => {
      if (configuredDocumentDebugAuthorityRef.current) {
        return true;
      }

      configuredDocumentDebugAuthorityRef.current = authority;
      try {
        const started = await startNodeLaunch(requestedRoot, documentPath, requestedWorkspaceId);
        if (!authority.isCurrent()) return true;
        return started;
      } catch (error) {
        if (!authority.isCurrent()) return true;
        throw error;
      } finally {
        if (configuredDocumentDebugAuthorityRef.current === authority) {
          configuredDocumentDebugAuthorityRef.current = null;
        }
      }
    },
    [startNodeLaunch],
  );

  const startOrContinueDebug = useCallback(async () => {
    const state = snapshot.state;
    if (state.kind === "stopped") {
      await stepDebug("continue");
      return;
    }
    if (state.kind === "starting" || state.kind === "running") return;

    const requestedRoot = currentWorkspaceRootRef.current;
    const requestedWorkspaceId = workspaceId;
    const document = activeDocumentRef.current;
    if (!requestedRoot || !document) return;
    const authority = captureDocumentDebugAuthority(document, requestedRoot, requestedWorkspaceId);
    if (!authority?.isCurrent()) return;
    const nodeLaunchStarted = await startNodeLaunchWithAuthority(
      requestedRoot,
      document.path,
      requestedWorkspaceId,
      authority,
    );
    if (!authority.isCurrent()) return;
    if (nodeLaunchStarted) return;

    await startWorkbenchDocumentDebug({
      activeDocumentPath: () => activeDocumentRef.current?.path ?? null,
      authority,
      document,
      isJsTest: isActiveDocumentJsTest,
      isPhpTest: isActiveDocumentPhpTest,
      openDebugPanel,
      readTestFileIfExists,
      reportWarning,
      requestedRoot,
      startDebugSessionAccepted,
      stopExactDebugSession: stopAcceptedDocumentDebugSession,
    });
    if (!authority.isCurrent()) return;
  }, [
    activeDocumentRef,
    captureDocumentDebugAuthority,
    currentWorkspaceRootRef,
    isActiveDocumentJsTest,
    isActiveDocumentPhpTest,
    openDebugPanel,
    readTestFileIfExists,
    reportWarning,
    snapshot,
    startDebugSessionAccepted,
    startNodeLaunchWithAuthority,
    stepDebug,
    stopAcceptedDocumentDebugSession,
    workspaceId,
  ]);

  const startPhpListenDebug = useCallback(async () => {
    openDebugPanel();
    await startDebug({ kind: "php-listen" });
  }, [openDebugPanel, startDebug]);

  const restoredBreakpointRootsRef = useRef(new Set<string>());
  useEffect(() => {
    if (!workspaceRoot) return;
    const storage = debugBreakpointStorage ?? window.localStorage;
    const rootKey = normalizedWorkspaceRootKey(workspaceRoot);
    if (!restoredBreakpointRootsRef.current.has(rootKey)) {
      restoredBreakpointRootsRef.current.add(rootKey);
      const persisted = loadPersistedBreakpoints(storage, workspaceRoot);
      if (persisted.length > 0) void restoreBreakpoints(persisted);
      return;
    }
    savePersistedBreakpoints(storage, workspaceRoot, breakpoints);
  }, [breakpoints, debugBreakpointStorage, restoreBreakpoints, workspaceRoot]);

  const canRestartDebug = useCallback(() => {
    if (
      debugStartGate.occupied() ||
      nodeDebugCompoundComposition.isBusy() ||
      debugSession.debugCompoundActive ||
      nodeDebugTaskComposition.postRestartPending
    ) {
      return false;
    }
    return nodeDebugTaskComposition.hasPostTaskRestart()
      ? nodeDebugTaskComposition.canRestartPostTask() && debugSession.canRestartDebug()
      : debugSession.canRestartDebug();
  }, [debugSession, debugStartGate, nodeDebugCompoundComposition, nodeDebugTaskComposition]);
  const restartDebug = useCallback(async () => {
    if (!canRestartDebug()) return;
    if (nodeDebugTaskComposition.hasPostTaskRestart()) {
      await nodeDebugTaskComposition.restartPostTask();
      return;
    }
    await debugSession.restartDebug();
  }, [canRestartDebug, debugSession, nodeDebugTaskComposition]);
  const stopDebug = useCallback(async () => {
    nodeDebugTaskCompositionRef.current.cancelServerReadyAction();
    await debugSession.stopDebug();
  }, [debugSession]);
  const disconnectDebug = useCallback(async () => {
    nodeDebugTaskCompositionRef.current.cancelServerReadyAction();
    await debugSession.disconnectDebug();
  }, [debugSession]);
  const stopExactDebugSession = useCallback(
    async (sessionId: number) => {
      if (workspaceRoot) {
        nodeDebugTaskCompositionRef.current.cancelServerReadyActionForSession(
          workspaceRoot,
          sessionId,
        );
      }
      return debugSession.stopExactDebugSession(sessionId);
    },
    [debugSession, workspaceRoot],
  );
  const disconnectExactDebugSession = useCallback(
    async (sessionId: number) => {
      if (workspaceRoot) {
        nodeDebugTaskCompositionRef.current.cancelServerReadyActionForSession(
          workspaceRoot,
          sessionId,
        );
      }
      return debugSession.disconnectExactDebugSession(sessionId);
    },
    [debugSession, workspaceRoot],
  );
  return {
    attachNodeDebug,
    nodeDebugAttachProcessPicker,
    debugSession: {
      ...debugSession,
      canRestartDebug,
      debugRestartPending:
        nodeDebugTaskComposition.postRestartPending || debugSession.debugRestartPending,
      ...debugRunToCursor,
      console: debugConsole,
      consoleCompletions: debugConsoleCompletions,
      consoleSurface: debugConsoleSurface,
      configurationLauncher,
      debugHover,
      inlineValueContext: debugInlineValueContext,
      copyValue: debugCopyValueCommands,
      addToWatch: debugAddToWatchCommands,
      setValue: debugSetVariableCommands,
      watches: {
        ...debugWatches,
        expressionMutations: debugWatchExpressionMutations,
      },
      isDebugStartBlocked,
      restartDebug,
      stopDebug,
      stopExactDebugSession,
      disconnectDebug,
      disconnectExactDebugSession,
      startDebug,
      startDebugAccepted,
      startDebugSessionAccepted,
    },
    debugCopyStackTrace,
    debugStoppedLocation,
    openDebugLocation,
    openDebugPanel,
    startOrContinueDebug,
    startPhpListenDebug,
    toggleDebugBreakpointAtCursor,
  };
}

const unavailableServerReadyExternalUrlOpener: DebugServerReadyExternalUrlOpener = Object.freeze({
  openExternal: async () => {
    throw new Error("Server ready URL opener is unavailable.");
  },
});

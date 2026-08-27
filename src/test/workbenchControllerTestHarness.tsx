import { act, Profiler, StrictMode, type ProfilerOnRenderCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, vi } from "vitest";
import type { DiagnosticsFlushScheduler } from "../domain/diagnosticsCoalescer";
import { emptyGitStatus, type GitGateway } from "../domain/git";
import type { IndexProgressGateway, MetadataScanCompletionEvent } from "../domain/indexProgress";
import type { SmartModeGateway } from "../domain/intelligence";
import type { LanguageServerGateway, LanguageServerPlan } from "../domain/languageServer";
import type { LanguageServerDiagnosticsGateway } from "../domain/languageServerDiagnostics";
import {
  sessionBoundLanguageServerDocumentSyncGateway,
  type LanguageServerDocumentSyncGateway,
  type SessionBoundLanguageServerDocumentSyncGateway,
} from "../domain/languageServerDocumentSync";
import type {
  JavaScriptTypeScriptLanguageServerFeaturesGateway,
  LanguageServerFeaturesGateway,
} from "../domain/languageServerFeatures";
import type {
  LanguageServerRuntimeGateway,
  LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { LocalHistoryGateway, LocalHistoryVersion } from "../domain/localHistory";
import type { PhpFileOutlineGateway } from "../domain/phpFileOutline";
import type { PhpTreeGateway } from "../domain/phpTree";
import type { ProjectSymbolSearchResult } from "../domain/projectSymbols";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  normalizeWorkspaceSession,
  type SettingsGateway,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import type {
  FileEntry,
  FileSearchResult,
  ReplaceInPathResult,
  TextSearchOptions,
  TextSearchResult,
  WorkspaceDescriptor,
  WorkspaceOwnerFileGateway,
} from "../domain/workspace";
import {
  useWorkbenchController,
  type WorkbenchControllerOptions,
  type WorkbenchWorkspaceGateways,
} from "../application/useWorkbenchController";
import type { WorkbenchPrompter } from "../application/workbenchPrompter";
import { WorkbenchHarness } from "./workbenchControllerHarnessView";
import { createStoppedTerminalGateway } from "./stoppedTerminalGateway";
import type { DirtyTextSearchComputationGateway } from "../application/dirtyTextSearchComputation";
import { computeDirtyTextSearch } from "../application/dirtyTextSearchMatcher";
import { EditorCursorStore } from "../application/editorCursorStore";
import type { EditorActiveLiveDocumentSaveAdmissionPort } from "../application/editorActiveLiveDocumentSaveCoordinator";

export type WorkbenchController = ReturnType<typeof useWorkbenchController>;

export interface ControllerDependencies {
  controllerOptions: WorkbenchControllerOptions;
  documentSyncGateway: SessionBoundLanguageServerDocumentSyncGateway;
  gitGateway: GitGateway;
  localHistoryGateway: LocalHistoryGateway;
  indexProgressGateway: IndexProgressGateway;
  languageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  languageServerDocumentSyncGateway: SessionBoundLanguageServerDocumentSyncGateway;
  languageServerFeaturesGateway: LanguageServerFeaturesGateway;
  languageServerGateway: LanguageServerGateway;
  languageServerRuntimeGateway: LanguageServerRuntimeGateway;
  javaScriptTypeScriptLanguageServerDiagnosticsGateway: LanguageServerDiagnosticsGateway;
  javaScriptTypeScriptLanguageServerDocumentSyncGateway: LanguageServerDocumentSyncGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway: JavaScriptTypeScriptLanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerRuntimeGateway: LanguageServerRuntimeGateway;
  phpFileOutlineGateway: PhpFileOutlineGateway;
  phpTreeGateway: PhpTreeGateway;
  prompter: WorkbenchPrompter;
  settingsGateway: SettingsGateway;
  smartModeGateway: SmartModeGateway;
  terminalGateway: TerminalGateway;
  workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway;
  workspaceGateways: WorkbenchWorkspaceGateways;
  workspaceTrustGateway: WorkspaceTrustGateway;
}

export type WorkbenchCommitPhase = Parameters<ProfilerOnRenderCallback>[1];

export interface RenderControllerOptions {
  activeLiveDocumentSaveCoordinator?: EditorActiveLiveDocumentSaveAdmissionPort;
  agentRootLeaseGateway?: WorkbenchControllerOptions["agentRootLeaseGateway"];
  agentProviderGateway?: WorkbenchControllerOptions["agentProviderGateway"];
  agentTaskGateway?: WorkbenchControllerOptions["agentTaskGateway"];
  gitWorktreeGateway?: WorkbenchControllerOptions["gitWorktreeGateway"];
  appSettings?: ReturnType<typeof defaultAppSettings>;
  debugBreakpointStorage?: WorkbenchControllerOptions["debugBreakpointStorage"];
  debugGateway?: WorkbenchControllerOptions["debugGateway"];
  dirtyTextSearchGateway?: DirtyTextSearchComputationGateway;
  editorGroupFocusRunner?: WorkbenchControllerOptions["editorGroupFocusRunner"];
  gitGateway?: GitGateway;
  localHistoryGateway?: LocalHistoryGateway;
  onWorkbenchCommit?: (phase: WorkbenchCommitPhase) => void;
  onWorkbenchRender?: (workbench: WorkbenchController) => void;
  markdownPreviewRenderer?: WorkbenchControllerOptions["markdownPreviewRenderer"];
  indexProgressGateway?: IndexProgressGateway;
  javaScriptTypeScriptInitialRuntimeStatus?: LanguageServerRuntimeStatus;
  javaScriptTypeScriptLanguageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
  javaScriptTypeScriptLanguageServerDocumentSyncGateway?: LanguageServerDocumentSyncGateway;
  javaScriptTypeScriptLanguageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  javaScriptTypeScriptLanguageServerPlan?: LanguageServerPlan;
  javaScriptTypeScriptLanguageServerRuntimeGateway?: LanguageServerRuntimeGateway;
  javaScriptTypeScriptRuntimeStatus?: LanguageServerRuntimeStatus;
  languageServerGateway?: LanguageServerGateway;
  languageServerPlan?: LanguageServerPlan;
  languageServerDiagnosticsGateway?: LanguageServerDiagnosticsGateway;
  languageServerDocumentSyncGateway?: SessionBoundLanguageServerDocumentSyncGateway;
  languageServerFeaturesGateway?: LanguageServerFeaturesGateway;
  languageServerRuntimeGateway?: LanguageServerRuntimeGateway;
  phpToolGateway?: WorkbenchWorkspaceGateways["phpTools"];
  prettierFormattingGateway?: WorkbenchControllerOptions["prettierFormattingGateway"];
  projectSymbols?: ProjectSymbolSearchResult[];
  prompter?: WorkbenchPrompter;
  readDirectory?: (path: string) => Promise<FileEntry[]>;
  readTextFile?: (path: string) => Promise<string>;
  renderQuickOpenSurfaces?: boolean;
  runtimeStatus?: LanguageServerRuntimeStatus;
  searchFiles?: (root: string, query: string, limit: number) => Promise<FileSearchResult[]>;
  searchText?: (root: string, query: string, limit: number) => Promise<TextSearchResult[]>;
  replaceInPath?: (
    root: string,
    query: string,
    replacement: string,
    options?: TextSearchOptions,
    scopePath?: string,
  ) => Promise<ReplaceInPathResult>;
  settingsGateway?: SettingsGateway;
  smartModeGateway?: SmartModeGateway;
  strictMode?: boolean;
  workspaceDetectionGateway?: WorkbenchWorkspaceGateways["detection"];
  workspaceDescriptor?: WorkspaceDescriptor;
  workspaceFileChangeGateway?: WorkbenchWorkspaceGateways["fileChanges"];
  workspaceIdentityGateway?: WorkbenchWorkspaceGateways["identity"];
  workspaceFiles?: Partial<WorkbenchWorkspaceGateways["files"] & WorkspaceOwnerFileGateway>;
  workspaceOwnerFiles?: Partial<NonNullable<WorkbenchWorkspaceGateways["ownerFiles"]>>;
  workspaceRuntimeLifecycleGateway?: WorkspaceRuntimeLifecycleGateway;
  workspaceSettings?: Omit<ReturnType<typeof defaultWorkspaceSettings>, "session"> & {
    session: unknown;
  };
  workspaceTrustGateway?: WorkspaceTrustGateway;
  bridgeRegisteredOwnerFiles?: boolean;
  useRegisteredWorkspaceIdentity?: boolean;
}

export function setupWorkbenchControllerTestHarness() {
  let host: HTMLDivElement | null = null;
  let root: Root | null = null;
  const diagnosticsFlushScheduler = createDiagnosticsFlushScheduler();

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    vi.useRealTimers();
    await flushAsyncTurns();
    const mountedRoot = root;
    const mountedHost = host;
    root = null;
    host = null;

    if (mountedRoot) {
      await act(async () => {
        mountedRoot.unmount();
        await Promise.resolve();
      });
    }

    mountedHost?.remove();
  });

  function getHost() {
    if (!host) {
      throw new Error("Workbench host was not mounted.");
    }

    return host;
  }

  function getRoot() {
    if (!root) {
      throw new Error("Workbench root was not mounted.");
    }

    return root;
  }

  function renderController({
    activeLiveDocumentSaveCoordinator = fallbackLiveSaveCoordinator(),
    agentRootLeaseGateway = fakeAgentRootLeaseGateway(),
    agentProviderGateway = fakeAgentProviderGateway(),
    agentTaskGateway,
    gitWorktreeGateway,
    appSettings = defaultAppSettings(),
    debugBreakpointStorage,
    debugGateway,
    dirtyTextSearchGateway,
    editorGroupFocusRunner,
    gitGateway,
    localHistoryGateway,
    onWorkbenchCommit,
    onWorkbenchRender,
    markdownPreviewRenderer,
    javaScriptTypeScriptInitialRuntimeStatus = { kind: "stopped" as const },
    indexProgressGateway,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptRuntimeStatus = { kind: "stopped" as const },
    languageServerGateway,
    languageServerPlan,
    languageServerDiagnosticsGateway,
    languageServerDocumentSyncGateway,
    languageServerFeaturesGateway,
    languageServerRuntimeGateway,
    phpToolGateway,
    prettierFormattingGateway,
    projectSymbols = [],
    prompter,
    readDirectory,
    readTextFile = vi.fn(async (path: string) => `<?php\n// ${path}\n`),
    renderQuickOpenSurfaces = false,
    runtimeStatus = { kind: "stopped" as const },
    searchFiles = vi.fn(async () => []),
    searchText,
    replaceInPath,
    settingsGateway,
    smartModeGateway,
    strictMode = false,
    workspaceDetectionGateway,
    workspaceDescriptor,
    workspaceFileChangeGateway,
    workspaceIdentityGateway,
    workspaceFiles,
    workspaceOwnerFiles,
    workspaceRuntimeLifecycleGateway,
    workspaceSettings = defaultWorkspaceSettings(),
    workspaceTrustGateway,
    bridgeRegisteredOwnerFiles = false,
    useRegisteredWorkspaceIdentity = false,
  }: RenderControllerOptions = {}) {
    const mountedRoot = root;
    if (!mountedRoot) {
      throw new Error("Workbench root was not mounted.");
    }

    let workbench: WorkbenchController | null = null;
    const dependencies = createControllerDependencies(
      {
        appSettings,
        dirtyTextSearchGateway,
        gitGateway,
        localHistoryGateway,
        indexProgressGateway,
        javaScriptTypeScriptInitialRuntimeStatus,
        javaScriptTypeScriptLanguageServerDiagnosticsGateway,
        javaScriptTypeScriptLanguageServerDocumentSyncGateway,
        javaScriptTypeScriptLanguageServerFeaturesGateway,
        javaScriptTypeScriptLanguageServerPlan,
        javaScriptTypeScriptLanguageServerRuntimeGateway,
        javaScriptTypeScriptRuntimeStatus,
        languageServerGateway,
        languageServerPlan,
        languageServerDiagnosticsGateway,
        languageServerDocumentSyncGateway,
        languageServerFeaturesGateway,
        languageServerRuntimeGateway,
        phpToolGateway,
        projectSymbols,
        prompter,
        readDirectory,
        readTextFile,
        runtimeStatus,
        searchFiles,
        searchText,
        replaceInPath,
        settingsGateway,
        smartModeGateway,
        workspaceDetectionGateway,
        workspaceDescriptor,
        workspaceFileChangeGateway,
        workspaceIdentityGateway,
        workspaceFiles,
        workspaceOwnerFiles,
        workspaceRuntimeLifecycleGateway,
        workspaceSettings: {
          ...workspaceSettings,
          session: normalizeWorkspaceSession(workspaceSettings.session),
        },
        workspaceTrustGateway,
        bridgeRegisteredOwnerFiles,
        useRegisteredWorkspaceIdentity,
      },
      diagnosticsFlushScheduler,
    );
    dependencies.controllerOptions.markdownPreviewRenderer = markdownPreviewRenderer;
    dependencies.controllerOptions.activeLiveDocumentSaveCoordinator =
      activeLiveDocumentSaveCoordinator;
    dependencies.controllerOptions.editorGroupFocusRunner = editorGroupFocusRunner;
    dependencies.controllerOptions.prettierFormattingGateway = prettierFormattingGateway;
    dependencies.controllerOptions.debugBreakpointStorage = debugBreakpointStorage;
    dependencies.controllerOptions.debugGateway = debugGateway;
    dependencies.controllerOptions.agentRootLeaseGateway = agentRootLeaseGateway;
    dependencies.controllerOptions.agentProviderGateway = agentProviderGateway;
    dependencies.controllerOptions.agentTaskGateway = agentTaskGateway;
    dependencies.controllerOptions.gitWorktreeGateway = gitWorktreeGateway;

    const getWorkbench = () => {
      if (!workbench) {
        throw new Error("Workbench controller was not rendered.");
      }

      return workbench;
    };

    const harness = (
      <WorkbenchHarness
        dependencies={dependencies}
        onWorkbench={(nextWorkbench) => {
          workbench = nextWorkbench;
          onWorkbenchRender?.(nextWorkbench);
        }}
        renderQuickOpenSurfaces={renderQuickOpenSurfaces}
      />
    );

    const profiled = onWorkbenchCommit ? (
      <Profiler id="workbench" onRender={(_id, phase) => onWorkbenchCommit(phase)}>
        {harness}
      </Profiler>
    ) : (
      harness
    );

    act(() => {
      mountedRoot.render(strictMode ? <StrictMode>{profiled}</StrictMode> : profiled);
    });

    return { dependencies, getWorkbench };
  }

  function renderRegisteredController(options: RenderControllerOptions = {}) {
    return renderController({
      bridgeRegisteredOwnerFiles: true,
      useRegisteredWorkspaceIdentity: true,
      ...options,
    });
  }

  return { getHost, getRoot, renderController, renderRegisteredController };
}

function fakeAgentProviderGateway(): NonNullable<
  WorkbenchControllerOptions["agentProviderGateway"]
> {
  return {
    currentAgentProviderPolicy: async () => ({ kind: "unregistered" }),
    registerAgentProviderPolicy: async (request) => ({
      provider: request.provider,
      settingsRevision: request.settingsRevision,
      providerGeneration: 1,
    }),
    probeAgentProviderHealth: async () => ({
      installedVersion: null,
      auth: { kind: "unknown" },
      update: { kind: "checksDisabled" },
      checkedAtEpochMs: 1,
    }),
    updateAgentProvider: async () => ({
      kind: "failed",
      reason: "admissionRefused",
      outputTail: "",
      outputTruncated: false,
    }),
  };
}

function fallbackLiveSaveCoordinator(): EditorActiveLiveDocumentSaveAdmissionPort {
  return {
    admit: () => ({ status: "fallback" }),
    publish: () => undefined,
  };
}

function createDefaultWorkspaceIdentity(path: string, admissionToken: number) {
  return {
    admissionToken,
    canonicalRoot: path,
    caseSensitive: true as const,
    policy: {
      caseSensitive: true as const,
      unicodeNormalization: "none" as const,
    },
    selectedPath: path,
    unicodeNormalizationPolicy: "preserved" as const,
    workspaceId: path.replace(/^\/+/, "") || "workspace",
  };
}

export function registeredWorkspaceIdentityGateway(
  paths: readonly string[],
): WorkbenchWorkspaceGateways["identity"] {
  return createRegisteredWorkspaceIdentityGateway(paths, false);
}

function createRegisteredWorkspaceIdentityGateway(
  paths: readonly string[],
  admitUnknownPaths: boolean,
): WorkbenchWorkspaceGateways["identity"] {
  const descriptors = new Map(
    paths.map((path, index) => [path, createDefaultWorkspaceIdentity(path, index + 1)]),
  );
  const descriptorsById = new Map(
    [...descriptors.values()].map((descriptor) => [descriptor.workspaceId, descriptor]),
  );
  return {
    getDescriptor: vi.fn(async (workspaceId) => {
      const descriptor = descriptorsById.get(workspaceId);
      if (!descriptor) throw new Error(`Unknown test workspace identity: ${workspaceId}`);
      return {
        canonicalRootPath: descriptor.canonicalRoot,
        caseSensitive: descriptor.caseSensitive,
        selectedRootPath: descriptor.selectedPath,
        unicodeNormalizationPolicy: descriptor.unicodeNormalizationPolicy,
        workspaceId: descriptor.workspaceId,
      };
    }),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path) => {
      let descriptor = descriptors.get(path);
      if (!descriptor && admitUnknownPaths) {
        descriptor = createDefaultWorkspaceIdentity(path, descriptors.size + 1);
        descriptors.set(path, descriptor);
        descriptorsById.set(descriptor.workspaceId, descriptor);
      }
      if (!descriptor) throw new Error(`Unexpected test workspace path: ${path}`);
      return descriptor;
    }),
    unregister: vi.fn(async () => undefined),
  };
}

export function indexProgressGatewayHarness(
  databasePathForRoot: (rootPath: string) => string = () => "/tmp/index.sqlite",
) {
  let operationGeneration = 0;
  let completionListener: ((event: MetadataScanCompletionEvent) => void) | null = null;
  const start: IndexProgressGateway["startInitialMetadataScan"] = async (request) => {
    operationGeneration = request.operationGeneration;
    return {
      databasePath: databasePathForRoot(request.rootPath),
      operationGeneration,
      rootPath: request.rootPath,
      status: "started",
    };
  };
  return {
    gateway: {
      clearWorkspaceIndex: vi.fn(async (request) => ({
        databasePath: databasePathForRoot(request.rootPath),
        rootPath: request.rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(start),
      startReindex: vi.fn(start),
      subscribeIndexProgress: vi.fn(async () => () => undefined),
      subscribeMetadataScanCompletion: vi.fn(async (listener) => {
        completionListener = listener;
        return () => undefined;
      }),
    } satisfies IndexProgressGateway,
    publishMetadataScanCompletion(
      event:
        | Omit<Extract<MetadataScanCompletionEvent, { status: "completed" }>, "operationGeneration">
        | Omit<Extract<MetadataScanCompletionEvent, { status: "failed" }>, "operationGeneration">,
    ) {
      if (event.status === "completed") {
        completionListener?.({ ...event, operationGeneration });
        return;
      }
      completionListener?.({ ...event, operationGeneration });
    },
  };
}

export function expectedWorkspaceIndexOperation(
  rootPath: string,
  workspaceId = rootPath.replace(/^\/+/, "") || "workspace",
  admissionToken = 1,
) {
  return {
    admissionToken,
    operationGeneration: expect.any(Number),
    rootPath,
    workspaceId,
  };
}

export function expectInitialWorkspaceIndexScan(
  gateway: IndexProgressGateway,
  rootPath: string,
  workspaceId?: string,
  admissionToken?: number,
) {
  expect(gateway.startInitialMetadataScan).toHaveBeenCalledWith(
    expectedWorkspaceIndexOperation(rootPath, workspaceId, admissionToken),
  );
}

export function mockNextInitialIndexStart(gateway: IndexProgressGateway, responseRootPath: string) {
  vi.mocked(gateway.startInitialMetadataScan).mockImplementationOnce(async (request) => ({
    databasePath: "/tmp/index.sqlite",
    operationGeneration: request.operationGeneration,
    rootPath: responseRootPath,
    status: "started",
  }));
}

export function expectWorkspaceIndexClear(
  gateway: IndexProgressGateway,
  rootPath: string,
  workspaceId = rootPath.replace(/^\/+/, "") || "workspace",
  admissionToken = 1,
) {
  expect(gateway.clearWorkspaceIndex).toHaveBeenCalledWith({
    admissionToken,
    rootPath,
    workspaceId,
  });
}

export function expectSmartModeSet(
  gateway: SmartModeGateway,
  rootPath: string,
  mode: Parameters<SmartModeGateway["setMode"]>[0]["mode"],
  workspaceId = rootPath.replace(/^\/+/, "") || "workspace",
  admissionToken = 1,
) {
  expect(gateway.setMode).toHaveBeenCalledWith({ admissionToken, mode, rootPath, workspaceId });
}

export function expectedWorkspaceSettingsIdentity(rootPath: string) {
  return { canonicalKey: rootPath, legacyRawKeys: [rootPath] };
}

export function workspaceSettingsRoot(
  identity: Parameters<SettingsGateway["loadWorkspaceSettings"]>[0],
) {
  return typeof identity === "string" ? identity : identity.canonicalKey;
}

export function featuresGateway(): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => []),
    codeLenses: vi.fn(async () => []),
    completion: vi.fn(async () => ({
      isIncomplete: false,
      items: [],
    })),
    declaration: vi.fn(async () => []),
    definition: vi.fn(async () => []),
    didChangeConfiguration: vi.fn(async () => undefined),
    didChangeWatchedFiles: vi.fn(async () => undefined),
    didCreateFiles: vi.fn(async () => undefined),
    didDeleteFiles: vi.fn(async () => undefined),
    didRenameFiles: vi.fn(async () => undefined),
    documentHighlights: vi.fn(async () => []),
    documentLinks: vi.fn(async () => []),
    documentSymbols: vi.fn(async () => []),
    executeCommand: vi.fn(async () => null),
    executeCommandLocations: vi.fn(async () => []),
    foldingRanges: vi.fn(async () => []),
    formatting: vi.fn(async () => []),
    hover: vi.fn(async () => null),
    incomingCalls: vi.fn(async () => []),
    implementation: vi.fn(async () => []),
    inlayHints: vi.fn(async () => []),
    resolveInlayHint: vi.fn(async (_rootPath, hint) => hint),
    linkedEditingRanges: vi.fn(async () => null),
    onTypeFormatting: vi.fn(async () => []),
    outgoingCalls: vi.fn(async () => []),
    prepareCallHierarchy: vi.fn(async () => []),
    prepareRename: vi.fn(async () => null),
    prepareTypeHierarchy: vi.fn(async () => []),
    rangeFormatting: vi.fn(async () => []),
    rangeSemanticTokens: vi.fn(async () => null),
    references: vi.fn(async () => []),
    rename: vi.fn(async () => null),
    selectionRanges: vi.fn(async () => []),
    semanticTokens: vi.fn(async () => null),
    signatureHelp: vi.fn(async () => null),
    sourceDefinition: vi.fn(async () => []),
    typeDefinition: vi.fn(async () => []),
    typeHierarchySubtypes: vi.fn(async () => []),
    typeHierarchySupertypes: vi.fn(async () => []),
    willCreateFiles: vi.fn(async () => null),
    willDeleteFiles: vi.fn(async () => null),
    willRenameFiles: vi.fn(async () => null),
    workspaceSymbols: vi.fn(async () => []),
    resolveCompletionItem: vi.fn(async (_rootPath, item) => item),
    resolveCodeAction: vi.fn(async (_rootPath, action) => action),
    resolveCodeLens: vi.fn(async (_rootPath, lens) => lens),
    resolveDocumentLink: vi.fn(async (_rootPath, link) => link),
  };
}

function identifiedRequest<T>(
  promise: Promise<T>,
  sessionId: number | undefined,
  requestId: number,
): Promise<T> & { readonly requestId: number; readonly sessionId: number } {
  return Object.assign(promise, { requestId, sessionId: requiredSessionId(sessionId) });
}

function requiredSessionId(sessionId: number | undefined): number {
  if (sessionId === undefined) {
    throw new Error("Expected an active language-server session");
  }
  return sessionId;
}

function javaScriptTypeScriptFeaturesGateway(
  gateway: LanguageServerFeaturesGateway = featuresGateway(),
): JavaScriptTypeScriptLanguageServerFeaturesGateway {
  let nextRequestId = 0;
  const identify = <T,>(promise: Promise<T>, sessionId: number | undefined) =>
    identifiedRequest(promise, sessionId, ++nextRequestId);
  const identifiedRequests = gateway.identifiedRequests ?? {
    cancelRequest: vi.fn(async () => undefined),
    completion: (rootPath, position, context, sessionId) =>
      identify(gateway.completion(rootPath, position, context), sessionId),
    declaration: (rootPath, position, sessionId) =>
      identify(gateway.declaration(rootPath, position), sessionId),
    definition: (rootPath, position, sessionId) =>
      identify(gateway.definition(rootPath, position), sessionId),
    formatting: (rootPath, path, options, sessionId) =>
      identify(gateway.formatting(rootPath, path, options), sessionId),
    hover: (rootPath, position, sessionId) =>
      identify(gateway.hover(rootPath, position), sessionId),
    implementation: (rootPath, position, sessionId) =>
      identify(gateway.implementation(rootPath, position), sessionId),
    references: (rootPath, position, sessionId) =>
      identify(gateway.references(rootPath, position), sessionId),
    signatureHelp: (rootPath, position, context, sessionId) =>
      identify(gateway.signatureHelp(rootPath, position, context), sessionId),
    sourceDefinition: (rootPath, position, sessionId) =>
      identify(gateway.sourceDefinition(rootPath, position), sessionId),
    typeDefinition: (rootPath, position, sessionId) =>
      identify(gateway.typeDefinition(rootPath, position), sessionId),
  };

  return {
    ...gateway,
    identifiedRequests,
    codeActions: (rootPath, path, range, context, sessionId) =>
      identify(gateway.codeActions(rootPath, path, range, context), sessionId),
    codeLenses: (rootPath, path, sessionId) =>
      identify(gateway.codeLenses(rootPath, path), sessionId),
    workspaceSymbols: (rootPath, query, sessionId) =>
      identify(gateway.workspaceSymbols(rootPath, query), sessionId),
    completion: (rootPath, position, context, sessionId) =>
      identify(gateway.completion(rootPath, position, context), sessionId),
    declaration: (rootPath, position, sessionId) =>
      identify(gateway.declaration(rootPath, position), sessionId),
    definition: (rootPath, position, sessionId) =>
      identify(gateway.definition(rootPath, position), sessionId),
    documentHighlights: (rootPath, position, sessionId) =>
      identify(gateway.documentHighlights(rootPath, position), sessionId),
    hover: (rootPath, position, sessionId) =>
      identify(gateway.hover(rootPath, position), sessionId),
    implementation: (rootPath, position, sessionId) =>
      identify(gateway.implementation(rootPath, position), sessionId),
    inlayHints: (rootPath, path, range, sessionId) =>
      identify(gateway.inlayHints(rootPath, path, range), sessionId),
    linkedEditingRanges: (rootPath, position, sessionId) =>
      identify(gateway.linkedEditingRanges(rootPath, position), sessionId),
    rangeSemanticTokens: (rootPath, path, range, sessionId) =>
      identify(gateway.rangeSemanticTokens(rootPath, path, range), sessionId),
    references: (rootPath, position, _includeDeclaration, sessionId) =>
      identify(gateway.references(rootPath, position), sessionId),
    executeCommandLocations: (rootPath, command, sessionId) =>
      identify(gateway.executeCommandLocations(rootPath, command), sessionId),
    resolveCodeAction: (rootPath, action, sessionId) =>
      identify(gateway.resolveCodeAction(rootPath, action), sessionId),
    resolveCodeLens: (rootPath, lens, sessionId) =>
      identify(gateway.resolveCodeLens(rootPath, lens), sessionId),
    resolveInlayHint: (rootPath, hint, sessionId) =>
      identify(gateway.resolveInlayHint(rootPath, hint), sessionId),
    semanticTokens: (rootPath, path, sessionId) =>
      identify(gateway.semanticTokens(rootPath, path), sessionId),
    signatureHelp: (rootPath, position, context, sessionId) =>
      identify(gateway.signatureHelp(rootPath, position, context), sessionId),
    sourceDefinition: (rootPath, position, sessionId) =>
      identify(gateway.sourceDefinition(rootPath, position), sessionId),
    typeDefinition: (rootPath, position, sessionId) =>
      identify(gateway.typeDefinition(rootPath, position), sessionId),
  };
}

export async function flushAsyncTurns(count = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
    }
  });
}

export function javaScriptTypeScriptWorkspaceDescriptor(): WorkspaceDescriptor {
  return {
    javaScriptTypeScript: {
      frameworks: [],
      hasJsconfig: false,
      hasPackageJson: true,
      hasTsconfig: true,
      packageManager: "npm",
      packageName: "app",
      typeScriptDependencyVersion: "^5.0.0",
      usesTypeScript: true,
      workspaceTypeScriptVersion: "5.0.0",
    },
    php: null,
    rootPath: "/workspace",
  };
}

function createDiagnosticsFlushScheduler(): DiagnosticsFlushScheduler {
  let flushSequence: Promise<void> = Promise.resolve();
  let nextHandle = 1;
  const cancelled = new Set<number>();

  return {
    cancel: (handle: number) => {
      cancelled.add(handle);
    },
    schedule: (flush: () => void): number => {
      const handle = nextHandle;
      nextHandle += 1;
      flushSequence = flushSequence.then(() => {
        if (cancelled.has(handle)) {
          cancelled.delete(handle);
          return;
        }

        flush();
      });
      return handle;
    },
  };
}

export function createInMemoryLocalHistoryGateway(): LocalHistoryGateway {
  const buckets = new Map<string, LocalHistoryVersion[]>();
  const contents = new Map<string, string>();
  const lastContent = new Map<string, string>();
  let sequence = 0;
  const key = (rootPath: string, relativePath: string) => `${rootPath}\0${relativePath}`;

  return {
    recordSnapshot: vi.fn(async (rootPath: string, relativePath: string, content: string) => {
      const bucketKey = key(rootPath, relativePath);

      if (lastContent.get(bucketKey) === content) {
        return null;
      }

      sequence += 1;
      const version: LocalHistoryVersion = {
        id: `${sequence}`.padStart(12, "0"),
        sizeBytes: content.length,
        timestampMs: 1_700_000_000_000 + sequence,
      };
      const existing = buckets.get(bucketKey) ?? [];
      existing.push(version);
      buckets.set(bucketKey, existing);
      contents.set(`${bucketKey}\0${version.id}`, content);
      lastContent.set(bucketKey, content);
      return version;
    }),
    listVersions: vi.fn(async (rootPath: string, relativePath: string) => {
      const bucket = buckets.get(key(rootPath, relativePath)) ?? [];
      return [...bucket].reverse();
    }),
    readVersion: vi.fn(async (rootPath: string, relativePath: string, versionId: string) => {
      const bucketKey = key(rootPath, relativePath);
      const content = contents.get(`${bucketKey}\0${versionId}`);

      if (content === undefined) {
        throw new Error(`Unknown local history version: ${versionId}`);
      }

      return content;
    }),
  };
}

function createControllerDependencies(
  {
    appSettings,
    dirtyTextSearchGateway,
    gitGateway,
    localHistoryGateway,
    indexProgressGateway,
    javaScriptTypeScriptInitialRuntimeStatus,
    javaScriptTypeScriptLanguageServerDiagnosticsGateway,
    javaScriptTypeScriptLanguageServerDocumentSyncGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway,
    javaScriptTypeScriptLanguageServerPlan,
    javaScriptTypeScriptLanguageServerRuntimeGateway,
    javaScriptTypeScriptRuntimeStatus,
    languageServerGateway,
    languageServerPlan,
    languageServerFeaturesGateway,
    languageServerDiagnosticsGateway,
    languageServerDocumentSyncGateway,
    languageServerRuntimeGateway,
    phpToolGateway,
    projectSymbols,
    prompter,
    readDirectory,
    readTextFile,
    runtimeStatus,
    searchFiles,
    searchText,
    replaceInPath,
    settingsGateway,
    smartModeGateway,
    workspaceDetectionGateway,
    workspaceDescriptor,
    workspaceFileChangeGateway,
    workspaceIdentityGateway,
    workspaceFiles,
    workspaceOwnerFiles,
    workspaceRuntimeLifecycleGateway,
    workspaceSettings,
    workspaceTrustGateway,
    bridgeRegisteredOwnerFiles,
    useRegisteredWorkspaceIdentity,
  }: Required<
    Pick<
      RenderControllerOptions,
      | "appSettings"
      | "javaScriptTypeScriptInitialRuntimeStatus"
      | "javaScriptTypeScriptRuntimeStatus"
      | "projectSymbols"
      | "readTextFile"
      | "runtimeStatus"
      | "searchFiles"
    >
  > & {
    workspaceSettings: ReturnType<typeof defaultWorkspaceSettings>;
  } & Omit<
      RenderControllerOptions,
      | "appSettings"
      | "debugBreakpointStorage"
      | "debugGateway"
      | "editorGroupFocusRunner"
      | "javaScriptTypeScriptInitialRuntimeStatus"
      | "markdownPreviewRenderer"
      | "prettierFormattingGateway"
      | "renderQuickOpenSurfaces"
      | "javaScriptTypeScriptRuntimeStatus"
      | "projectSymbols"
      | "readTextFile"
      | "runtimeStatus"
      | "searchFiles"
      | "workspaceSettings"
    >,
  diagnosticsFlushScheduler: DiagnosticsFlushScheduler,
): ControllerDependencies {
  const defaultDocumentSyncGateway = documentSyncGatewayMock();
  const phpDocumentSyncGateway = languageServerDocumentSyncGateway ?? defaultDocumentSyncGateway;
  const javaScriptTypeScriptDocumentSyncGateway =
    javaScriptTypeScriptLanguageServerDocumentSyncGateway ?? defaultDocumentSyncGateway;
  const controllerOptions: WorkbenchControllerOptions = {
    diagnosticsFlushScheduler,
    editorCursorStore: new EditorCursorStore(),
  };
  const filesGateway: WorkbenchWorkspaceGateways["files"] = {
    applyWorkspaceEdit: vi.fn(async () => 0),
    createDirectory: vi.fn(async () => undefined),
    createTextFile: vi.fn(async () => undefined),
    deletePath: vi.fn(async () => undefined),
    readDirectory: vi.fn(readDirectory ?? (async () => [])),
    readDirectoryBounded: vi.fn(async (path: string, maxEntries: number) => {
      const entries = await (readDirectory ?? (async () => []))(path);
      return { entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries };
    }),
    readTextFile,
    readTextFileSnapshot: vi.fn(async (path) => ({
      content: await readTextFile(path),
      revision: {
        contentHash: `test:${path}`,
        device: "test-device",
        inode: path,
        modifiedNanoseconds: 0,
        modifiedSeconds: 0,
        size: 0,
      },
    })),
    readTextFileBounded: vi.fn(async (path: string, maxBytes: number) => {
      const content = await readTextFile(path);

      return new TextEncoder().encode(content).byteLength > maxBytes
        ? { status: "tooLarge" as const }
        : { content, status: "ok" as const };
    }),
    renamePath: vi.fn(async () => undefined),
    writeTextFile: vi.fn(async () => undefined),
    ...workspaceFiles,
  };
  const workspaceGateways: WorkbenchWorkspaceGateways = {
    identity:
      workspaceIdentityGateway ??
      (useRegisteredWorkspaceIdentity
        ? createRegisteredWorkspaceIdentityGateway([], true)
        : {
            getDescriptor: vi.fn(),
            openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
            unregister: vi.fn(async () => undefined),
          }),
    detection: workspaceDetectionGateway ?? {
      detectWorkspace: vi.fn(async (path) => ({
        javaScriptTypeScript: workspaceDescriptor?.javaScriptTypeScript ?? null,
        php: workspaceDescriptor?.php ?? null,
        rootPath: path,
      })),
    },
    dirtyTextSearch: dirtyTextSearchGateway ?? {
      compute: vi.fn(async (request) =>
        request.documents.length > 0
          ? computeDirtyTextSearch(request, {
              hasTimeRemaining: () => true,
              utf8ByteLength: (value) => new TextEncoder().encode(value).byteLength,
            })
          : {
              authority: request.authority,
              dirtyPaths: request.dirtyPaths,
              limitations: request.preflightLimitations,
              results: [],
              truncated: request.preflightLimitations.length > 0,
            },
      ),
    },
    fileChanges: workspaceFileChangeGateway ?? {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async () => () => undefined),
    },
    fileSearch: {
      searchFiles,
    },
    files: filesGateway,
    ownerFiles: workspaceOwnerFiles
      ? {
          createDirectoryForWorkspace:
            workspaceOwnerFiles.createDirectoryForWorkspace ??
            vi.fn(async () => {
              throw new Error("Owner-scoped directory creation is not configured for this test.");
            }),
          createTextFileWithContentForWorkspace:
            workspaceOwnerFiles.createTextFileWithContentForWorkspace ??
            vi.fn(async () => {
              throw new Error("Owner-scoped file creation is not configured for this test.");
            }),
          writeTextFileForWorkspace:
            workspaceOwnerFiles.writeTextFileForWorkspace ??
            vi.fn(async () => {
              throw new Error(
                "Owner-scoped absolute file writing is not configured for this test.",
              );
            }),
          writeTextFileForWorkspaceRelativePath:
            workspaceOwnerFiles.writeTextFileForWorkspaceRelativePath ??
            vi.fn(async () => {
              throw new Error(
                "Owner-scoped relative file writing is not configured for this test.",
              );
            }),
        }
      : bridgeRegisteredOwnerFiles
        ? {
            createDirectoryForWorkspace: vi.fn(async (_workspaceId, path) => {
              await filesGateway.createDirectory(path);
            }),
            createTextFileWithContentForWorkspace: vi.fn(async (_workspaceId, path, content) => {
              await filesGateway.createTextFile(path);
              return (
                (await filesGateway.writeTextFile(path, content)) ?? {
                  revision: null,
                  status: "success" as const,
                }
              );
            }),
            writeTextFileForWorkspace: vi.fn(async (_workspaceId, path, content) => {
              return (
                (await filesGateway.writeTextFile(path, content)) ?? {
                  revision: null,
                  status: "success" as const,
                }
              );
            }),
            writeTextFileForWorkspaceRelativePath: vi.fn(
              async (workspaceId, relativePath, content) => {
                const normalizedWorkspaceId = workspaceId.replace(/^\/+|\/+$/g, "");
                const normalizedRelativePath = relativePath.replace(/^\/+/, "");
                return (
                  (await filesGateway.writeTextFile(
                    `/${normalizedWorkspaceId}/${normalizedRelativePath}`,
                    content,
                  )) ?? {
                    revision: null,
                    status: "success" as const,
                  }
                );
              },
            ),
          }
        : undefined,
    phpTools: phpToolGateway ?? {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    },
    projectSymbols: {
      searchProjectSymbols: vi.fn(async () => projectSymbols),
    },
    textSearch: {
      searchText: vi.fn(searchText ?? (async () => [])),
      replaceInPath: vi.fn(replaceInPath ?? (async () => ({ files: [], totalReplacements: 0 }))),
    },
  };

  return {
    controllerOptions,
    documentSyncGateway: phpDocumentSyncGateway,
    gitGateway: gitGateway ?? {
      blame: vi.fn(async () => []),
      fileHistory: vi.fn(async () => []),
      fileCommitDiff: vi.fn(async (_rootPath, relativePath) => ({
        change: {
          isStaged: false,
          isUnversioned: false,
          oldPath: null,
          oldRelativePath: null,
          path: relativePath,
          relativePath,
          status: "modified" as const,
        },
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      commit: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      push: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getDiff: vi.fn(async (_rootPath, change) => ({
        change,
        language: "plaintext",
        modifiedContent: "",
        originalContent: "",
      })),
      getStatus: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      getFileHunks: vi.fn(async () => []),
      revertFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageFiles: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      unstageHunk: vi.fn(async (rootPath) => emptyGitStatus(rootPath)),
      stashSave: vi.fn(async () => undefined),
      stashList: vi.fn(async () => []),
      stashApply: vi.fn(async () => undefined),
      stashPop: vi.fn(async () => undefined),
      stashShow: vi.fn(async () => ""),
      stashDrop: vi.fn(async () => undefined),
      branchList: vi.fn(async () => []),
      currentBranch: vi.fn(async () => null),
      createBranch: vi.fn(async () => undefined),
      switchBranch: vi.fn(async () => undefined),
    },
    localHistoryGateway: localHistoryGateway ?? createInMemoryLocalHistoryGateway(),
    indexProgressGateway: indexProgressGateway ?? {
      clearWorkspaceIndex: vi.fn(async (request) => ({
        databasePath: "/tmp/index.sqlite",
        rootPath: request.rootPath,
        status: "cleared" as const,
      })),
      startInitialMetadataScan: vi.fn(async (request) => ({
        databasePath: "/tmp/index.sqlite",
        operationGeneration: request.operationGeneration,
        rootPath: request.rootPath,
        status: "started" as const,
      })),
      startReindex: vi.fn(async (request) => ({
        databasePath: "/tmp/index.sqlite",
        operationGeneration: request.operationGeneration,
        rootPath: request.rootPath,
        status: "started" as const,
      })),
      subscribeIndexProgress: vi.fn(async () => () => undefined),
      subscribeMetadataScanCompletion: vi.fn(async () => () => undefined),
    },
    languageServerDiagnosticsGateway: languageServerDiagnosticsGateway ?? {
      subscribeDiagnostics: vi.fn(async () => () => undefined),
    },
    languageServerDocumentSyncGateway: phpDocumentSyncGateway,
    languageServerFeaturesGateway: languageServerFeaturesGateway ?? featuresGateway(),
    languageServerGateway: languageServerGateway ?? {
      planJavaScriptTypeScriptLanguageServer: vi.fn(
        async () =>
          javaScriptTypeScriptLanguageServerPlan ??
          ({
            command: null,
            initializeRequest: null,
            message: "JavaScript/TypeScript language server unavailable in test.",
            provider: "typeScriptLanguageServer" as const,
            status: "unavailable" as const,
          } satisfies LanguageServerPlan),
      ),
      planPhpLanguageServer: vi.fn(
        async () =>
          languageServerPlan ?? {
            command: null,
            initializeRequest: null,
            message: "Language server unavailable in test.",
            provider: "phpactor" as const,
            status: "unavailable" as const,
          },
      ),
    },
    languageServerRuntimeGateway: languageServerRuntimeGateway ?? {
      getStatus: vi.fn(async (rootPath) => runtimeStatusWithRootForTest(runtimeStatus, rootPath)),
      openLog: vi.fn(async () => null),
      start: vi.fn(async (rootPath) => runtimeStatusWithRootForTest(runtimeStatus, rootPath)),
      stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
      subscribeStatus: vi.fn(async () => () => undefined),
    },
    javaScriptTypeScriptLanguageServerDiagnosticsGateway:
      javaScriptTypeScriptLanguageServerDiagnosticsGateway ?? {
        subscribeDiagnostics: vi.fn(async () => () => undefined),
      },
    javaScriptTypeScriptLanguageServerDocumentSyncGateway: javaScriptTypeScriptDocumentSyncGateway,
    javaScriptTypeScriptLanguageServerFeaturesGateway: javaScriptTypeScriptFeaturesGateway(
      javaScriptTypeScriptLanguageServerFeaturesGateway,
    ),
    javaScriptTypeScriptLanguageServerRuntimeGateway:
      javaScriptTypeScriptLanguageServerRuntimeGateway ?? {
        getStatus: vi.fn(async (rootPath) =>
          runtimeStatusWithRootForTest(javaScriptTypeScriptInitialRuntimeStatus, rootPath),
        ),
        openLog: vi.fn(async () => "/tmp/typescript-language-server.log"),
        start: vi.fn(async (rootPath) =>
          runtimeStatusWithRootForTest(javaScriptTypeScriptRuntimeStatus, rootPath),
        ),
        stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
        subscribeStatus: vi.fn(async () => () => undefined),
      },
    phpFileOutlineGateway: {
      getPhpFileOutline: vi.fn(async () => ({ nodes: [] })),
      parsePhpFileOutline: vi.fn(async () => ({ nodes: [] })),
    },
    phpTreeGateway: {
      getPhpTree: vi.fn(async () => ({ nodes: [] })),
    },
    prompter: prompter ?? {
      confirm: vi.fn(() => true),
      prompt: vi.fn(() => null),
    },
    settingsGateway: settingsGateway ?? {
      loadAppSettings: vi.fn(async () => appSettings),
      loadWorkspaceSettings: vi.fn(async () => workspaceSettings),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    },
    smartModeGateway: smartModeGateway ?? {
      getState: vi.fn(async () => ({
        message: "Basic",
        mode: "basic" as const,
        status: "off" as const,
      })),
      setMode: vi.fn(async (request) => ({
        message: "Updated",
        mode: request.mode,
        status: "ready" as const,
      })),
    },
    terminalGateway: createStoppedTerminalGateway(),
    workspaceRuntimeLifecycleGateway:
      workspaceRuntimeLifecycleGateway ?? defaultWorkspaceRuntimeLifecycleGateway(),
    workspaceGateways,
    workspaceTrustGateway: workspaceTrustGateway ?? {
      getTrust: vi.fn(async (rootPath) => ({
        rootPath,
        trusted: true,
      })),
      setTrust: vi.fn(async (rootPath, trusted) => ({
        rootPath,
        trusted,
      })),
    },
  };
}

function defaultWorkspaceRuntimeLifecycleGateway(): WorkspaceRuntimeLifecycleGateway {
  const disposeWorkspace = vi.fn(async (_rootPath: string) => undefined);
  return exactWorkspaceRuntimeLifecycleGateway(disposeWorkspace);
}

export function exactWorkspaceRuntimeLifecycleGateway(
  disposeWorkspace: WorkspaceRuntimeLifecycleGateway["disposeWorkspace"],
): WorkspaceRuntimeLifecycleGateway {
  return {
    disposeWorkspace,
    disposeRegisteredWorkspace: async (target) => {
      await disposeWorkspace(target.selectedRootPath);
      return { status: "closed" };
    },
  };
}

export function expectNoExplicitRuntimeStops(dependencies: ControllerDependencies): void {
  expect(dependencies.languageServerRuntimeGateway.stop).not.toHaveBeenCalled();
  expect(dependencies.javaScriptTypeScriptLanguageServerRuntimeGateway.stop).not.toHaveBeenCalled();
  expect(dependencies.terminalGateway.stopRoot).not.toHaveBeenCalled();
}

function fakeAgentRootLeaseGateway(): NonNullable<
  WorkbenchControllerOptions["agentRootLeaseGateway"]
> {
  let nextToken = 0;
  return {
    acquireAgentRootLease: async () => {
      nextToken += 1;
      return { leaseToken: nextToken };
    },
    releaseAgentRootLease: async () => undefined,
  };
}

function runtimeStatusWithRootForTest(
  status: LanguageServerRuntimeStatus,
  rootPath: string,
): LanguageServerRuntimeStatus {
  return status.rootPath ? status : { ...status, rootPath };
}

export function documentSyncGatewayMock(): LanguageServerDocumentSyncGateway &
  SessionBoundLanguageServerDocumentSyncGateway {
  return {
    [sessionBoundLanguageServerDocumentSyncGateway]: true,
    didChange: vi.fn(async () => undefined),
    didClose: vi.fn(async () => undefined),
    didOpen: vi.fn(async () => undefined),
    didSave: vi.fn(async () => undefined),
  };
}

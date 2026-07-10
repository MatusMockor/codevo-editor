// @vitest-environment jsdom

import { useEffect } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import {
  emptyGitStatus,
  type GitGateway,
  type GitStatus,
} from "../domain/git";
import type { LocalHistoryGateway } from "../domain/localHistory";
import {
  useWorkbenchController,
  type WorkbenchWorkspaceGateways,
} from "./useWorkbenchController";
import type { IndexProgressGateway } from "../domain/indexProgress";
import type { SmartModeGateway } from "../domain/intelligence";
import type {
  LanguageServerGateway,
  LanguageServerPlan,
} from "../domain/languageServer";
import type { LanguageServerDiagnosticsGateway } from "../domain/languageServerDiagnostics";
import type { LanguageServerDocumentSyncGateway } from "../domain/languageServerDocumentSync";
import type { LanguageServerFeaturesGateway } from "../domain/languageServerFeatures";
import {
  type LanguageServerRuntimeGateway,
  type LanguageServerRuntimeStatus,
} from "../domain/languageServerRuntime";
import type { DiagnosticsFlushScheduler } from "../domain/diagnosticsCoalescer";
import type { PhpFileOutlineGateway } from "../domain/phpFileOutline";
import type { PhpTreeGateway } from "../domain/phpTree";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";

type WorkbenchController = ReturnType<typeof useWorkbenchController>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolveValue: ((value: T) => void) | null = null;
  let rejectValue: ((error: unknown) => void) | null = null;
  const promise = new Promise<T>((resolve, reject) => {
    resolveValue = resolve;
    rejectValue = reject;
  });

  return {
    promise,
    reject(error: unknown) {
      rejectValue?.(error);
    },
    resolve(value: T) {
      resolveValue?.(value);
    },
  };
}

// A microtask-based diagnostics scheduler so a single `flushAsyncTurns()` after
// a state change applies any coalesced work, exactly as production does one
// frame later. jsdom's rAF only fires on a macrotask the microtask flush never
// advances.
let microtaskFlushSequence: Promise<void> = Promise.resolve();
const microtaskDiagnosticsFlushScheduler: DiagnosticsFlushScheduler = (() => {
  let nextHandle = 1;
  const cancelled = new Set<number>();
  return {
    cancel: (handle: number) => {
      cancelled.add(handle);
    },
    schedule: (flush: () => void): number => {
      const handle = nextHandle;
      nextHandle += 1;
      microtaskFlushSequence = microtaskFlushSequence.then(() => {
        if (cancelled.has(handle)) {
          cancelled.delete(handle);
          return;
        }

        flush();
      });
      return handle;
    },
  };
})();

async function flushAsyncTurns(count = 12): Promise<void> {
  await act(async () => {
    for (let index = 0; index < count; index += 1) {
      await Promise.resolve();
    }
  });
}

function repoStatus(rootPath: string): GitStatus {
  return {
    branch: "main",
    changes: [],
    isRepository: true,
    rootPath,
  };
}

function stubGitGateway(overrides: Partial<GitGateway> = {}): GitGateway {
  return {
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
    getStatus: vi.fn(async (rootPath) => repoStatus(rootPath)),
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
    ...overrides,
  };
}

function stubLocalHistoryGateway(): LocalHistoryGateway {
  return {
    recordSnapshot: vi.fn(async () => null),
    listVersions: vi.fn(async () => []),
    readVersion: vi.fn(async () => ""),
  };
}

function stubFeaturesGateway(): LanguageServerFeaturesGateway {
  return {
    codeActions: vi.fn(async () => []),
    codeLenses: vi.fn(async () => []),
    completion: vi.fn(async () => ({ isIncomplete: false, items: [] })),
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

interface RenderOptions {
  appSettings?: AppSettings;
  workspaceSettings?: WorkspaceSettings;
  gitGateway?: GitGateway;
  settingsGateway?: SettingsGateway;
}

function buildDependencies({
  appSettings = defaultAppSettings(),
  workspaceSettings = defaultWorkspaceSettings(),
  gitGateway = stubGitGateway(),
  settingsGateway,
}: RenderOptions) {
  const documentSyncGateway: LanguageServerDocumentSyncGateway = {
    didChange: vi.fn(async () => undefined),
    didClose: vi.fn(async () => undefined),
    didOpen: vi.fn(async () => undefined),
    didSave: vi.fn(async () => undefined),
  };
  const stoppedStatus: LanguageServerRuntimeStatus = { kind: "stopped" };
  const workspaceGateways: WorkbenchWorkspaceGateways = {
    identity: {
      getDescriptor: vi.fn(),
      openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
      unregister: vi.fn(async () => undefined),
    },
    detection: {
      detectWorkspace: vi.fn(async (path) => ({
        javaScriptTypeScript: null,
        php: null,
        rootPath: path,
      })),
    },
    fileChanges: {
      startWatching: vi.fn(async () => undefined),
      subscribeFileChanges: vi.fn(async () => () => undefined),
    },
    fileSearch: {
      searchFiles: vi.fn(async () => []),
    },
    files: {
      applyWorkspaceEdit: vi.fn(async () => 0),
      createDirectory: vi.fn(async () => undefined),
      createTextFile: vi.fn(async () => undefined),
      deletePath: vi.fn(async () => undefined),
      readDirectory: vi.fn(async () => []),
      readTextFile: vi.fn(async (path: string) => `<?php\n// ${path}\n`),
      renamePath: vi.fn(async () => undefined),
      writeTextFile: vi.fn(async () => undefined),
    },
    phpTools: {
      detectPhpTools: vi.fn(async () => ({
        intelephense: null,
        phpactor: null,
      })),
      installManagedPhpactor: vi.fn(async () => undefined),
      subscribeManagedPhpactorInstall: vi.fn(async () => () => undefined),
    },
    projectSymbols: {
      searchProjectSymbols: vi.fn(async () => []),
    },
    textSearch: {
      searchText: vi.fn(async () => []),
      replaceInPath: vi.fn(async () => ({ files: [], totalReplacements: 0 })),
    },
  };

  const smartModeGateway: SmartModeGateway = {
    getState: vi.fn(async () => ({
      message: "Basic",
      mode: "basic" as const,
      status: "off" as const,
    })),
    setMode: vi.fn(async (mode) => ({
      message: "Updated",
      mode,
      status: "ready" as const,
    })),
  };
  const workspaceTrustGateway: WorkspaceTrustGateway = {
    getTrust: vi.fn(async (rootPath) => ({ rootPath, trusted: true })),
    setTrust: vi.fn(async (rootPath, trusted) => ({ rootPath, trusted })),
  };
  const indexProgressGateway: IndexProgressGateway = {
    clearWorkspaceIndex: vi.fn(async (rootPath) => ({
      databasePath: "/tmp/index.sqlite",
      rootPath,
      status: "cleared" as const,
    })),
    startInitialMetadataScan: vi.fn(async (rootPath) => ({
      databasePath: "/tmp/index.sqlite",
      rootPath,
      status: "started" as const,
    })),
    startReindex: vi.fn(async (rootPath) => ({
      databasePath: "/tmp/index.sqlite",
      rootPath,
      status: "started" as const,
    })),
    subscribeIndexProgress: vi.fn(async () => () => undefined),
    subscribeMetadataScanCompletion: vi.fn(async () => () => undefined),
  };
  const phpFileOutlineGateway: PhpFileOutlineGateway = {
    getPhpFileOutline: vi.fn(async () => ({ nodes: [] })),
    parsePhpFileOutline: vi.fn(async () => ({ nodes: [] })),
  };
  const phpTreeGateway: PhpTreeGateway = {
    getPhpTree: vi.fn(async () => ({ nodes: [] })),
  };
  const languageServerGateway: LanguageServerGateway = {
    planJavaScriptTypeScriptLanguageServer: vi.fn(
      async () =>
        ({
          command: null,
          initializeRequest: null,
          message: "unavailable",
          provider: "typeScriptLanguageServer" as const,
          status: "unavailable" as const,
        }) satisfies LanguageServerPlan,
    ),
    planPhpLanguageServer: vi.fn(
      async () =>
        ({
          command: null,
          initializeRequest: null,
          message: "unavailable",
          provider: "phpactor" as const,
          status: "unavailable" as const,
        }) satisfies LanguageServerPlan,
    ),
  };
  const runtimeGateway = (): LanguageServerRuntimeGateway => ({
    getStatus: vi.fn(async (rootPath) => ({ ...stoppedStatus, rootPath })),
    openLog: vi.fn(async () => null),
    start: vi.fn(async (rootPath) => ({ ...stoppedStatus, rootPath })),
    stop: vi.fn(async (rootPath) => ({ kind: "stopped" as const, rootPath })),
    subscribeStatus: vi.fn(async () => () => undefined),
  });
  const diagnosticsGateway = (): LanguageServerDiagnosticsGateway => ({
    subscribeDiagnostics: vi.fn(async () => () => undefined),
  });
  const terminalGateway: TerminalGateway = {
    listProfiles: vi.fn(async () => []),
    resize: vi.fn(async () => undefined),
    start: vi.fn(async () => ({ kind: "stopped" as const, sessionId: 1 })),
    stop: vi.fn(async (sessionId) => ({ kind: "stopped" as const, sessionId })),
    stopAll: vi.fn(async () => undefined),
    stopRoot: vi.fn(async () => undefined),
    subscribeOutput: vi.fn(async () => () => undefined),
    writeInput: vi.fn(async () => undefined),
  };
  const workspaceRuntimeLifecycleGateway: WorkspaceRuntimeLifecycleGateway = {
    disposeWorkspace: vi.fn(async () => undefined),
  };
  const resolvedSettingsGateway: SettingsGateway = settingsGateway ?? {
    loadAppSettings: vi.fn(async () => appSettings),
    loadWorkspaceSettings: vi.fn(async () => workspaceSettings),
    saveAppSettings: vi.fn(async () => undefined),
    saveWorkspaceSettings: vi.fn(async () => undefined),
  };
  const prompter: WorkbenchPrompter = {
    confirm: vi.fn(() => true),
    prompt: vi.fn(() => null),
  };

  return {
    gitGateway,
    settingsGateway: resolvedSettingsGateway,
    args: [
      workspaceGateways,
      smartModeGateway,
      workspaceTrustGateway,
      indexProgressGateway,
      phpFileOutlineGateway,
      phpTreeGateway,
      gitGateway,
      stubLocalHistoryGateway(),
      languageServerGateway,
      runtimeGateway(),
      documentSyncGateway,
      diagnosticsGateway(),
      stubFeaturesGateway(),
      runtimeGateway(),
      documentSyncGateway,
      diagnosticsGateway(),
      stubFeaturesGateway(),
      workspaceRuntimeLifecycleGateway,
      terminalGateway,
      resolvedSettingsGateway,
      prompter,
      { diagnosticsFlushScheduler: microtaskDiagnosticsFlushScheduler },
    ] as const,
  };
}

describe("useWorkbenchController git repository mappings live re-discovery", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(async () => {
    await flushAsyncTurns();
    await act(async () => {
      root.unmount();
      await Promise.resolve();
    });
    host.remove();
  });

  function renderController(options: RenderOptions) {
    const dependencies = buildDependencies(options);
    let workbench: WorkbenchController | null = null;

    function Harness() {
      const controller = useWorkbenchController(...dependencies.args);
      useEffect(() => {
        workbench = controller;
      }, [controller]);
      return null;
    }

    act(() => {
      root.render(<Harness />);
    });

    const getWorkbench = () => {
      if (!workbench) {
        throw new Error("Workbench controller was not rendered.");
      }

      return workbench;
    };

    return { dependencies, getWorkbench };
  }

  const mappingPaths = (controller: WorkbenchController): string[] =>
    controller.gitRepositoryMappings.map((mapping) => mapping.rootRelativePath);

  it("re-runs discovery and fans out status when a manual mapping is added (auto off)", async () => {
    const detectRepositories = vi.fn(async () => ["packages/detected"]);
    const gitGateway = stubGitGateway({ detectRepositories });
    const { getWorkbench } = renderController({
      gitGateway,
      appSettings: { ...defaultAppSettings(), recentWorkspacePath: "/workspace" },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: [],
        gitDirectoryMappingsAuto: false,
      },
    });
    await flushAsyncTurns();

    // Show the git panel so the status fan-out effect is live.
    act(() => {
      getWorkbench().setSidebarView("git");
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual([""]);
    // Auto-detect is off: discovery never calls detectRepositories.
    expect(detectRepositories).not.toHaveBeenCalled();

    const gateway = gitGateway;
    (gateway.getStatus as ReturnType<typeof vi.fn>).mockClear();

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        defaultAppSettings(),
        {
          ...defaultWorkspaceSettings(),
          gitDirectoryMappings: ["packages/api"],
          gitDirectoryMappingsAuto: false,
        },
        null,
      );
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual(["", "packages/api"]);
    expect(detectRepositories).not.toHaveBeenCalled();
    const statusRoots = (gateway.getStatus as ReturnType<typeof vi.fn>).mock.calls.map(
      (call) => call[0],
    );
    expect(statusRoots).toContain("/workspace/packages/api");
  });

  it("re-runs discovery merging auto-detected repositories when auto-detect is enabled", async () => {
    const detectRepositories = vi.fn(async () => ["", "packages/api"]);
    const gitGateway = stubGitGateway({ detectRepositories });
    const { getWorkbench } = renderController({
      gitGateway,
      appSettings: { ...defaultAppSettings(), recentWorkspacePath: "/workspace" },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: ["libs/manual"],
        gitDirectoryMappingsAuto: false,
      },
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual(["", "libs/manual"]);
    expect(detectRepositories).not.toHaveBeenCalled();

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        defaultAppSettings(),
        {
          ...defaultWorkspaceSettings(),
          gitDirectoryMappings: ["libs/manual"],
          gitDirectoryMappingsAuto: true,
        },
        null,
      );
    });
    await flushAsyncTurns();

    expect(detectRepositories).toHaveBeenCalledWith("/workspace");
    expect(mappingPaths(getWorkbench())).toEqual([
      "",
      "libs/manual",
      "packages/api",
    ]);
  });

  it("drops auto-detected repositories when auto-detect is turned off, keeping manual only", async () => {
    const detectRepositories = vi.fn(async () => ["packages/api"]);
    const gitGateway = stubGitGateway({ detectRepositories });
    const { getWorkbench } = renderController({
      gitGateway,
      appSettings: { ...defaultAppSettings(), recentWorkspacePath: "/workspace" },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: ["libs/manual"],
        gitDirectoryMappingsAuto: true,
      },
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual([
      "",
      "libs/manual",
      "packages/api",
    ]);

    await act(async () => {
      await getWorkbench().saveWorkbenchSettings(
        defaultAppSettings(),
        {
          ...defaultWorkspaceSettings(),
          gitDirectoryMappings: ["libs/manual"],
          gitDirectoryMappingsAuto: false,
        },
        null,
      );
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual(["", "libs/manual"]);
  });

  it("lets the last of two rapid git-mapping changes win (re-entrancy token)", async () => {
    const detectDeferreds: Array<Deferred<string[]>> = [];
    const detectRepositories = vi.fn(async () => {
      const deferred = createDeferred<string[]>();
      detectDeferreds.push(deferred);
      return deferred.promise;
    });
    const gitGateway = stubGitGateway({ detectRepositories });
    const { getWorkbench } = renderController({
      gitGateway,
      appSettings: { ...defaultAppSettings(), recentWorkspacePath: "/workspace" },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: [],
        gitDirectoryMappingsAuto: false,
      },
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual([""]);

    let firstSave: Promise<void> | null = null;
    let secondSave: Promise<void> | null = null;

    act(() => {
      firstSave = getWorkbench().saveWorkbenchSettings(
        defaultAppSettings(),
        {
          ...defaultWorkspaceSettings(),
          gitDirectoryMappings: ["libs/first"],
          gitDirectoryMappingsAuto: true,
        },
        null,
      );
    });
    await flushAsyncTurns();

    act(() => {
      secondSave = getWorkbench().saveWorkbenchSettings(
        defaultAppSettings(),
        {
          ...defaultWorkspaceSettings(),
          gitDirectoryMappings: ["libs/second"],
          gitDirectoryMappingsAuto: true,
        },
        null,
      );
    });
    await flushAsyncTurns();

    expect(detectDeferreds).toHaveLength(2);

    // Resolve the newest request first, then the older one out of order: the
    // older, superseded discovery must never overwrite the newest mappings.
    await act(async () => {
      detectDeferreds[1].resolve(["packages/second"]);
      await secondSave;
    });
    await act(async () => {
      detectDeferreds[0].resolve(["packages/first"]);
      await firstSave;
    });
    await flushAsyncTurns();

    expect(mappingPaths(getWorkbench())).toEqual([
      "",
      "libs/second",
      "packages/second",
    ]);
  });

  it("drops an in-flight discovery result when the workspace switches mid-flight", async () => {
    const detectDeferreds: Array<{ rootPath: string; deferred: Deferred<string[]> }> =
      [];
    const detectRepositories = vi.fn(async (rootPath: string) => {
      const deferred = createDeferred<string[]>();
      detectDeferreds.push({ rootPath, deferred });
      return deferred.promise;
    });
    const gitGateway = stubGitGateway({ detectRepositories });
    const settingsByRoot: Record<string, WorkspaceSettings> = {
      "/workspace-a": {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: [],
        gitDirectoryMappingsAuto: true,
      },
      "/workspace-b": {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: [],
        gitDirectoryMappingsAuto: false,
      },
    };
    const settingsGateway: SettingsGateway = {
      loadAppSettings: vi.fn(async () => ({
        ...defaultAppSettings(),
        recentWorkspacePath: "/workspace-a",
        workspaceTabs: ["/workspace-a", "/workspace-b"],
      })),
      loadWorkspaceSettings: vi.fn(
        async (rootPath: string) =>
          settingsByRoot[rootPath] ?? defaultWorkspaceSettings(),
      ),
      saveAppSettings: vi.fn(async () => undefined),
      saveWorkspaceSettings: vi.fn(async () => undefined),
    };
    const { getWorkbench } = renderController({ gitGateway, settingsGateway });

    // Let workspace A open; resolve its open-time discovery so it settles.
    await flushAsyncTurns();
    const openA = detectDeferreds.find(
      (entry) => entry.rootPath === "/workspace-a",
    );
    expect(openA).toBeDefined();
    await act(async () => {
      openA?.deferred.resolve([]);
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-a");
    expect(mappingPaths(getWorkbench())).toEqual([""]);

    // Start a settings-save discovery on A and leave its detection pending.
    let saveA: Promise<void> | null = null;
    act(() => {
      saveA = getWorkbench().saveWorkbenchSettings(
        {
          ...defaultAppSettings(),
          recentWorkspacePath: "/workspace-a",
          workspaceTabs: ["/workspace-a", "/workspace-b"],
        },
        {
          ...defaultWorkspaceSettings(),
          gitDirectoryMappings: ["libs/a"],
          gitDirectoryMappingsAuto: true,
        },
        null,
      );
    });
    await flushAsyncTurns();
    const saveDetect = detectDeferreds.filter(
      (entry) => entry.rootPath === "/workspace-a",
    );
    expect(saveDetect.length).toBeGreaterThanOrEqual(2);

    // Switch to workspace B while A's discovery is still pending.
    await act(async () => {
      await getWorkbench().activateWorkspaceTab("/workspace-b");
    });
    await flushAsyncTurns();
    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");

    // Now resolve A's stale detection: it must be dropped, not published.
    await act(async () => {
      saveDetect[saveDetect.length - 1].deferred.resolve(["packages/stale"]);
      await saveA;
    });
    await flushAsyncTurns();

    expect(getWorkbench().workspaceRoot).toBe("/workspace-b");
    expect(mappingPaths(getWorkbench())).toEqual([""]);
    expect(mappingPaths(getWorkbench())).not.toContain("packages/stale");
  });

  it("resolves mappings from detected and manual settings on open (extraction preserves open behaviour)", async () => {
    const detectRepositories = vi.fn(async () => ["", "packages/api/.git"]);
    const gitGateway = stubGitGateway({ detectRepositories });
    const { getWorkbench } = renderController({
      gitGateway,
      appSettings: { ...defaultAppSettings(), recentWorkspacePath: "/workspace" },
      workspaceSettings: {
        ...defaultWorkspaceSettings(),
        gitDirectoryMappings: ["libs/manual"],
        gitDirectoryMappingsAuto: true,
      },
    });
    await flushAsyncTurns();

    expect(detectRepositories).toHaveBeenCalledWith("/workspace");
    expect(mappingPaths(getWorkbench())).toEqual([
      "",
      "libs/manual",
      "packages/api",
    ]);
  });
});

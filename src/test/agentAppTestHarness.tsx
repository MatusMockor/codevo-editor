import { act, StrictMode, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import type { AgentAppComposition } from "../agentAppComposition";
import { AgentAppShell } from "../AgentApp";
import type {
  AgentAppAgentGateways,
  AgentWorkspaceFiles,
  AgentWorkspaceOwnerFiles,
} from "../application/agentApp/agentAppPorts";
import {
  useAgentAppController,
  type AgentAppController,
} from "../application/agentApp/useAgentAppController";
import { QuickInputCoordinator } from "../application/quickInputCoordinator";
import { unavailableNodePackageScriptsWorkbenchGateway } from "../application/useNodePackageScriptWorkbench";
import { unavailableVscodeProcessTasksGateway } from "../application/workbenchUnavailableTaskGateways";
import type { WorkspaceIdentityGateway } from "../application/workspaceIdentityGatewayPort";
import { WorkspaceTrustPromptCoordinator } from "../application/workspaceTrustPrompt";
import type { AppUpdaterGateway } from "../domain/appUpdater";
import { emptyGitStatus, type GitGateway } from "../domain/git";
import type { AppSettings, SettingsGateway } from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type { FileEntry, FileSearchGateway } from "../domain/workspace";
import type {
  WorkspaceFileChangeEvent,
  WorkspaceFileChangeGateway,
} from "../domain/workspaceFileChange";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import {
  agentIdentityGateway,
  agentRuntimeLifecycleGateway,
  agentSettingsGateway,
  agentTrustGateway,
  fakeNativeShutdown,
} from "./agentAppWorkspaceHarness";
import { createStoppedTerminalGateway } from "./stoppedTerminalGateway";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export function agentAppFileChangeGateway() {
  const listeners = new Set<(event: WorkspaceFileChangeEvent) => void>();
  return {
    emit: (event: WorkspaceFileChangeEvent) => {
      for (const listener of [...listeners]) listener(event);
    },
    listenerCount: () => listeners.size,
    startWatching: vi.fn(async (_rootPath: string) => undefined),
    subscribeFileChanges: vi.fn(async (listener: (event: WorkspaceFileChangeEvent) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
  } satisfies WorkspaceFileChangeGateway & {
    readonly emit: unknown;
    readonly listenerCount: unknown;
  };
}

export interface AgentAppTestOptions {
  readonly agentGateways?: Partial<AgentAppAgentGateways>;
  readonly appSettings?: AppSettings;
  readonly directoryEntries?: Readonly<Record<string, readonly FileEntry[]>>;
  readonly fileChanges?: WorkspaceFileChangeGateway;
  readonly fileSearch?: FileSearchGateway;
  readonly nodePackageScriptsGateway?: AgentAppComposition["nodePackageScriptsGateway"];
  readonly gitGateway?: GitGateway;
  readonly identityGateway?: WorkspaceIdentityGateway;
  readonly runtimeLifecycleGateway?: WorkspaceRuntimeLifecycleGateway;
  readonly settingsGateway?: SettingsGateway;
  readonly strictMode?: boolean;
  readonly terminalGateway?: TerminalGateway;
  readonly trustGateway?: WorkspaceTrustGateway;
}

export function agentAppGitGateway(overrides: Partial<GitGateway> = {}): GitGateway {
  const status = (rootPath: string) => emptyGitStatus(rootPath);
  return {
    branchList: vi.fn(async () => []),
    commit: vi.fn(async (rootPath: string) => status(rootPath)),
    createBranch: vi.fn(async () => undefined),
    currentBranch: vi.fn(async () => null),
    getDiff: vi.fn(async (_rootPath, change) => ({
      change,
      language: "plaintext",
      modifiedContent: "",
      originalContent: "",
    })),
    getStatus: vi.fn(async (rootPath: string) => status(rootPath)),
    push: vi.fn(async (rootPath: string) => status(rootPath)),
    stageFiles: vi.fn(async (rootPath: string) => status(rootPath)),
    switchBranch: vi.fn(async () => undefined),
    ...overrides,
  };
}

function unconfiguredFileOperation(): never {
  throw new Error("This agent app test does not configure workspace file writes.");
}

export function agentAppWorkspaceFiles(
  entriesByDirectory: Readonly<Record<string, readonly FileEntry[]>> = {},
): AgentWorkspaceFiles {
  return {
    readDirectory: vi.fn(async (path: string) => [...(entriesByDirectory[path] ?? [])]),
    readDirectoryBounded: vi.fn(async (path: string, maxEntries: number) => {
      const entries = entriesByDirectory[path] ?? [];
      return { entries: entries.slice(0, maxEntries), truncated: entries.length > maxEntries };
    }),
  };
}

const unconfiguredOwnerFiles: AgentWorkspaceOwnerFiles = {
  createDirectoryForWorkspace: async () => unconfiguredFileOperation(),
  createTextFileWithContentForWorkspace: async () => unconfiguredFileOperation(),
};

export function agentAppProviderGateway(): NonNullable<
  AgentAppAgentGateways["agentProviderGateway"]
> {
  return {
    currentAgentProviderPolicy: async ({ provider }) => ({ kind: "unregistered", provider }),
    registerAgentProviderPolicy: async (request) => ({
      provider: request.provider,
      settingsRevision: request.settingsRevision,
      providerGeneration: 1,
    }),
    checkAgentProviderUpdates: async () => ({
      update: { kind: "checksDisabled" as const },
      checkedAtEpochMs: 0,
    }),
    probeAgentProviderHealth: async () => ({
      installedVersion: null,
      auth: { kind: "unknown" },
      update: { kind: "checksDisabled" },
      checkedAtEpochMs: 1,
    }),
    updateAgentProvider: async () => ({
      kind: "failed",
      reason: "authorityChanged",
      outputTail: "",
      outputTruncated: false,
    }),
  };
}

export function agentAppRootLeaseGateway(): NonNullable<
  AgentAppAgentGateways["agentRootLeaseGateway"]
> {
  let nextToken = 0;
  return {
    acquireAgentRootLease: async (request) => {
      nextToken += 1;
      return { leaseToken: nextToken, workspaceId: `workspace:${request.rootPath}` };
    },
    releaseAgentRootLease: async (request) => ({
      kind: "released",
      leaseToken: request.leaseToken,
    }),
  };
}

function idleAppUpdaterGateway(): AppUpdaterGateway {
  return {
    check: vi.fn(async () => ({ currentVersion: "0.0.0-test", kind: "upToDate" as const })),
    dispose: vi.fn(async () => undefined),
    download: vi.fn(async () => {
      throw new Error("No update is available in this test.");
    }),
    installAndRestart: vi.fn(async () => undefined),
  };
}

export function createAgentAppTestComposition(options: AgentAppTestOptions = {}) {
  const settings = options.settingsGateway ?? agentSettingsGateway(options.appSettings).gateway;
  const quickInputCoordinator = new QuickInputCoordinator();
  const fileChanges = options.fileChanges ?? {
    startWatching: vi.fn(async () => undefined),
    subscribeFileChanges: vi.fn(async () => () => undefined),
  };
  const fileSearch: FileSearchGateway = options.fileSearch ?? {
    searchFiles: vi.fn(async () => []),
  };
  const gitGateway = options.gitGateway ?? agentAppGitGateway();
  const nativeShutdown = fakeNativeShutdown();
  const composition = {
    agentGateways: {
      agentProviderGateway: agentAppProviderGateway(),
      agentRootLeaseGateway: agentAppRootLeaseGateway(),
      ...options.agentGateways,
    },
    agentSurfaceGateways: {
      fileChanges,
      fileSearch,
      gitBranchGateway: null,
      gitHistoryGateway: null,
      questionGateway: null,
    },
    appUpdater: {
      appUpdaterGateway: idleAppUpdaterGateway(),
      appUpdaterPreferencesGateway: { loadSkippedVersion: vi.fn(async () => null) },
      appVersion: "0.0.0-test",
    },
    gitGateway,
    isBenignError: (error: unknown) => error === null || error === undefined,
    nativeShutdown,
    nativeWindow: null,
    nodePackageScriptsGateway:
      options.nodePackageScriptsGateway ?? unavailableNodePackageScriptsWorkbenchGateway,
    quickInputCoordinator,
    settingsGateway: settings,
    systemFontGateway: { listMonospaceFontFamilies: vi.fn(async () => []) },
    terminalGateway: options.terminalGateway ?? createStoppedTerminalGateway(),
    vscodeProcessTasksGateway: unavailableVscodeProcessTasksGateway,
    workbenchPrompter: { confirm: vi.fn(() => true), prompt: vi.fn(() => null) },
    workspace: {
      fileChanges,
      fileSearch,
      files: agentAppWorkspaceFiles(options.directoryEntries),
      identity: options.identityGateway ?? agentIdentityGateway(),
      ownerFiles: unconfiguredOwnerFiles,
    },
    workspaceRuntimeLifecycleGateway:
      options.runtimeLifecycleGateway ?? agentRuntimeLifecycleGateway(),
    workspaceTrustGateway: options.trustGateway ?? agentTrustGateway(),
    workspaceTrustPrompt: new WorkspaceTrustPromptCoordinator(),
  } satisfies AgentAppComposition;
  return composition;
}

const mountedRoots = new Set<Root>();
const mountedHosts = new Set<HTMLElement>();

export function unmountAgentAppHarnesses(): void {
  for (const root of mountedRoots) act(() => root.unmount());
  mountedRoots.clear();
  for (const host of mountedHosts) host.remove();
  mountedHosts.clear();
}

function mount(element: ReactNode, strictMode: boolean) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.add(root);
  mountedHosts.add(host);
  act(() => root.render(strictMode ? <StrictMode>{element}</StrictMode> : element));
  return {
    host,
    unmount: () => {
      act(() => root.unmount());
      mountedRoots.delete(root);
      mountedHosts.delete(host);
      host.remove();
    },
  };
}

export function renderAgentAppController(options: AgentAppTestOptions = {}) {
  const composition = createAgentAppTestComposition(options);
  const captured: { current: AgentAppController | null } = { current: null };

  function ControllerProbe() {
    captured.current = useAgentAppController(composition);
    return null;
  }

  const mounted = mount(<ControllerProbe />, options.strictMode ?? false);
  const current = () => {
    if (!captured.current) throw new Error("Agent app controller is not mounted");
    return captured.current;
  };
  return { composition, current, unmount: mounted.unmount };
}

export async function preloadAgentAppSurfaces(): Promise<void> {
  await Promise.all([
    import("../components/agentMode/AgentWorkbenchScreen"),
    import("../components/commandPalette/CommandPaletteHost"),
    import("../components/TerminalTabsPanel"),
    import("../components/WorkbenchSettingsHost"),
  ]);
}

export async function renderAgentApp(options: AgentAppTestOptions = {}) {
  await preloadAgentAppSurfaces();
  const composition = createAgentAppTestComposition(options);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  mountedRoots.add(root);
  mountedHosts.add(host);
  const element = <AgentAppShell composition={composition} />;
  await act(async () => {
    root.render(options.strictMode === false ? element : <StrictMode>{element}</StrictMode>);
    for (let turn = 0; turn < 48; turn += 1) await Promise.resolve();
  });
  return { composition, host };
}

export async function settleAgentApp(turns = 24): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
  });
}

export async function actAndSettle(work: () => void, turns = 24): Promise<void> {
  await act(async () => {
    work();
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
  });
}

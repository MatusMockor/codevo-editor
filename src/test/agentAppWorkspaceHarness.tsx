import { act, StrictMode, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { vi } from "vitest";
import {
  defaultAppSettings,
  defaultWorkspaceSettings,
  type AppSettings,
  type SettingsGateway,
  type WorkspaceSettings,
  type WorkspaceSettingsIdentity,
} from "../domain/settings";
import type { TerminalGateway } from "../domain/terminal";
import type { WorkspaceTrustGateway } from "../domain/trust";
import type { FileEntry } from "../domain/workspace";
import type { WorkspaceRuntimeLifecycleGateway } from "../domain/workspaceRuntimeLifecycle";
import type {
  AgentScriptsWorkspaceReader,
  AgentWorkspaceRuntimeGateways,
} from "../application/agentApp/agentWorkspaceRuntimes";
import type { AgentNativeShutdownPort } from "../application/agentApp/useAgentApplicationShutdown";
import {
  useAgentCloseLifecycle,
  type AgentCloseLifecycle,
} from "../application/agentApp/useAgentCloseLifecycle";
import {
  useAgentWorkspaceAuthority,
  type AgentWorkspaceAuthority,
} from "../application/agentApp/useAgentWorkspaceAuthority";
import {
  useAgentWorkspaceTransition,
  type AgentWorkspaceGitDiscoveryPort,
  type AgentWorkspaceTransition,
} from "../application/agentApp/useAgentWorkspaceTransition";
import type { AgentProjectsSurface } from "../application/useAgentProjects";
import type {
  WorkspaceAdmissionAdoptionResult,
  WorkspaceIdentityDescriptor,
  WorkspaceIdentityGateway,
  WorkspaceOwnerReleaseResult,
} from "../application/workspaceIdentityGatewayPort";
import { boundedPendingWorkspaceSettingsLoadsFor } from "../application/workbenchController/boundedPendingWorkspaceSettingsLoads";
import { useWorkbenchSettingsPersistence } from "../application/workbenchController/useWorkbenchSettingsPersistence";
import { createWorkspaceSettingsByRootSnapshot } from "../application/workspaceSettingsForRoot";
import { createWorkspaceSettingsSaveCoordinator } from "../application/workspaceSettingsSaveCoordinator";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

export interface Deferred<T> {
  readonly promise: Promise<T>;
  readonly reject: (error: unknown) => void;
  readonly resolve: (value: T) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((settle, fail) => {
    resolve = settle;
    reject = fail;
  });
  return { promise, reject, resolve };
}

export async function flushAgentTurns(turns = 24): Promise<void> {
  await act(async () => {
    for (let turn = 0; turn < turns; turn += 1) await Promise.resolve();
  });
}

export function agentDescriptor(
  workspaceId: string,
  root: string,
  admissionToken = 1,
): WorkspaceIdentityDescriptor {
  return {
    admissionToken,
    workspaceId,
    selectedPath: root,
    canonicalRoot: root,
    caseSensitive: true,
    unicodeNormalizationPolicy: "preserved",
    policy: { caseSensitive: true, unicodeNormalization: "none" },
  };
}

async function releasedOwner(): Promise<WorkspaceOwnerReleaseResult> {
  return { status: "released" };
}

async function adoptedAdmission(): Promise<WorkspaceAdmissionAdoptionResult> {
  return { status: "adopted" };
}

export function agentIdentityGateway(
  overrides: Partial<WorkspaceIdentityGateway> = {},
): WorkspaceIdentityGateway {
  let nextToken = 0;
  return {
    adoptAdmission: vi.fn(adoptedAdmission),
    getDescriptor: vi.fn(),
    openFromPicker: vi.fn(async () => ({ status: "cancelled" as const })),
    openPath: vi.fn(async (path: string) => {
      nextToken += 1;
      return agentDescriptor(path.replace(/^\/+/, "") || "workspace", path, nextToken);
    }),
    rollbackAdmission: vi.fn(releasedOwner),
    unregister: vi.fn(releasedOwner),
    ...overrides,
  };
}

export function agentSettingsGateway(initialAppSettings: AppSettings = defaultAppSettings()) {
  const saved = {
    app: initialAppSettings,
    workspaces: new Map<string, WorkspaceSettings>(),
  };
  const gateway = {
    loadAppSettings: vi.fn<SettingsGateway["loadAppSettings"]>(async () => saved.app),
    loadWorkspaceSettings: vi.fn<SettingsGateway["loadWorkspaceSettings"]>(
      async (identity) => saved.workspaces.get(settingsKey(identity)) ?? defaultWorkspaceSettings(),
    ),
    saveAppSettings: vi.fn<SettingsGateway["saveAppSettings"]>(async (settings) => {
      saved.app = settings;
    }),
    saveWorkspaceSettings: vi.fn<SettingsGateway["saveWorkspaceSettings"]>(
      async (identity, settings) => {
        saved.workspaces.set(settingsKey(identity), settings);
      },
    ),
  };
  return { gateway, saved };
}

function settingsKey(identity: string | WorkspaceSettingsIdentity): string {
  return typeof identity === "string" ? identity : identity.canonicalKey;
}

export function agentTrustGateway(overrides: Partial<WorkspaceTrustGateway> = {}) {
  return {
    getTrust: vi.fn(async (rootPath: string) => ({ rootPath, trusted: true })),
    setTrust: vi.fn(async (rootPath: string, trusted: boolean) => ({ rootPath, trusted })),
    ...overrides,
  } satisfies WorkspaceTrustGateway;
}

export function agentRuntimeLifecycleGateway(
  overrides: Partial<WorkspaceRuntimeLifecycleGateway> = {},
) {
  return {
    disposeRegisteredWorkspace: vi.fn<
      NonNullable<WorkspaceRuntimeLifecycleGateway["disposeRegisteredWorkspace"]>
    >(async () => ({ status: "closed" })),
    disposeWorkspace: vi.fn(async (_rootPath: string) => undefined),
    ...overrides,
  } satisfies WorkspaceRuntimeLifecycleGateway;
}

export function agentScriptsReader(
  entriesByRoot: Readonly<Record<string, readonly FileEntry[]>> = {},
): AgentScriptsWorkspaceReader & { readonly readDirectoryBounded: ReturnType<typeof vi.fn> } {
  return {
    readDirectoryBounded: vi.fn(async (path: string) => ({
      entries: entriesByRoot[path] ?? [],
      truncated: false,
    })),
  };
}

export function fakeNativeShutdown(): AgentNativeShutdownPort & {
  readonly emit: (payload: unknown) => void;
  readonly confirmShutdown: ReturnType<typeof vi.fn>;
  readonly quit: ReturnType<typeof vi.fn>;
  readonly setCloseListenerReady: ReturnType<typeof vi.fn>;
} {
  let handler: (payload: unknown) => void = () => undefined;
  return {
    available: () => true,
    confirmShutdown: vi.fn(async () => undefined),
    emit: (payload) => handler(payload),
    listenCloseRequests: async (listener) => {
      handler = listener;
      return () => {
        handler = () => undefined;
      };
    },
    quit: vi.fn(async () => undefined),
    setCloseListenerReady: vi.fn(async () => undefined),
  };
}

export interface AgentWorkspaceHarnessOptions {
  readonly appSettings?: AppSettings;
  readonly gitDemanded?: boolean;
  readonly identityGateway?: WorkspaceIdentityGateway;
  readonly nativeShutdown?: AgentNativeShutdownPort;
  readonly prepareAgentQuit?: (budgetMs: number) => Promise<void>;
  readonly projects?: Pick<AgentProjectsSurface, "closeWorkspaceProject">;
  readonly releaseRetryDelay?: (delayMs: number) => Promise<void>;
  readonly runtimeLifecycleGateway?: WorkspaceRuntimeLifecycleGateway;
  readonly scriptsReader?: AgentScriptsWorkspaceReader;
  readonly settingsGateway?: SettingsGateway;
  readonly strictMode?: boolean;
  readonly terminalGateway?: Pick<TerminalGateway, "stopRoot">;
  readonly trustGateway?: WorkspaceTrustGateway;
}

interface HarnessSnapshot {
  appSettings: AppSettings;
  authority: AgentWorkspaceAuthority;
  close: AgentCloseLifecycle;
  hydrated: boolean;
  persistWorkspaceSettings: (rootPath: string, settings: WorkspaceSettings) => Promise<void>;
  transition: AgentWorkspaceTransition;
  workspaceSettings: WorkspaceSettings;
}

const mountedRoots = new Set<Root>();

export function unmountAgentWorkspaceHarnesses(): void {
  for (const root of mountedRoots) act(() => root.unmount());
  mountedRoots.clear();
}

export function renderAgentWorkspaceHarness(options: AgentWorkspaceHarnessOptions = {}) {
  const settings = options.settingsGateway ?? agentSettingsGateway(options.appSettings).gateway;
  const identityGateway = options.identityGateway ?? agentIdentityGateway();
  const trustGateway = options.trustGateway ?? agentTrustGateway();
  const runtimeLifecycleGateway = options.runtimeLifecycleGateway ?? agentRuntimeLifecycleGateway();
  const terminalGateway = options.terminalGateway ?? { stopRoot: vi.fn(async () => undefined) };
  const scriptsReader = options.scriptsReader ?? agentScriptsReader();
  const nativeShutdown = options.nativeShutdown ?? fakeNativeShutdown();
  const prepareAgentQuit = options.prepareAgentQuit ?? vi.fn(async () => undefined);
  const projects = options.projects ?? {};
  const errors: Array<{ readonly source: string; readonly error: unknown }> = [];
  const reportError = (source: string, error: unknown) => {
    errors.push({ source, error });
  };
  const gitDemandRef = { current: options.gitDemanded ?? false };
  const git = {
    isDemanded: () => gitDemandRef.current,
    reset: vi.fn<AgentWorkspaceGitDiscoveryPort["reset"]>(),
    runDiscovery: vi.fn<AgentWorkspaceGitDiscoveryPort["runDiscovery"]>(async () => undefined),
  } satisfies AgentWorkspaceGitDiscoveryPort;
  const runtimeGateways: AgentWorkspaceRuntimeGateways = {
    runtimeLifecycle: runtimeLifecycleGateway,
    terminal: terminalGateway,
  };
  const captured: { current: HarnessSnapshot | null } = { current: null };

  function Harness() {
    const [appSettings, setAppSettings] = useState<AppSettings>(defaultAppSettings);
    const [workspaceSettings, setWorkspaceSettings] =
      useState<WorkspaceSettings>(defaultWorkspaceSettings);
    const [hydrated, setHydrated] = useState(false);
    const appSettingsRef = useRef(appSettings);
    const workspaceSettingsRef = useRef(workspaceSettings);
    const hasRestoredRef = useRef(false);
    const workspaceSettingsByRoot = useMemo(() => createWorkspaceSettingsByRootSnapshot(), []);
    const workspaceSettingsSaveCoordinator = useMemo(
      () => createWorkspaceSettingsSaveCoordinator(),
      [],
    );
    const workspaceSettingsLoadByRootRef = useRef(
      boundedPendingWorkspaceSettingsLoadsFor(settings),
    );
    const authority = useAgentWorkspaceAuthority({
      identityGateway,
      releaseRetryDelay: options.releaseRetryDelay,
      reportError,
    });
    const persistence = useWorkbenchSettingsPersistence({
      appSettingsRef,
      currentWorkspaceRootRef: authority.currentWorkspaceRootRef,
      reportError,
      setAppSettings,
      setWorkspaceSettings,
      settingsGateway: settings,
      workspaceIdentityByRootRef: authority.workspaceIdentityByRootRef,
      workspaceSettingsByRoot,
      workspaceSettingsRef,
      workspaceSettingsSaveCoordinator,
    });
    const settingsPort = useMemo(
      () => ({
        appSettingsRef,
        applyAppSettings: persistence.applyAppSettings,
        applyWorkspaceSettings: persistence.applyWorkspaceSettings,
        persistAppSettings: persistence.persistAppSettings,
        settingsGateway: settings,
        workspaceSettingsByRoot,
        workspaceSettingsLoadByRootRef,
        workspaceSettingsRef,
        workspaceSettingsSaveCoordinator,
      }),
      [
        persistence.applyAppSettings,
        persistence.applyWorkspaceSettings,
        persistence.persistAppSettings,
        workspaceSettingsByRoot,
        workspaceSettingsSaveCoordinator,
      ],
    );
    const startup = useMemo(() => ({ hasRestoredRef, onAppSettingsHydrated: setHydrated }), []);
    const transition = useAgentWorkspaceTransition({
      authority,
      git,
      identityGateway,
      reportError,
      runtimeGateways,
      scriptsWorkspaceReader: scriptsReader,
      settings: settingsPort,
      startup,
      trustGateway,
    });
    const close = useAgentCloseLifecycle({
      appSettingsRef,
      authority,
      forgetWorkspaceSettings: workspaceSettingsByRoot.forget,
      nativeShutdown,
      persistAppSettings: persistence.persistAppSettings,
      prepareAgentQuit,
      projects,
      reportError,
      runtimeGateways,
      runtimeLifecycleGateway,
      transition,
    });
    captured.current = {
      appSettings,
      authority,
      close,
      hydrated,
      persistWorkspaceSettings: persistence.persistWorkspaceSettings,
      transition,
      workspaceSettings,
    };
    return null;
  }

  const root = createRoot(document.createElement("div"));
  mountedRoots.add(root);
  act(() =>
    root.render(
      options.strictMode ? (
        <StrictMode>
          <Harness />
        </StrictMode>
      ) : (
        <Harness />
      ),
    ),
  );
  const current = () => {
    if (!captured.current) throw new Error("Agent workspace harness is not mounted");
    return captured.current;
  };
  return {
    current,
    errors,
    git,
    gitDemandRef,
    identityGateway,
    nativeShutdown,
    prepareAgentQuit,
    runtimeLifecycleGateway,
    scriptsReader,
    settingsGateway: settings,
    terminalGateway,
    trustGateway,
    unmount: () => {
      act(() => root.unmount());
      mountedRoots.delete(root);
    },
  };
}

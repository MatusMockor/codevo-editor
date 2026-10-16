import { useLocalAgentTurnChanges } from "./useLocalAgentTurnChanges";
import type { AgentTurnChangesGateway } from "../domain/agentTurnChanges";
import type { ExternalSessionImportGateway } from "../domain/externalSessionImport";
import { useAgentThreadHistory } from "./useAgentThreadHistory";
import { useAgentHistoryCatalog } from "./useAgentHistoryCatalog";
import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import type { AgentAccountUsageObservation } from "../domain/agentAccountUsage";
import type { AgentCliKind, AgentTaskGateway } from "../domain/agentTask";
import type { AgentThreadSessionGateway } from "../domain/agentThreadSession";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import { lastUsedAgentLaunch } from "../domain/agentThread";
import { normalizeAgentCliKind, normalizeMaxConcurrentAgentTasks } from "../domain/agentSettings";
import type { GitGateway } from "../domain/git";
import type { GitIntegrationGateway } from "../domain/gitIntegration";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import type {
  AgentRepositoryStatusSnapshot,
  AgentTasksNotice,
  AgentThreadStoreGateway,
  AgentThreadStoreSurface,
  AgentThreadsSurface,
  ExternalSessionGateway,
  ExternalSessionsSurface,
} from "./agentThreadPorts";
import { AGENT_TASKS_SOURCE } from "./agentProjectAuthority";
import { refuseLocalAttachmentDownload } from "./remoteAttachmentDownload";
import {
  countRunningTurns,
  countRunningTurnsInRepository,
  type AgentTurnAdmissionDependencies,
} from "./agentTurnAdmission";
import type { AgentAttachmentGateway } from "./agentAttachmentPorts";
import type { AgentInlineImageGateway } from "./agentInlineImagePorts";
import type { AgentThreadRequestFeed } from "./agentThreadRequestPorts";
import { agentThreadHasPendingInput } from "./agentThreadPendingInput";
import type { AgentImageSurfacePort } from "../domain/agentImageShrink";
import { useExternalSessions } from "./useExternalSessions";
import { useImportedThreadHistory } from "./useImportedThreadHistory";
import { useAgentChangeSummary } from "./useAgentChangeSummary";
import { useAgentFileNavigation, type AgentFileNavigationPort } from "./useAgentFileNavigation";
import { useAgentIsolationPreview } from "./useAgentIsolationPreview";
import { useAgentShipFlow, type ExternalUrlOpenerPort } from "./useAgentShipFlow";
import { isLoggedAgentThread, useAgentThreadStore } from "./useAgentThreadStore";
import { useAgentTurnLogging } from "./useAgentTurnLogging";
import {
  defaultAgentTurnLogGateway,
  defaultSessionImportGateway,
  defaultHistoryCatalogGateway,
} from "./agentApp/agentDefaultGateways";
import { AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS, type AgentTurnLogGateway } from "./agentTurnLogPorts";
import { useAgentTurnDispatch } from "./useAgentTurnDispatch";
import {
  useAgentThreadSessions,
  type AgentThreadSessionDispatchPorts,
} from "./useAgentThreadSessions";
import { useAgentSessionBackgrounds } from "./useAgentSessionBackgrounds";
import { flattenProjectRepositories } from "./agentThreadViewProjection";
import { useAgentWorktreeLifecycle } from "./useAgentWorktreeLifecycle";
import { useAgentExternalSessionImport } from "./agentThreads/useAgentExternalSessionImport";
import { useAgentThreadViews } from "./agentThreads/useAgentThreadViews";
import { useAgentThreadAttachments } from "./agentThreads/useAgentThreadAttachments";
import { useAgentThreadCommands } from "./agentThreads/useAgentThreadCommands";
import { useAgentTurnTerminalReconcile } from "./agentThreads/useAgentTurnTerminalReconcile";
export {
  IMPORT_CLI_NOT_CONFIGURED_NOTICE,
  IMPORT_DUPLICATE_NOTICE,
  IMPORT_INVALID_SESSION_NOTICE,
  IMPORT_PROJECT_UNAVAILABLE_NOTICE,
  IMPORT_PROVIDER_MISMATCH_NOTICE,
  IMPORT_STORE_NOT_READY_NOTICE,
} from "./agentThreads/useAgentExternalSessionImport";
import { createAgentWorktreeUseRegistry } from "./agentWorktreeUseRegistry";
import type { WorkbenchPrompter } from "./workbenchPrompter";
import type { AgentProviderAdmissionAuthorityReader } from "./agentProviderAdmissionAuthority";

export type AgentThreadsGitGateway = Pick<
  GitGateway,
  "getStatus" | "getDiff" | "stageFiles" | "commit" | "deleteBranch"
>;

export interface AgentThreadsDependencies {
  readonly turnChangesGateway?: AgentTurnChangesGateway;
  readonly externalSessionImportGateway?: ExternalSessionImportGateway;
  readonly agentTaskGateway: AgentTaskGateway;
  readonly agentThreadSessionGateway?: AgentThreadSessionGateway;
  readonly agentThreadRequestFeed?: AgentThreadRequestFeed;
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
  readonly agentImageSurface?: AgentImageSurfacePort;
  readonly agentInlineImageGateway?: AgentInlineImageGateway;
  readonly agentThreadStoreGateway: AgentThreadStoreGateway;
  readonly agentTurnLogGateway?: AgentTurnLogGateway;
  readonly externalSessionGateway?: ExternalSessionGateway;
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly gitGateway: AgentThreadsGitGateway;
  readonly gitIntegrationGateway: GitIntegrationGateway;
  readonly externalUrlOpener: ExternalUrlOpenerPort | null;
  readonly fileNavigationPort: AgentFileNavigationPort | null;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly getAgentCliKind: () => AgentCliKind;
  readonly currentCliVersion: (provider: AgentCliKind) => string | null;
  readonly getAgentProviderAdmissionAuthority: AgentProviderAdmissionAuthorityReader;
  readonly getMaxConcurrentAgentTasks: () => number;
  readonly getRepositoryStatus: (repositoryRoot: string) => AgentRepositoryStatusSnapshot;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
  readonly onAccountUsageObserved?: (observation: AgentAccountUsageObservation) => void;
  readonly onProviderTurnCompleted?: (provider: AgentCliKind) => void;
  readonly ensureProjectLease?: (projectRootKey: string) => Promise<boolean>;
  readonly ensureProjectLaunchIdentity?: AgentTurnAdmissionDependencies["ensureProjectLaunchIdentity"];
  readonly launchIdentityForProject: AgentTurnAdmissionDependencies["launchIdentityForProject"];
  readonly reportError: (source: string, error: unknown) => void;
  readonly openAgentSettings: () => void;
  readonly now?: () => number;
  readonly createEntropyHex4?: () => string;
}

const UNWIRED_EXTERNAL_SESSION_GATEWAY: ExternalSessionGateway = {
  listExternalSessions: () =>
    Promise.reject(new Error("The external session gateway is not wired.")),
  previewExternalSession: () =>
    Promise.reject(new Error("The external session gateway is not wired.")),
};

export interface AgentThreadsHookSurface extends AgentThreadsSurface {
  readonly externalSessions: ExternalSessionsSurface;
  togglePin(threadId: string): void;
  archive(threadId: string): boolean;
  unarchive(threadId: string): boolean;
  remove(threadId: string): boolean;
}

export function useAgentThreads(dependencies: AgentThreadsDependencies): AgentThreadsHookSurface {
  const [notice, setNotice] = useState<AgentTasksNotice | null>(null);
  const { projects, reportError, gitGateway, onAccountUsageObserved, onProviderTurnCompleted } =
    dependencies;

  const storeRef = useRef<AgentThreadStoreSurface | null>(null);
  const turnLog = useAgentTurnLogging({
    gateway: dependencies.agentTurnLogGateway ?? defaultAgentTurnLogGateway,
    projects,
    now: dependencies.now,
    loggedThreadRootKey: (threadId) => loggedThreadRootKey(storeRef.current, threadId),
  });
  const store = useAgentThreadStore({
    agentThreadStoreGateway: dependencies.agentThreadStoreGateway,
    projects,
    reportError,
    setNotice,
    now: dependencies.now,
    turnLog,
  });
  storeRef.current = store;
  const threads = store.state.threads;
  const [worktreeUses] = useState(createAgentWorktreeUseRegistry);
  const storeCurrentState = store.currentState;
  const currentThreads = useCallback(() => storeCurrentState().threads, [storeCurrentState]);
  const durableHistory = dependencies.agentThreadStoreGateway.readAgentHistoryTurns !== undefined;
  const importGateway =
    dependencies.externalSessionImportGateway ??
    (durableHistory ? defaultSessionImportGateway : undefined);
  const history = useAgentThreadHistory({
    projects,
    threads,
    gateway: dependencies.agentThreadStoreGateway,
    currentState: store.currentState,
    reportError,
    turnLog,
  });
  const externalHistory = useImportedThreadHistory({
    projects,
    threads,
    gateway: dependencies.externalSessionGateway,
    importGateway,
    currentState: store.currentState,
    dispatchAction: store.dispatchAction,
    reportError,
  });
  const ensureExternalHistory = externalHistory.ensure;

  const turnChanges = useLocalAgentTurnChanges({
    gateway: dependencies.turnChangesGateway ?? null,
    projects,
    threads,
    historyPage: history.page,
  });
  const changes = useAgentChangeSummary({ gitGateway, projects, threads, reportError });

  const worktrees = useAgentWorktreeLifecycle({
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    gitGateway,
    prompter: dependencies.prompter,
    projects,
    threads,
    loadedRootKeys: store.loadedRootKeys,
    reportError,
    setNotice,
    onWorktreeRemovalChanged: changes.setRemoving,
    onWorktreeRemoved: changes.clear,
    worktreeUses,
    currentThreads,
  });

  const liveAgentTasksInRepository = useCallback(
    (repositoryRoot: string): number => countRunningTurnsInRepository(store.state, repositoryRoot),
    [store.state],
  );

  const isolation = useAgentIsolationPreview({
    projects,
    gitGateway,
    getRepositoryStatus: dependencies.getRepositoryStatus,
    liveAgentTasksInRepository,
    reportError,
  });

  const { refreshOrphanedWorktrees, missingWorktreeThreadIds, markWorktreeRemoved } = worktrees;
  const { refreshVisibleChanges } = changes;
  const { dispatchAction } = store;

  const ship = useAgentShipFlow({
    gitGateway,
    gitIntegrationGateway: dependencies.gitIntegrationGateway,
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    externalUrlOpener: dependencies.externalUrlOpener,
    prompter: dependencies.prompter,
    projects,
    threads,
    missingWorktreeThreadIds,
    dispatchThreadAction: dispatchAction,
    reportError,
    setNotice,
    onWorktreeRemoved: markWorktreeRemoved,
    onShipStepCompleted: (threadId) => void refreshVisibleChanges(threadId),
    now: dependencies.now,
    worktreeUses,
    currentThreads,
  });

  const editor = useAgentFileNavigation({
    projects,
    threads,
    navigation: dependencies.fileNavigationPort,
    reportError,
  });

  const isWorktreeMissing = useCallback(
    (threadId: string): boolean => missingWorktreeThreadIds.has(threadId),
    [missingWorktreeThreadIds],
  );

  const { states: shipStates, refreshShipStatus, clear: clearShip } = ship;

  const { onTurnTerminal, onWorktreeDispatchFailed } = useAgentTurnTerminalReconcile({
    threads,
    onProviderTurnCompleted,
    refreshOrphanedWorktrees,
    refreshVisibleChanges,
    refreshShipStatus,
  });

  const agentCliKind = normalizeAgentCliKind(dependencies.getAgentCliKind());
  const agentCliVersion = dependencies.currentCliVersion(agentCliKind);
  const agentCliConfigured =
    dependencies.getAgentProviderAdmissionAuthority(agentCliKind).disposition.kind === "ready";

  const { attachments, attachmentImages, inlineImages, questionAttachments, revealAttachment } =
    useAgentThreadAttachments({
      store,
      projects,
      attachmentGateway: dependencies.agentAttachmentGateway ?? null,
      imageSurface: dependencies.agentImageSurface ?? null,
      inlineImageGateway: dependencies.agentInlineImageGateway ?? null,
      launchIdentityForProject: dependencies.launchIdentityForProject,
      reportError,
    });

  const sessionDispatchRef = useRef<AgentThreadSessionDispatchPorts | null>(null);
  const {
    backgrounds: sessionBackgrounds,
    recovered: sessionBackgroundsRecovered,
    watchSession,
    ownerHasLiveSession,
  } = useAgentSessionBackgrounds(
    dependencies.agentThreadSessionGateway,
    dependencies.now ?? Date.now,
    (error) => reportError(AGENT_TASKS_SOURCE, error),
  );
  const sessions = useAgentThreadSessions({
    gateway: dependencies.agentThreadSessionGateway,
    projects,
    store,
    historyCatalog: durableHistory ? defaultHistoryCatalogGateway : undefined,
    dispatch: sessionDispatchRef,
    setNotice,
    reportError,
    now: dependencies.now,
    watchSession,
  });
  const { endThreadSession } = sessions;

  const dispatch = useAgentTurnDispatch({
    agentTaskGateway: dependencies.agentTaskGateway,
    inspectSessionRestart: sessions.inspectRestart,
    hasPendingThreadInput: (threadId) =>
      agentThreadHasPendingInput(
        dependencies.agentThreadRequestFeed,
        store.state.threads.get(threadId),
      ),
    agentAttachmentGateway: dependencies.agentAttachmentGateway,
    gitWorktreeGateway: dependencies.gitWorktreeGateway,
    projects,
    store,
    getAgentCliKind: dependencies.getAgentCliKind,
    getAgentProviderAdmissionAuthority: dependencies.getAgentProviderAdmissionAuthority,
    getMaxConcurrentAgentTasks: dependencies.getMaxConcurrentAgentTasks,
    preflightInPlace: isolation.preflightInPlace,
    isWorktreeMissing,
    retainUncertainWorktree: worktrees.retainUncertainWorktree,
    onWorktreeCreated: worktrees.noteCreatedWorktree,
    worktreeUses,
    currentCliVersion: dependencies.currentCliVersion,
    onWorktreeDispatchFailed,
    onTurnTerminal,
    onAccountUsageObserved,
    onProjectDispatchTrustRejected: dependencies.onProjectDispatchTrustRejected,
    ensureProjectLease: dependencies.ensureProjectLease,
    ensureProjectLaunchIdentity: dependencies.ensureProjectLaunchIdentity,
    launchIdentityForProject: dependencies.launchIdentityForProject,
    reportError,
    setNotice,
    now: dependencies.now,
    createEntropyHex4: dependencies.createEntropyHex4,
  });

  sessionDispatchRef.current = dispatch;

  const {
    remove,
    togglePin,
    archive,
    unarchive,
    releaseProjectTasks,
    hasLiveTasksForOwner,
    markThreadViewed,
    markThreadUnread,
    updateThreadOrganization,
    reorderThread,
    renameThread,
    threadCopyDetail,
  } = useAgentThreadCommands({
    store,
    projects,
    now: dependencies.now ?? Date.now,
    setNotice,
    endThreadSession,
    clearSummary: changes.clear,
    clearShip,
    shipStates,
    refreshOrphanedWorktrees,
    ensureExternalHistory,
    clearDeferredForOwner: dispatch.clearDeferredForOwner,
    ownerHasRunningTurn: dispatch.hasLiveTasksForOwner,
    ownerHasLiveSession,
    currentThreads,
  });

  const catalog = useAgentHistoryCatalog({
    projects,
    gateway: defaultHistoryCatalogGateway,
    currentState: store.currentState,
    restoreThread: (thread) => store.restoreThread?.(thread) ?? Promise.resolve(false),
    renameThread,
    archiveThread: archive,
    unarchiveThread: unarchive,
    removeThread: remove,
    deleteSavedThread: async (thread) => {
      const deleteSaved = store.deleteSavedThread;
      if (deleteSaved === undefined) throw new Error("Saved conversations cannot be deleted here.");
      try {
        await deleteSaved(thread);
      } finally {
        void refreshOrphanedWorktrees();
      }
    },
    reportError,
  });

  const importExternalSession = useAgentExternalSessionImport({
    store,
    projects,
    importGateway,
    agentThreadStoreGateway: dependencies.agentThreadStoreGateway,
    launchIdentityForProject: dependencies.launchIdentityForProject,
    getAgentCliKind: dependencies.getAgentCliKind,
    getAgentProviderAdmissionAuthority: dependencies.getAgentProviderAdmissionAuthority,
    reportError,
    setNotice,
    now: dependencies.now,
    createEntropyHex4: dependencies.createEntropyHex4,
  });

  const externalSessions = useExternalSessions({
    externalSessionGateway: dependencies.externalSessionGateway ?? UNWIRED_EXTERNAL_SESSION_GATEWAY,
    threads,
    projects,
    reportError,
    setNotice,
  });

  const lastUsedLaunch = useCallback(
    (projectRootKey: string): AgentLaunchOptions | null =>
      lastUsedAgentLaunch(threads.values(), projectRootKey, agentCliKind),
    [agentCliKind, threads],
  );

  const { openAgentSettings } = dependencies;
  const configureAgentCli = useCallback((): void => openAgentSettings(), [openAgentSettings]);
  const dismissNotice = useCallback((): void => setNotice(null), []);

  const { saveRunningThreadsNow } = store;
  const prepareQuit = useCallback(
    async (budgetMs: number = AGENT_TURN_LOG_QUIT_FLUSH_BUDGET_MS): Promise<void> => {
      saveRunningThreadsNow();
      await turnLog.writer.flushAll(budgetMs).catch(() => undefined);
    },
    [saveRunningThreadsNow, turnLog],
  );

  const threadViews = useAgentThreadViews({
    threads,
    summaries: changes.summaries,
    removedWorktreeThreadIds: worktrees.removedWorktreeThreadIds,
    missingWorktreeThreadIds,
    shipStates,
    editor,
    projects,
    sessionBackgrounds,
  });

  const repositories = useMemo(() => flattenProjectRepositories(projects), [projects]);
  const maxConcurrentAgentTasks = normalizeMaxConcurrentAgentTasks(
    dependencies.getMaxConcurrentAgentTasks(),
  );
  return {
    turnChangesRevision: turnChanges.turnChangesRevision,
    getTurnChangesRevision: turnChanges.getTurnChangesRevision,
    getTurnChanges: turnChanges.getTurnChanges,
    getTurnFileDiff: turnChanges.getTurnFileDiff,
    threads: threadViews,
    loadedProjectRootKeys: store.loadedRootKeys,
    sessionBackgroundsRecovered,
    attachments,
    questionAttachments,
    attachmentImages,
    inlineImages,
    revealAttachment,
    downloadAttachment: refuseLocalAttachmentDownload,
    repositories,
    orphanedWorktrees: worktrees.orphanedWorktrees,
    notice,
    dispatching: dispatch.dispatching,
    dispatchingKeys: dispatch.dispatchingKeys,
    agentCliConfigured,
    agentCliKind,
    agentCliVersion,
    liveTaskCount: countRunningTurns(store.state),
    maxConcurrentAgentTasks,
    pendingTurnCount: dispatch.pendingTurnCount,
    markThreadViewed,
    markThreadUnread,
    renameThread,
    updateThreadOrganization,
    reorderThread,
    threadCopyDetail,
    lastUsedLaunch,
    isolationPreview: isolation.isolationPreview,
    refreshIsolationStatus: isolation.refreshIsolationStatus,
    startThread: dispatch.startThread,
    sendFollowUp: dispatch.sendFollowUp,
    followUpNeedsSessionRestart: dispatch.followUpNeedsSessionRestart,
    restartDeferredFollowUp: dispatch.restartDeferredFollowUp,
    deferredFollowUps: dispatch.deferredFollowUps,
    steer: dispatch.steer,
    removeDeferredFollowUp: dispatch.removeDeferredFollowUp,
    beginDeferredFollowUpEdit: dispatch.beginDeferredFollowUpEdit,
    cancelDeferredFollowUpEdit: dispatch.cancelDeferredFollowUpEdit,
    commitDeferredFollowUpEdit: dispatch.commitDeferredFollowUpEdit,
    sendDeferredFollowUpNow: dispatch.sendDeferredFollowUpNow,
    resumeDeferredFollowUps: dispatch.resumeDeferredFollowUps,
    importExternalSession,
    externalSessions,
    externalHistory,
    history: durableHistory ? history : undefined,
    catalog: durableHistory ? catalog : undefined,
    turnLog: turnLog.facts,
    liveThreads: store.liveThreads,
    stop: dispatch.stop,
    interrupt: sessions.interrupt,
    endSession: sessions.endSession,
    inspectSessionRestart: sessions.inspectRestart,
    inspectSessionBackground: sessions.inspectBackground,
    stopSessionBackgroundTask: sessions.stopBackgroundTask,
    togglePin,
    archive,
    unarchive,
    remove,
    hasLiveTasksForOwner,
    stopProjectTasks: dispatch.stopProjectTasks,
    releaseProjectTasks,
    removeOrphanedWorktree: worktrees.removeOrphanedWorktree,
    pruneOrphanedWorktrees: worktrees.pruneOrphanedWorktrees,
    showChanges: changes.showChanges,
    hideChanges: changes.hideChanges,
    showFileDiff: changes.showFileDiff,
    hideFileDiff: changes.hideFileDiff,
    removeWorktree: worktrees.removeWorktree,
    refreshShipStatus,
    commitThreadChanges: ship.commit,
    pushThreadBranch: ship.push,
    openThreadCompareUrl: ship.openCompareUrl,
    integrateThreadBranch: ship.integrate,
    removeThreadWorktree: ship.removeWorktree,
    resetThreadShip: ship.resetShip,
    openChangedFile: editor.openChangedFile,
    openChangedFileDiff: editor.openChangedFileDiff,
    configureAgentCli,
    dismissNotice,
    prepareQuit,
  };
}

function loggedThreadRootKey(
  store: AgentThreadStoreSurface | null,
  threadId: string,
): string | null {
  const thread = store?.currentState().threads.get(threadId);
  if (thread === undefined) return null;
  if (!isLoggedAgentThread(thread)) return null;
  return thread.owner.rootKey;
}

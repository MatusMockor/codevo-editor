import type { AgentWorktreeBase } from "../domain/agentWorktreeBase";
import type { AgentAccountUsageLoadState } from "../domain/agentAccountUsage";
import type { AgentAccountUsageSourcesPort } from "../domain/agentAccountUsageSources";
import type { AgentAccountUsageRefreshOutcome } from "./agentAccountUsageRefresh";
import type { RemoteGitProjectKey, RemoteGitSyncPort } from "../domain/remoteGitSync";
import type { RemoteRunnerReachability } from "../domain/remoteRunnerReachability";
import type { AgentCommandCatalogServerProject } from "../domain/agentCommandCatalogTarget";
import type { AgentSessionBackground } from "../domain/agentSessionBackground";
import type { AgentBackgroundTaskStopOutcome } from "../domain/agentThreadSession";
import type { AgentTurnChangeSummary, AgentTurnFileDiff } from "../domain/agentTurnChanges";
import type { AgentTurnHaltSource, AgentTurnHaltTrigger } from "../domain/agentTurnHaltRecord";
import type {
  AgentThreadOrganizationPatch,
  AgentThreadDropSection,
  AgentThreadPlacement,
} from "../domain/agentThreadOrganization";
import type { AgentHistoryCatalogSurface } from "./useAgentHistoryCatalog";
import type {
  AgentHistoryTurnPage,
  ReadAgentHistoryTurnsRequest,
  FindAgentHistoryImportRequest,
} from "../domain/agentHistory";
import type { AgentThreadHistorySurface } from "./useAgentThreadHistory";
import type { AgentSubagentLifecycle } from "@codevo/agent-events";
import type { AgentImageMime } from "../domain/agentAttachment";
import type { AgentReferenceEntry } from "../domain/agentReferenceEntry";
import type { DeferredFollowUps } from "./agentDeferredFollowUps";
import type { AgentQueuedEditCommit, AgentQueuedEditSession } from "./agentQueuedFollowUpEdit";
import type { AgentAttachmentImagesSurface } from "./useAgentAttachmentImages";
import type { AgentInlineImagesSurface } from "./useAgentInlineImages";
import type { AgentComposerAttachmentsSurface } from "./useAgentComposerAttachments";
import type { AgentQuestionAttachmentsPort } from "./agentQuestionAttachments";
import type { AgentProjectOrigin } from "../domain/agentProject";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type {
  AgentCliKind,
  AgentIsolationDefault,
  AgentSessionRestartPolicy,
  AgentTaskIsolation,
  InPlaceDispatchGuard,
} from "../domain/agentTask";
import type {
  AgentThread,
  AgentThreadOwner,
  AgentThreadAttention,
  AgentThreadLifecycle,
  AgentThreadsAction,
  AgentThreadsState,
} from "../domain/agentThread";
import type { AgentThreadSearchResult } from "../domain/agentThreadSearch";
import type { AgentTurnLogFactsSource } from "./agentTurnLogStatusStore";
import type {
  ExternalAgentSessionHistory,
  ExternalSessionHistoryRequest,
  ExternalAgentSessionPreview,
  ExternalAgentSessionView,
  ExternalSessionListRequest,
  ExternalSessionListSnapshot,
  ExternalSessionPreviewRequest,
} from "../domain/externalAgentSession";
import type {
  AgentShipAvailability,
  AgentShipIntegrationMode,
  AgentShipState,
  AgentShipStepResult,
} from "../domain/agentShip";
import type { GitChangedFile } from "../domain/git";
import type { AgentCommitSelection } from "../domain/gitCommitSelection";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";
import type { RemoteRunnerTaskResume } from "../domain/remoteRunner";

export interface AgentRestartFollowUpAction {
  readonly kind: "restartFollowUp";
  readonly threadId: string;
  readonly entryId: string;
}

export type AgentTasksNoticeAction = "configure-agent-cli" | AgentRestartFollowUpAction | null;

export interface AgentTasksNotice {
  readonly kind: "info" | "warning" | "error";
  readonly message: string;
  readonly action: AgentTasksNoticeAction;
  readonly projectRootKey?: string;
}

export type AgentTasksNoticeUpdate =
  AgentTasksNotice | null | ((current: AgentTasksNotice | null) => AgentTasksNotice | null);

export interface AgentRepositoryStatusSnapshot {
  readonly known: boolean;
  readonly dirty: boolean;
}

export type AgentRepositoryProbeState =
  | { readonly kind: "checking" }
  | { readonly kind: "ready" }
  | { readonly kind: "notRepository" }
  | { readonly kind: "failed"; readonly message: string }
  | { readonly kind: "unavailable"; readonly message: string };

export type AgentRepositoryProbeOutcome =
  | {
      readonly kind: "ready";
      readonly authority: {
        readonly rootKey: string;
        readonly ownerId: string;
        readonly generation: number;
      };
    }
  | { readonly kind: "failed" }
  | { readonly kind: "stale" }
  | { readonly kind: "unavailable" };

export interface AgentTaskDiffSide {
  readonly text: string;
  readonly truncated: boolean;
}

export interface AgentTaskFileDiff {
  readonly relativePath: string;
  readonly loading: boolean;
  readonly error: string | null;
  readonly original: AgentTaskDiffSide;
  readonly modified: AgentTaskDiffSide;
  readonly unavailableReason: "binary" | "large" | null;
}

export interface AgentTaskChangeSummary {
  readonly loading: boolean;
  readonly error: string | null;
  readonly files: ReadonlyArray<GitChangedFile>;
  readonly truncated: boolean;
  readonly removing: boolean;
  readonly diff: AgentTaskFileDiff | null;
}

export interface OrphanedWorktreeView {
  readonly repositoryRoot: string;
  readonly worktreePath: string;
  readonly branch: string | null;
  readonly prunable: boolean;
  readonly removing: boolean;
}

export interface AgentIsolationPreview {
  readonly repositoryRoot: string;
  readonly repositoryStatus?: AgentRepositoryProbeState;
  readonly recommended: AgentIsolationDefault;
  readonly inPlaceGuard: InPlaceDispatchGuard;
  readonly inPlaceAllowed: boolean;
  readonly confirmationKey: string | null;
}

export interface AgentThreadStoreOwnerRequest {
  readonly rootKey: string;
  readonly ownerId: string;
}

export interface SaveAgentThreadRequest extends AgentThreadStoreOwnerRequest {
  readonly onRevision?: (revision: number) => void;
  readonly isCurrent?: () => boolean;
  readonly thread: AgentThread;
  readonly loggedPromptTurnIds: ReadonlyArray<string>;
  readonly loggedLifecycles?: ReadonlyMap<string, AgentSubagentLifecycle>;
}

export interface DeleteAgentThreadRequest extends AgentThreadStoreOwnerRequest {
  readonly threadId: string;
}

export interface UnreadableAgentThreadReport {
  readonly threadId: string;
  readonly reason: string;
}

export interface AgentThreadStoreSnapshot {
  readonly threads: ReadonlyArray<AgentThread>;
  readonly unreadable: ReadonlyArray<UnreadableAgentThreadReport>;
  readonly evicted: number;
}

export interface AgentThreadStoreGateway {
  findAgentHistoryImport?(request: FindAgentHistoryImportRequest): Promise<AgentThread | null>;
  readAgentHistoryTurns?(request: ReadAgentHistoryTurnsRequest): Promise<AgentHistoryTurnPage>;
  loadAgentThreads(request: AgentThreadStoreOwnerRequest): Promise<AgentThreadStoreSnapshot>;
  saveAgentThread(request: SaveAgentThreadRequest): Promise<void>;
  deleteAgentThread(request: DeleteAgentThreadRequest): Promise<void>;
}

export type AgentThreadMutationResult = boolean | Promise<boolean>;

export class AgentThreadCleanupIncompleteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentThreadCleanupIncompleteError";
  }
}

export interface AgentThreadStoreSurface {
  readonly state: AgentThreadsState;
  readonly loadedRootKeys: ReadonlySet<string>;
  currentState(): AgentThreadsState;
  /** Await terminal persistence and immutable output snapshots before continuing. */
  flushThread?(threadId: string): Promise<boolean>;
  hydrateThread?(threadId: string): void;
  restoreThread?(thread: AgentThread): Promise<boolean>;
  deleteSavedThread?(thread: AgentThread): Promise<void>;
  /** Reserve a display slot after durably saving any evicted conversation. Release on cancellation. */
  reserveThreadSlot?(threadId: string, owner: AgentThreadOwner): Promise<(() => void) | null>;
  saveRunningThreadsNow(): void;
  dispatchAction(action: AgentThreadsAction): void;
  togglePin(threadId: string): void;
  archive(threadId: string): void;
  remove(threadId: string): void;
  markUnread(threadId: string): void;
  rename(threadId: string, title: string): void;
}

export interface ExternalSessionGateway {
  readExternalSessionHistory?(
    request: ExternalSessionHistoryRequest,
  ): Promise<ExternalAgentSessionHistory>;
  listExternalSessions(request: ExternalSessionListRequest): Promise<ExternalSessionListSnapshot>;
  previewExternalSession(
    request: ExternalSessionPreviewRequest,
  ): Promise<ExternalAgentSessionPreview>;
}

export type ExternalSessionsState = "closed" | "loading" | "ready" | "failed";

export interface ExternalSessionsTarget {
  readonly rootKey: string;
  readonly repositoryRoot: string;
}

export interface ExternalSessionImportRequest {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly provider: AgentCliKind;
  readonly sessionId: string;
  readonly title: string;
  readonly firstPrompt: string;
}

export interface ExternalSessionImportResult {
  readonly threadId: string;
  readonly alreadyImported: boolean;
}

export interface ExternalSessionsSurface {
  readonly state: ExternalSessionsState;
  readonly target: ExternalSessionsTarget | null;
  readonly sessions: ReadonlyArray<ExternalAgentSessionView>;
  readonly skipped: number;
  readonly truncated: boolean;
  readonly preview: ExternalAgentSessionPreview | null;
  readonly previewPending: boolean;
  readonly importPending: boolean;
  open(target: ExternalSessionsTarget): Promise<void>;
  reload(): Promise<void>;
  close(): void;
  loadPreview(sessionId: string): Promise<void>;
}

export type AgentThreadCopyDetail = "path" | "branch" | "threadId";

/** Display identity only; remote dispatch retains its own exact connection authority. */
export interface RemoteAgentThreadExecution {
  readonly interactiveQuestions?: boolean;
  readonly pendingMessages?: boolean;
  readonly taskSteering?: boolean;
  readonly gitShip?: boolean;
  readonly portPreview?: boolean;
  readonly kind: "remote";
  readonly serverId: string;
  readonly runnerId: string;
  readonly projectId: string;
  readonly conversationId: string;
  readonly latestTaskId: string;
  readonly resume: RemoteRunnerTaskResume | null;
  readonly reachability: RemoteRunnerReachability;
  readonly reachabilityDetail?: string;
}

export interface AgentThreadView {
  readonly execution?: RemoteAgentThreadExecution;
  readonly thread: AgentThread;
  readonly lifecycle: AgentThreadLifecycle;
  readonly repositoryLabel: string;
  readonly projectOrigin: AgentProjectOrigin;
  readonly worktreeRemoved: boolean;
  readonly worktreeMissing: boolean;
  readonly changeSummary: AgentTaskChangeSummary | null;
  readonly ship: AgentShipState;
  readonly editorAvailability: AgentShipAvailability;
  readonly attention: AgentThreadAttention;
  readonly unread: boolean;
  readonly sessionBackground?: AgentSessionBackground;
}

export interface AgentHistorySearchPort {
  search(
    query: string,
    threadIds: ReadonlySet<string>,
    signal: AbortSignal,
  ): Promise<AgentThreadSearchResult>;
}

export interface AgentThreadSearchSurface {
  readonly query: string;
  readonly active: boolean;
  readonly result: AgentThreadSearchResult | null;
  readonly pending: boolean;
  setQuery(raw: string): void;
  clear(): void;
}

export type AgentTurnAttachmentIntent =
  | {
      readonly kind: "staged";
      readonly attachmentId: string;
      readonly name: string;
      readonly bytes: number;
      readonly mime: AgentImageMime | null;
      readonly width: number | null;
      readonly height: number | null;
    }
  | {
      readonly kind: "reference";
      readonly name: string;
      readonly path: string;
      readonly bytes: number;
      readonly entry: AgentReferenceEntry;
    };

export interface AgentTurnAttachmentRequest {
  readonly attachments?: ReadonlyArray<AgentTurnAttachmentIntent>;
  readonly attachmentOwner?: AgentAttachmentIntentOwner;
}

export interface AgentAttachmentIntentOwner {
  readonly projectRootKey: string;
  readonly ownerId: string;
  readonly generation: number;
  readonly workspaceId: string;
}

export interface AgentThreadWorktreeReuse {
  readonly worktreePath: string;
}

export interface AgentThreadStartRequest extends AgentTurnAttachmentRequest {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly prompt: string;
  readonly isolation: AgentTaskIsolation;
  readonly worktreeBase?: AgentWorktreeBase;
  readonly reuseWorktree?: AgentThreadWorktreeReuse;
  readonly unsafeInPlaceConfirmationKey: string | null;
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed?: boolean;
  onThreadIdentified?(threadId: string): void;
}

export interface AgentThreadStartResult {
  readonly threadId: string;
}

export interface AgentFollowUpRequest extends AgentTurnAttachmentRequest {
  readonly threadId: string;
  readonly prompt: string;
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed?: boolean;
  readonly sessionRestart?: AgentSessionRestartPolicy;
}

export type AgentFollowUpRestartConsent = "notice" | "caller";

export interface AgentSteerRequest extends AgentTurnAttachmentRequest {
  readonly delivery?: "queued" | "immediate";
  readonly threadId: string;
  readonly prompt: string;
  readonly dangerousLaunchConfirmed?: boolean;
}

export type AgentSteerOutcome = "sent" | "deferred" | "kept";

export type AgentSessionRestartVerdict = "proceed" | "confirm";

export type AgentSessionEndResult = "ended" | "none" | "failed";

export type AgentSessionBackgroundInspection = "live" | "none" | "unknown";

export type AgentSessionTaskStopResult =
  AgentBackgroundTaskStopOutcome | { readonly kind: "stale" };

export interface RemoteAgentGitAccess {
  readonly port: RemoteGitSyncPort;
  project(projectRootKey: string): RemoteGitProjectKey | null;
}

export interface RemoteAgentCommandCatalogAccess {
  project(projectRootKey: string): AgentCommandCatalogServerProject | null;
}

export interface AgentThreadsSurface {
  readonly accountUsage?: Readonly<Record<"claudeCode" | "codex", AgentAccountUsageLoadState>>;
  readonly accountUsageSources?: AgentAccountUsageSourcesPort;
  readonly refreshAccountUsage?: (
    provider: "claudeCode" | "codex",
  ) => Promise<AgentAccountUsageRefreshOutcome>;
  readonly remoteGit?: RemoteAgentGitAccess;
  readonly remoteCommandCatalog?: RemoteAgentCommandCatalogAccess;
  readonly history?: AgentThreadHistorySurface;
  readonly catalog?: AgentHistoryCatalogSurface;
  readonly historySearch?: AgentHistorySearchPort;
  readonly turnLog?: AgentTurnLogFactsSource;
  readonly attachments: AgentComposerAttachmentsSurface;
  readonly questionAttachments?: AgentQuestionAttachmentsPort;
  readonly attachmentImages: AgentAttachmentImagesSurface;
  readonly inlineImages?: AgentInlineImagesSurface;
  revealAttachment(threadId: string, attachmentId: string): Promise<void>;
  readonly externalHistory?: {
    readonly states: ReadonlyMap<string, "loading" | "failed" | "unavailable" | "ready">;
    load(threadId: string): Promise<void>;
    readonly hasEarlier?: ReadonlyMap<string, boolean>;
    readonly pages?: ReadonlyMap<string, ExternalAgentSessionHistory>;
    loadEarlier?(threadId: string): Promise<void>;
  };
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly loadedProjectRootKeys?: ReadonlySet<string>;
  readonly sessionBackgroundsRecovered?: boolean;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly orphanedWorktrees: ReadonlyArray<OrphanedWorktreeView>;
  readonly notice: AgentTasksNotice | null;
  readonly dispatching: boolean;
  readonly dispatchingKeys?: ReadonlySet<string>;
  readonly agentCliConfigured: boolean;
  readonly agentCliKind: AgentCliKind;
  readonly agentCliVersion: string | null;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  pendingTurnCount(provider: AgentCliKind): number;
  markThreadViewed(threadId: string): void;
  markThreadUnread(threadId: string): void;
  renameThread(threadId: string, title: string): void;
  updateThreadOrganization?(
    threadId: string,
    patch: AgentThreadOrganizationPatch,
  ): AgentThreadMutationResult | void;
  reorderThread?(
    threadId: string,
    targetThreadId: string,
    placement: AgentThreadPlacement,
    destination?: AgentThreadDropSection,
  ): void;
  threadCopyDetail(threadId: string, detail: AgentThreadCopyDetail): string | null;
  lastUsedLaunch(projectRootKey: string): AgentLaunchOptions | null;
  isolationPreview(repositoryRoot: string, projectRootKey?: string): AgentIsolationPreview;
  refreshIsolationStatus(
    repositoryRoot: string,
    projectRootKey?: string,
  ): Promise<AgentRepositoryProbeOutcome | void>;
  startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null>;
  sendFollowUp(
    request: AgentFollowUpRequest,
    restartConsent?: AgentFollowUpRestartConsent,
  ): Promise<boolean>;
  followUpNeedsSessionRestart?(threadId: string): boolean;
  restartDeferredFollowUp?(threadId: string, id: string): Promise<void>;
  readonly deferredFollowUps: DeferredFollowUps;
  resumeDeferredFollowUps?(threadId: string): Promise<void>;
  hasUnconfirmedMessage?(threadId: string): boolean;
  discardUnconfirmedMessage?(threadId: string): void;
  sendDeferredFollowUpNow?(threadId: string, id: string): Promise<void>;
  steer(request: AgentSteerRequest): Promise<AgentSteerOutcome>;
  removeDeferredFollowUp(threadId: string, id: string): void;
  beginDeferredFollowUpEdit?(threadId: string, id: string): AgentQueuedEditSession | null;
  cancelDeferredFollowUpEdit?(session: AgentQueuedEditSession): void;
  commitDeferredFollowUpEdit?(
    session: AgentQueuedEditSession,
    commit: AgentQueuedEditCommit,
  ): Promise<boolean>;
  importExternalSession(
    request: ExternalSessionImportRequest,
  ): Promise<ExternalSessionImportResult | null>;
  stop(threadId: string, trigger: AgentTurnHaltTrigger): Promise<void>;
  interrupt?(threadId: string, source: AgentTurnHaltSource): Promise<boolean>;
  endSession?(threadId: string): Promise<AgentSessionEndResult>;
  inspectSessionBackground?(threadId: string): Promise<AgentSessionBackgroundInspection>;
  stopSessionBackgroundTask?(threadId: string, taskId: string): Promise<AgentSessionTaskStopResult>;
  inspectSessionRestart?(
    threadId: string,
    launch: AgentLaunchOptions,
  ): Promise<AgentSessionRestartVerdict>;
  togglePin(threadId: string): AgentThreadMutationResult | void;
  archive(threadId: string): AgentThreadMutationResult | void;
  unarchive?(threadId: string): AgentThreadMutationResult | void;
  remove(threadId: string): AgentThreadMutationResult | void;
  batchThreadMutations?<T>(work: () => Promise<T>): Promise<T>;
  hasLiveTasksForOwner(ownerId: string): boolean;
  stopProjectTasks(ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void>;
  releaseProjectTasks(ownerId: string): void;
  removeOrphanedWorktree(worktreePath: string): Promise<void>;
  pruneOrphanedWorktrees(repositoryRoot: string): Promise<void>;
  readonly turnChangesRevision?: object;
  readonly getTurnChangesRevision?: (threadId: string) => object;
  getTurnChanges?(threadId: string, turnId: string): Promise<AgentTurnChangeSummary>;
  getTurnFileDiff?(
    threadId: string,
    turnId: string,
    relativePath: string,
  ): Promise<AgentTurnFileDiff>;
  showChanges(threadId: string): Promise<void>;
  hideChanges(threadId: string): void;
  showFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
  hideFileDiff(threadId: string): void;
  removeWorktree(threadId: string): Promise<void>;
  refreshShipStatus(threadId: string): Promise<void>;
  commitThreadChanges(
    threadId: string,
    message: string,
    selection?: AgentCommitSelection,
  ): Promise<AgentShipStepResult>;
  pushThreadBranch(threadId: string): Promise<AgentShipStepResult>;
  openThreadCompareUrl(threadId: string): Promise<void>;
  integrateThreadBranch(threadId: string, mode: AgentShipIntegrationMode): Promise<void>;
  removeThreadWorktree(
    threadId: string,
    options: { readonly deleteBranch: boolean },
  ): Promise<void>;
  resetThreadShip(threadId: string): void;
  openChangedFile(threadId: string, change: GitChangedFile): Promise<void>;
  openChangedFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
  configureAgentCli(): void;
  dismissNotice(): void;
  prepareQuit?(budgetMs?: number): Promise<void>;
}

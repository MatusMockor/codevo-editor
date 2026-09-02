import type { AgentProjectOrigin } from "../domain/agentProject";
import type { AgentLaunchOptions } from "../domain/agentLaunch";
import type {
  AgentCliKind,
  AgentIsolationDefault,
  AgentTaskIsolation,
  InPlaceDispatchGuard,
} from "../domain/agentTask";
import type {
  AgentThread,
  AgentThreadAttention,
  AgentThreadLifecycle,
  AgentThreadsAction,
  AgentThreadsState,
} from "../domain/agentThread";
import type { AgentThreadSearchResult } from "../domain/agentThreadSearch";
import type {
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
} from "../domain/agentShip";
import type { GitChangedFile } from "../domain/git";
import type { ResolvedGitRepository } from "../domain/gitRepositoryMapping";

export type AgentTasksNoticeAction = "configure-agent-cli" | null;

export interface AgentTasksNotice {
  readonly kind: "info" | "warning" | "error";
  readonly message: string;
  readonly action: AgentTasksNoticeAction;
}

export interface AgentRepositoryStatusSnapshot {
  readonly known: boolean;
  readonly dirty: boolean;
}

export type AgentRepositoryProbeState =
  | { readonly kind: "checking" }
  | { readonly kind: "ready" }
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
  readonly thread: AgentThread;
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
  loadAgentThreads(request: AgentThreadStoreOwnerRequest): Promise<AgentThreadStoreSnapshot>;
  saveAgentThread(request: SaveAgentThreadRequest): Promise<void>;
  deleteAgentThread(request: DeleteAgentThreadRequest): Promise<void>;
}

export interface AgentThreadStoreSurface {
  readonly state: AgentThreadsState;
  readonly loadedRootKeys: ReadonlySet<string>;
  currentState(): AgentThreadsState;
  dispatchAction(action: AgentThreadsAction): void;
  togglePin(threadId: string): void;
  archive(threadId: string): void;
  remove(threadId: string): void;
  markUnread(threadId: string): void;
  rename(threadId: string, title: string): void;
}

export interface ExternalSessionGateway {
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

export interface AgentThreadView {
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
}

export interface AgentThreadSearchSurface {
  readonly query: string;
  readonly active: boolean;
  readonly result: AgentThreadSearchResult | null;
  readonly pending: boolean;
  setQuery(raw: string): void;
  clear(): void;
}

export interface AgentThreadStartRequest {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly prompt: string;
  readonly isolation: AgentTaskIsolation;
  readonly unsafeInPlaceConfirmationKey: string | null;
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed?: boolean;
}

export interface AgentThreadStartResult {
  readonly threadId: string;
}

export interface AgentFollowUpRequest {
  readonly threadId: string;
  readonly prompt: string;
  readonly launch: AgentLaunchOptions;
  readonly dangerousLaunchConfirmed?: boolean;
}

export interface AgentThreadsSurface {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly orphanedWorktrees: ReadonlyArray<OrphanedWorktreeView>;
  readonly notice: AgentTasksNotice | null;
  readonly dispatching: boolean;
  readonly agentCliConfigured: boolean;
  readonly agentCliKind: AgentCliKind;
  readonly agentCliVersion: string | null;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  pendingTurnCount(provider: AgentCliKind): number;
  markThreadViewed(threadId: string): void;
  markThreadUnread(threadId: string): void;
  renameThread(threadId: string, title: string): void;
  threadCopyDetail(threadId: string, detail: AgentThreadCopyDetail): string | null;
  lastUsedLaunch(projectRootKey: string): AgentLaunchOptions | null;
  isolationPreview(repositoryRoot: string): AgentIsolationPreview;
  refreshIsolationStatus(repositoryRoot: string): Promise<AgentRepositoryProbeOutcome | void>;
  startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null>;
  sendFollowUp(request: AgentFollowUpRequest): Promise<boolean>;
  importExternalSession(
    request: ExternalSessionImportRequest,
  ): Promise<ExternalSessionImportResult | null>;
  stop(threadId: string): Promise<void>;
  togglePin(threadId: string): void;
  archive(threadId: string): void;
  remove(threadId: string): void;
  hasLiveTasksForOwner(ownerId: string): boolean;
  stopProjectTasks(ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void>;
  releaseProjectTasks(ownerId: string): void;
  removeOrphanedWorktree(worktreePath: string): Promise<void>;
  pruneOrphanedWorktrees(repositoryRoot: string): Promise<void>;
  showChanges(threadId: string): Promise<void>;
  hideChanges(threadId: string): void;
  showFileDiff(threadId: string, change: GitChangedFile): Promise<void>;
  hideFileDiff(threadId: string): void;
  removeWorktree(threadId: string): Promise<void>;
  refreshShipStatus(threadId: string): Promise<void>;
  commitThreadChanges(threadId: string, message: string): Promise<void>;
  pushThreadBranch(threadId: string): Promise<void>;
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
}

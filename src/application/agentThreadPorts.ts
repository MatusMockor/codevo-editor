import type { AgentProjectOrigin } from "../domain/agentProject";
import type {
  AgentCliKind,
  AgentIsolationDefault,
  AgentTaskIsolation,
  InPlaceDispatchGuard,
} from "../domain/agentTask";
import type {
  AgentThread,
  AgentThreadLifecycle,
  AgentThreadsAction,
  AgentThreadsState,
} from "../domain/agentThread";
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
}

export interface AgentThreadView {
  readonly thread: AgentThread;
  readonly lifecycle: AgentThreadLifecycle;
  readonly repositoryLabel: string;
  readonly projectOrigin: AgentProjectOrigin;
  readonly worktreeRemoved: boolean;
  readonly worktreeMissing: boolean;
  readonly changeSummary: AgentTaskChangeSummary | null;
}

export interface AgentThreadStartRequest {
  readonly projectRootKey: string;
  readonly repositoryRoot: string;
  readonly prompt: string;
  readonly isolation: AgentTaskIsolation;
  readonly unsafeInPlaceConfirmationKey: string | null;
}

export interface AgentThreadStartResult {
  readonly threadId: string;
}

export interface AgentFollowUpRequest {
  readonly threadId: string;
  readonly prompt: string;
}

export interface AgentThreadsSurface {
  readonly threads: ReadonlyArray<AgentThreadView>;
  readonly repositories: ReadonlyArray<ResolvedGitRepository>;
  readonly orphanedWorktrees: ReadonlyArray<OrphanedWorktreeView>;
  readonly notice: AgentTasksNotice | null;
  readonly dispatching: boolean;
  readonly agentCliConfigured: boolean;
  readonly agentCliKind: AgentCliKind;
  readonly liveTaskCount: number;
  readonly maxConcurrentAgentTasks: number;
  isolationPreview(repositoryRoot: string): AgentIsolationPreview;
  refreshIsolationStatus(repositoryRoot: string): Promise<void>;
  startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null>;
  sendFollowUp(request: AgentFollowUpRequest): Promise<boolean>;
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
  configureAgentCli(): void;
  dismissNotice(): void;
}

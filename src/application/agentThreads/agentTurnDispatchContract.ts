import type { AgentAccountUsageObservation } from "../../domain/agentAccountUsage";
import type { CodexTransport } from "../../domain/agentProviderSettings";
import type { AgentCliKind, AgentTaskGateway, AgentTaskStatusEvent } from "../../domain/agentTask";
import type { AgentThread } from "../../domain/agentThread";
import type { AgentTurnHaltTrigger } from "../../domain/agentTurnHaltRecord";
import type { GitWorktreeGateway } from "../../domain/gitWorktree";
import type { AgentDispatchClaim } from "../agentDispatchKeys";
import type { AgentAttachmentGateway } from "../agentAttachmentPorts";
import type { DeferredFollowUps } from "../agentDeferredFollowUps";
import type { AgentProjectAuthority, AgentTaskLaunchAuthority } from "../agentProjectAuthority";
import type { AgentQueuedEditCommit, AgentQueuedEditSession } from "../agentQueuedFollowUpEdit";
import type { FollowUpRestartRefusals } from "../agentSessionRestartConsent";
import type { AgentSessionContinuity } from "../agentSessionContinuity";
import type {
  AgentFollowUpRequest,
  AgentFollowUpRestartConsent,
  AgentSteerOutcome,
  AgentSteerRequest,
  AgentThreadStartRequest,
  AgentThreadStartResult,
} from "../agentThreadPorts";
import type { AgentTurnAdmissionDependencies } from "../agentTurnAdmission";
import type {
  AgentTurnAttachmentAuthority,
  AttachmentThreadReservation,
} from "../agentTurnAttachments";
import type { AgentOutputParserPort } from "../agentTurnOutputStream";
import type { runAgentTurnStart } from "../agentTurnStartRunner";
import type { InPlacePreflight } from "../useAgentIsolationPreview";
import type { AgentSessionRestartInspector } from "../useAgentFollowUpRestart";
import type { AgentWorktreeUseRegistry } from "../agentWorktreeUseRegistry";

export interface AgentTurnDispatchDependencies extends AgentTurnAdmissionDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly hasPendingThreadInput?: (threadId: string) => Promise<boolean>;
  readonly inspectSessionRestart?: AgentSessionRestartInspector;
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
  readonly gitWorktreeGateway: GitWorktreeGateway;
  readonly preflightInPlace: (
    repositoryRoot: string,
    authority: AgentProjectAuthority,
    unsafeInPlaceConfirmationKey: string | null,
  ) => Promise<InPlacePreflight>;
  readonly retainUncertainWorktree: (worktreePath: string) => void;
  readonly onWorktreeCreated?: (repositoryRoot: string, worktreePath: string) => void;
  readonly worktreeUses?: AgentWorktreeUseRegistry;
  readonly currentCliVersion?: (provider: AgentCliKind) => string | null;
  readonly onWorktreeDispatchFailed?: () => void;
  readonly onTurnTerminal?: (event: AgentTaskStatusEvent) => void;
  readonly onAccountUsageObserved?: (observation: AgentAccountUsageObservation) => void;
  readonly onProjectDispatchTrustRejected?: (projectRootKey: string) => void;
  readonly outputParser?: AgentOutputParserPort;
}

export interface AgentTurnDispatchSurface {
  readonly dispatching: boolean;
  readonly dispatchingKeys: ReadonlySet<string>;
  pendingTurnCount(provider: AgentCliKind): number;
  startThread(request: AgentThreadStartRequest): Promise<AgentThreadStartResult | null>;
  sendFollowUp(
    request: AgentFollowUpRequest,
    restartConsent?: AgentFollowUpRestartConsent,
  ): Promise<boolean>;
  followUpNeedsSessionRestart(threadId: string): boolean;
  resumeSessionIdFor(thread: AgentThread): string | null;
  mintUnreservedTurnId(): string | null;
  readonly deferredFollowUps: DeferredFollowUps;
  steer(request: AgentSteerRequest): Promise<AgentSteerOutcome>;
  removeDeferredFollowUp(threadId: string, id: string): void;
  beginDeferredFollowUpEdit(threadId: string, id: string): AgentQueuedEditSession | null;
  cancelDeferredFollowUpEdit(session: AgentQueuedEditSession): void;
  commitDeferredFollowUpEdit(
    session: AgentQueuedEditSession,
    commit: AgentQueuedEditCommit,
  ): Promise<boolean>;
  sendDeferredFollowUpNow(threadId: string, id: string): Promise<void>;
  resumeDeferredFollowUps(threadId: string): Promise<void>;
  restartDeferredFollowUp(threadId: string, id: string): Promise<void>;
  clearDeferredForOwner(ownerId: string): void;
  stop(threadId: string, trigger: AgentTurnHaltTrigger): Promise<void>;
  hasLiveTasksForOwner(ownerId: string): boolean;
  stopProjectTasks(ownerId: string, repositoryRoots: ReadonlyArray<string>): Promise<void>;
}

export interface AgentTurnDispatchContext {
  readonly dependenciesRef: { readonly current: AgentTurnDispatchDependencies };
  readonly mountedRef: { readonly current: boolean };
  readonly attachmentThreads: Map<string, AttachmentThreadReservation>;
  readonly inFlightThreads: Set<string>;
  readonly preparingThreads: Set<string>;
  readonly mintedIds: Set<string>;
  readonly sessionContinuity: AgentSessionContinuity;
  readonly restartRefusals: FollowUpRestartRefusals;
  claimDispatch(key: string): AgentDispatchClaim;
  releaseDispatch(key: string): void;
  beginPendingTurn(provider: AgentCliKind): void;
  endPendingTurn(provider: AgentCliKind): void;
  registerStream(
    thread: AgentThread,
    turnId: string,
    resumeSessionId: string | null,
    codexTransport?: CodexTransport,
  ): void;
  runTurnStart(start: Parameters<typeof runAgentTurnStart>[1]): Promise<boolean>;
}

export function turnAttachmentAuthority(
  authority: AgentTaskLaunchAuthority,
): AgentTurnAttachmentAuthority {
  return {
    rootKey: authority.rootKey,
    ownerId: authority.ownerId,
    generation: authority.generation,
    workspaceId: authority.workspaceId,
  };
}

import type { AgentTaskGateway } from "../../domain/agentTask";
import type { AgentThreadsState } from "../../domain/agentThread";
import { AgentDeferredBoundaryTracker } from "../agentDeferredBoundaryTracker";
import type { AgentAttachmentGateway } from "../agentAttachmentPorts";
import type { DeferredFollowUps } from "../agentDeferredFollowUps";
import type { AgentQueuedEditCommit, AgentQueuedEditSession } from "../agentQueuedFollowUpEdit";
import type { AgentTaskLaunchAuthority } from "../agentProjectAuthority";
import type {
  AgentFollowUpRequest,
  AgentSteerOutcome,
  AgentSteerRequest,
} from "../agentThreadPorts";
import { DeferredRestartRefusals } from "../agentSessionRestartConsent";
import type { AgentTurnAdmissionDependencies } from "../agentTurnAdmission";
import type { ClaimedTurnAttachments } from "../agentTurnAttachments";

export interface AgentTurnSteerDependencies extends AgentTurnAdmissionDependencies {
  readonly agentTaskGateway: AgentTaskGateway;
  readonly hasPendingThreadInput?: (threadId: string) => Promise<boolean>;
  readonly agentAttachmentGateway?: AgentAttachmentGateway;
}

export interface AgentTurnSteerOptions {
  readonly state: AgentThreadsState;
  readonly dependenciesRef: { readonly current: AgentTurnSteerDependencies };
  readonly mountedRef: { readonly current: boolean };
  readonly sendFollowUpRef: {
    readonly current:
      | ((
          request: AgentFollowUpRequest,
          isCurrent?: () => boolean,
          prepared?: ClaimedTurnAttachments,
        ) => Promise<boolean>)
      | null;
  };
  readonly needsRestart: (threadId: string) => boolean;
  readonly flushStreams: () => void;
}

export interface AgentTurnSteerSurface {
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
  onTurnSettled(threadId: string): void;
  onThreadStopped(threadId: string): void;
  clearDeferredForOwner(ownerId: string): void;
}

export interface AgentSteerLease {
  readonly authority: AgentTaskLaunchAuthority;
  cancelled: boolean;
}

export interface AgentSteerDrainLease extends AgentSteerLease {
  readonly entryId: string;
}

export interface AgentSteerQueueState {
  deferred: DeferredFollowUps;
  deferredSequence: number;
  editLease: number;
  readonly inFlightSteers: Set<string>;
  readonly steerLeases: Map<string, AgentSteerLease>;
  readonly deferredAuthorities: Map<string, AgentTaskLaunchAuthority>;
  readonly drainLeases: Map<string, AgentSteerDrainLease>;
  readonly boundaryTracker: AgentDeferredBoundaryTracker;
  readonly blockedThreads: Set<string>;
  readonly awaitingSettlement: Set<string>;
  readonly pendingDrains: Set<string>;
  readonly sendingQueued: Map<string, string>;
  readonly userSendNow: Set<string>;
  readonly pausedThreads: Set<string>;
  readonly restartRefusals: DeferredRestartRefusals;
  readonly preparedDeferred: WeakMap<AgentFollowUpRequest, ClaimedTurnAttachments>;
}

export interface AgentSteerQueueContext {
  readonly state: AgentSteerQueueState;
  readonly dependenciesRef: AgentTurnSteerOptions["dependenciesRef"];
  readonly mountedRef: AgentTurnSteerOptions["mountedRef"];
  readonly sendFollowUpRef: AgentTurnSteerOptions["sendFollowUpRef"];
  needsRestart(threadId: string): boolean;
  flushStreams(): void;
  commitDeferred(next: DeferredFollowUps): void;
  armDrain(threadId: string): void;
}

export function createAgentSteerQueueState(deferred: DeferredFollowUps): AgentSteerQueueState {
  return {
    deferred,
    deferredSequence: 0,
    editLease: 0,
    inFlightSteers: new Set(),
    steerLeases: new Map(),
    deferredAuthorities: new Map(),
    drainLeases: new Map(),
    boundaryTracker: new AgentDeferredBoundaryTracker(),
    blockedThreads: new Set(),
    awaitingSettlement: new Set(),
    pendingDrains: new Set(),
    sendingQueued: new Map(),
    userSendNow: new Set(),
    pausedThreads: new Set(),
    restartRefusals: new DeferredRestartRefusals(),
    preparedDeferred: new WeakMap(),
  };
}

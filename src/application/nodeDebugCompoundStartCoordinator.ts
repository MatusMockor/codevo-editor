import {
  validateNodeDebugPreLaunchTask,
  type NodeDebugPreLaunchTask,
} from "../domain/nodeDebugPreLaunchTask";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";
import {
  cloneNodeDebugCompoundMembers,
  type NodeDebugCompoundMemberRecipe,
} from "./nodeDebugCompoundRecipe";
import {
  NodeDebugCompoundSessionCoordinator,
  MAX_NODE_DEBUG_COMPOUND_MEMBERS,
  MIN_NODE_DEBUG_COMPOUND_MEMBERS,
  type NodeDebugCompoundEvent,
  type NodeDebugCompoundLease,
  type NodeDebugCompoundOwner,
} from "./nodeDebugCompoundSessionCoordinator";
import type { PreparedNodeDebugLaunch } from "./useNodeDebugConfigurationLauncher";

export const NODE_DEBUG_COMPOUND_PRE_LAUNCH_ERROR = "Unable to run the compound pre-launch task.";
export const NODE_DEBUG_COMPOUND_START_ERROR = "Unable to start the debug compound.";
export const NODE_DEBUG_COMPOUND_STALE_ERROR = "The debug compound is no longer current.";
export const NODE_DEBUG_COMPOUND_ROLLBACK_ERROR = "Unable to finish debug compound rollback.";
export const NODE_DEBUG_COMPOUND_STOP_ERROR = "Unable to stop the debug compound.";
const MAX_NODE_DEBUG_COMPOUND_IDENTITY_BYTES = 4_096;
const UTF8_ENCODER = new TextEncoder();

export type NodeDebugCompoundMembersStartResult =
  { readonly kind: "batch"; readonly sessionIds: readonly number[] } | { readonly kind: "failed" };

export interface NodeDebugCompoundMembersStartRequest {
  readonly members: readonly NodeDebugCompoundMemberRecipe[];
  readonly owner: Readonly<NodeDebugCompoundOwner>;
}

/**
 * Application port for one atomic backend-owned compound batch.
 * No member launch recipe or raw backend error is retained by the coordinator.
 */
export interface NodeDebugCompoundStartPort {
  captureOwner(): NodeDebugCompoundOwner | null;
  isWorkspaceTrusted(owner: Readonly<NodeDebugCompoundOwner>): boolean;
  runPreLaunchTask(
    task: NodeDebugPreLaunchTask,
    owner: Readonly<NodeDebugCompoundOwner>,
  ): Promise<boolean>;
  startMembers(
    request: NodeDebugCompoundMembersStartRequest,
  ): Promise<NodeDebugCompoundMembersStartResult>;
  /**
   * Stops the backend-owned group through one exact live representative session.
   * Native `stopAll` semantics terminate every sibling atomically.
   */
  stopGroup(
    representativeSessionId: number,
    owner: Readonly<NodeDebugCompoundOwner>,
  ): Promise<boolean>;
  reportError?(message: string): void;
}

export interface NodeDebugCompoundStartRequest {
  readonly members: readonly PreparedNodeDebugLaunch[];
  readonly preLaunchTask?: NodeDebugPreLaunchTask | null;
}

declare const nodeDebugCompoundGroupLeaseBrand: unique symbol;

/** Opaque authority handed to the future compound debug surface. */
export interface NodeDebugCompoundGroupLease {
  readonly [nodeDebugCompoundGroupLeaseBrand]: true;
}

export type NodeDebugCompoundStartOutcome =
  | { readonly kind: "started"; readonly lease: NodeDebugCompoundGroupLease }
  | {
      readonly kind:
        | "busy"
        | "invalid"
        | "prelaunch-failed"
        | "rollback-failed"
        | "stale"
        | "start-failed"
        | "untrusted";
    };

export type NodeDebugCompoundStopOutcome =
  { readonly kind: "stopped" } | { readonly kind: "failed" } | { readonly kind: "rejected" };

interface StartingOperation {
  batchRejected: boolean;
  cancelled: boolean;
  readonly completion: Promise<NodeDebugCompoundStartOutcome>;
  readonly internalLease: NodeDebugCompoundLease;
  readonly members: readonly NodeDebugCompoundMemberRecipe[];
  readonly owner: Readonly<NodeDebugCompoundOwner>;
  readonly publicLease: NodeDebugCompoundGroupLease;
  readonly resolveCompletion: (outcome: NodeDebugCompoundStartOutcome) => void;
  readonly untrackedSessionIds: Set<number>;
}

interface ActiveGroup {
  readonly internalLease: NodeDebugCompoundLease;
  readonly owner: Readonly<NodeDebugCompoundOwner>;
  readonly publicLease: NodeDebugCompoundGroupLease;
}

const outcome = <T extends NodeDebugCompoundStartOutcome["kind"]>(
  kind: T,
): Extract<NodeDebugCompoundStartOutcome, { readonly kind: T }> =>
  Object.freeze({ kind }) as Extract<NodeDebugCompoundStartOutcome, { readonly kind: T }>;

/**
 * Async application orchestrator over the pure exact-session state machine.
 *
 * It captures one immutable owner, runs a compound task once, accepts one
 * atomic batch result, and rolls back every exact live child when any
 * start-time invariant fails.
 */
export class NodeDebugCompoundStartCoordinator {
  private activeGroup: ActiveGroup | null = null;
  private readonly groups = new NodeDebugCompoundSessionCoordinator();
  private starting: StartingOperation | null = null;

  constructor(private readonly port: NodeDebugCompoundStartPort) {}

  occupied(): boolean {
    return this.starting !== null || this.activeGroup !== null;
  }

  async start(request: NodeDebugCompoundStartRequest): Promise<NodeDebugCompoundStartOutcome> {
    if (this.occupied()) return outcome("busy");
    const preLaunchTask = validatedPreLaunchTask(request.preLaunchTask);
    if (preLaunchTask === undefined) return outcome("invalid");
    const members = cloneNodeDebugCompoundMembers(request.members);
    if (!members) return outcome("invalid");
    const owner = safelyCaptureOwner(this.port);
    if (!owner) return outcome("stale");
    if (!safelyTrusted(this.port, owner)) return outcome("untrusted");

    const internalLease = this.groups.begin(owner, members.length);
    if (!internalLease) return outcome("invalid");
    const completion = deferred<NodeDebugCompoundStartOutcome>();
    const operation: StartingOperation = {
      batchRejected: false,
      cancelled: false,
      completion: completion.promise,
      internalLease,
      members,
      owner,
      publicLease: Object.freeze({}) as NodeDebugCompoundGroupLease,
      resolveCompletion: completion.resolve,
      untrackedSessionIds: new Set(),
    };
    this.starting = operation;

    const result = await this.performStart(operation, preLaunchTask);
    if (this.starting === operation) this.starting = null;
    operation.resolveCompletion(result);
    return result;
  }

  handleEvent(event: NodeDebugCompoundEvent): boolean {
    const handled = this.groups.handleEvent(event);
    if (handled && !this.starting && this.groups.snapshot().kind === "idle") {
      this.activeGroup = null;
    }
    return handled;
  }

  /** Invalidates and rolls back only the exact captured owner generation. */
  async invalidate(owner: NodeDebugCompoundOwner): Promise<boolean> {
    if (!validOwner(owner)) return false;
    const starting = this.starting;
    if (starting && ownersEqual(starting.owner, owner)) {
      starting.cancelled = true;
      await starting.completion;
      return true;
    }
    const active = this.activeGroup;
    if (!active || !ownersEqual(active.owner, owner)) return false;
    this.activeGroup = null;
    const sessionIds = this.groups.invalidate(owner);
    return this.stopExactGroup(sessionIds, active.owner, NODE_DEBUG_COMPOUND_ROLLBACK_ERROR);
  }

  /** Consumes one exact group lease before issuing Stop All, even on failure. */
  async stopAll(lease: NodeDebugCompoundGroupLease): Promise<NodeDebugCompoundStopOutcome> {
    const active = this.activeGroup;
    if (!active || active.publicLease !== lease) {
      return Object.freeze({ kind: "rejected" });
    }
    this.activeGroup = null;
    const sessionIds = this.groups.rollback(active.internalLease);
    const stopped = await this.stopExactGroup(
      sessionIds,
      active.owner,
      NODE_DEBUG_COMPOUND_STOP_ERROR,
    );
    return Object.freeze({ kind: stopped ? "stopped" : "failed" });
  }

  private async performStart(
    operation: StartingOperation,
    preLaunchTask: NodeDebugPreLaunchTask | null,
  ): Promise<NodeDebugCompoundStartOutcome> {
    if (preLaunchTask) {
      const taskCompleted = await safelyRunPreLaunchTask(this.port, preLaunchTask, operation.owner);
      if (!this.current(operation)) {
        return this.rollback(operation, "stale");
      }
      if (!taskCompleted) {
        this.report(NODE_DEBUG_COMPOUND_PRE_LAUNCH_ERROR);
        this.groups.rollback(operation.internalLease);
        return outcome("prelaunch-failed");
      }
    }
    if (!this.current(operation)) {
      return this.rollback(operation, "stale");
    }

    const startResult = await safelyStartMembers(this.port, {
      members: operation.members,
      owner: operation.owner,
    });
    if (startResult.kind === "batch") {
      startResult.sessionIds.forEach((sessionId, memberIndex) => {
        this.recordBatchMember(operation, memberIndex, sessionId);
      });
    }
    if (startResult.kind === "failed") {
      this.report(NODE_DEBUG_COMPOUND_START_ERROR);
      return this.rollback(operation, "start-failed");
    }
    if (!this.current(operation)) {
      return this.rollback(operation, "stale");
    }
    const snapshot = this.groups.snapshot();
    if (
      operation.batchRejected ||
      snapshot.kind !== "active" ||
      snapshot.memberCount !== operation.members.length ||
      snapshot.activeCount !== operation.members.length
    ) {
      this.report(NODE_DEBUG_COMPOUND_START_ERROR);
      return this.rollback(operation, "start-failed");
    }

    this.activeGroup = Object.freeze({
      internalLease: operation.internalLease,
      owner: operation.owner,
      publicLease: operation.publicLease,
    });
    return Object.freeze({ kind: "started", lease: operation.publicLease });
  }

  private recordBatchMember(
    operation: StartingOperation,
    memberIndex: number,
    sessionId: number,
  ): boolean {
    if (this.starting !== operation || operation.cancelled) {
      if (validSessionId(sessionId)) operation.untrackedSessionIds.add(sessionId);
      operation.batchRejected = true;
      return false;
    }
    const accepted =
      this.groups.accept(operation.internalLease, memberIndex, sessionId).kind !== "rejected";
    if (!accepted) {
      if (validSessionId(sessionId)) operation.untrackedSessionIds.add(sessionId);
      operation.batchRejected = true;
    }
    return accepted;
  }

  private current(operation: StartingOperation): boolean {
    return (
      this.starting === operation &&
      !operation.cancelled &&
      ownerIsCurrent(this.port, operation.owner) &&
      safelyTrusted(this.port, operation.owner)
    );
  }

  private async rollback(
    operation: StartingOperation,
    failure: "stale" | "start-failed",
  ): Promise<NodeDebugCompoundStartOutcome> {
    const exactSessionIds = [
      ...this.groups.rollback(operation.internalLease),
      ...operation.untrackedSessionIds,
    ];
    const stopped = await this.stopExactGroup(
      exactSessionIds,
      operation.owner,
      NODE_DEBUG_COMPOUND_ROLLBACK_ERROR,
    );
    if (!stopped) return outcome("rollback-failed");
    if (failure === "stale") this.report(NODE_DEBUG_COMPOUND_STALE_ERROR);
    return outcome(failure);
  }

  private async stopExactGroup(
    sessionIds: readonly number[],
    owner: Readonly<NodeDebugCompoundOwner>,
    errorMessage: string,
  ): Promise<boolean> {
    const representativeSessionId = [...new Set(sessionIds)].find(validSessionId);
    if (representativeSessionId === undefined) return true;
    const success = await safelyStopGroup(this.port, representativeSessionId, owner);
    if (!success) this.report(errorMessage);
    return success;
  }

  private report(message: string): void {
    try {
      this.port.reportError?.(message);
    } catch {
      // Reporting is deliberately best-effort and must not change orchestration.
    }
  }
}

function validatedPreLaunchTask(
  task: NodeDebugPreLaunchTask | null | undefined,
): NodeDebugPreLaunchTask | null | undefined {
  if (task == null) return null;
  const validated = validateNodeDebugPreLaunchTask(task.label);
  return validated.kind === "valid" ? validated.task : undefined;
}

function safelyCaptureOwner(
  port: NodeDebugCompoundStartPort,
): Readonly<NodeDebugCompoundOwner> | null {
  try {
    const owner = port.captureOwner();
    return validOwner(owner) ? Object.freeze({ ...owner }) : null;
  } catch {
    return null;
  }
}

function ownerIsCurrent(
  port: NodeDebugCompoundStartPort,
  owner: Readonly<NodeDebugCompoundOwner>,
): boolean {
  const current = safelyCaptureOwner(port);
  return current !== null && ownersEqual(owner, current);
}

function safelyTrusted(
  port: NodeDebugCompoundStartPort,
  owner: Readonly<NodeDebugCompoundOwner>,
): boolean {
  try {
    return port.isWorkspaceTrusted(owner) === true;
  } catch {
    return false;
  }
}

async function safelyRunPreLaunchTask(
  port: NodeDebugCompoundStartPort,
  task: NodeDebugPreLaunchTask,
  owner: Readonly<NodeDebugCompoundOwner>,
): Promise<boolean> {
  try {
    return (await port.runPreLaunchTask(task, owner)) === true;
  } catch {
    return false;
  }
}

async function safelyStartMembers(
  port: NodeDebugCompoundStartPort,
  request: NodeDebugCompoundMembersStartRequest,
): Promise<NodeDebugCompoundMembersStartResult> {
  try {
    const result = await port.startMembers(request);
    if (result?.kind === "failed") return result;
    if (
      result?.kind === "batch" &&
      Array.isArray(result.sessionIds) &&
      result.sessionIds.length === request.members.length &&
      result.sessionIds.length >= MIN_NODE_DEBUG_COMPOUND_MEMBERS &&
      result.sessionIds.length <= MAX_NODE_DEBUG_COMPOUND_MEMBERS &&
      result.sessionIds.every(validSessionId) &&
      new Set(result.sessionIds).size === result.sessionIds.length
    )
      return result;
  } catch {
    // Converted to a generic start failure below.
  }
  return Object.freeze({ kind: "failed" });
}

async function safelyStopGroup(
  port: NodeDebugCompoundStartPort,
  representativeSessionId: number,
  owner: Readonly<NodeDebugCompoundOwner>,
): Promise<boolean> {
  try {
    return (await port.stopGroup(representativeSessionId, owner)) === true;
  } catch {
    return false;
  }
}

function validOwner(owner: NodeDebugCompoundOwner | null): owner is NodeDebugCompoundOwner {
  return (
    owner !== null &&
    safeIdentity(owner.rootPath) &&
    safeIdentity(owner.workspaceId) &&
    Number.isSafeInteger(owner.workspaceEpoch) &&
    owner.workspaceEpoch >= 0 &&
    Number.isSafeInteger(owner.launchConfigurationVersion) &&
    owner.launchConfigurationVersion >= 0
  );
}

function ownersEqual(
  left: Readonly<NodeDebugCompoundOwner>,
  right: Readonly<NodeDebugCompoundOwner>,
): boolean {
  return (
    normalizedWorkspaceRootKey(left.rootPath) === normalizedWorkspaceRootKey(right.rootPath) &&
    left.workspaceId === right.workspaceId &&
    left.workspaceEpoch === right.workspaceEpoch &&
    left.launchConfigurationVersion === right.launchConfigurationVersion
  );
}

function safeIdentity(value: string): boolean {
  return (
    value.length > 0 &&
    UTF8_ENCODER.encode(value).byteLength <= MAX_NODE_DEBUG_COMPOUND_IDENTITY_BYTES &&
    !/[\p{Cc}\u2028\u2029]/u.test(value)
  );
}

function validSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

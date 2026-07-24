import { validateNodeDebugPostTask, type NodeDebugPostTask } from "../domain/nodeDebugPostTask";
import { normalizedWorkspaceRootKey } from "../domain/workspaceRootKey";

export const POST_DEBUG_TASK_CLEANUP_ERROR = "Unable to finish debug session cleanup.";
export const POST_DEBUG_TASK_REVALIDATION_ERROR = "Unable to validate the post-debug task.";
export const POST_DEBUG_TASK_RUN_ERROR = "Unable to run the post-debug task.";
export const MAX_PENDING_POST_DEBUG_TERMINALS = 32;

export interface PostDebugTaskWorkspaceIdentity {
  readonly rootPath: string;
  readonly workspaceEpoch: number;
  readonly workspaceId: string;
}

export interface PostDebugTaskSessionIdentity extends PostDebugTaskWorkspaceIdentity {
  readonly sessionId: number;
}

export interface PostDebugTaskTerminalIdentity {
  readonly rootPath: string;
  readonly sessionId: number;
}

export interface PostDebugTaskArmRequest extends PostDebugTaskSessionIdentity {
  readonly task: NodeDebugPostTask;
  /** Completes teardown of the exact terminated session before any task validation. */
  cleanup(): void | Promise<void>;
  /** Reopens and revalidates the private task immediately before execution. */
  revalidate(
    task: NodeDebugPostTask,
    identity: PostDebugTaskSessionIdentity,
  ): boolean | Promise<boolean>;
  run(task: NodeDebugPostTask, identity: PostDebugTaskSessionIdentity): void | Promise<void>;
  /** Receives only fixed generic messages; raw errors and task labels stay private. */
  reportError?(message: string): void;
}

export type PostDebugTaskTerminalResult =
  | { readonly kind: "buffered" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "completed" }
  | { readonly kind: "failed" }
  | { readonly kind: "ignored" };

export type PostDebugTaskSettlementResult = Extract<
  PostDebugTaskTerminalResult,
  { readonly kind: "cancelled" | "completed" | "failed" }
>;

declare const postDebugTaskLeaseBrand: unique symbol;

/**
 * Opaque authority for one accepted post-debug plan. It exposes only the
 * eventual generic settlement result; task and session identity stay private.
 */
export interface PostDebugTaskLease {
  readonly completion: Promise<PostDebugTaskSettlementResult>;
  readonly [postDebugTaskLeaseBrand]: true;
}

export type PostDebugTaskArmResult =
  | {
      readonly kind: "armed";
      readonly lease: PostDebugTaskLease;
    }
  | {
      readonly kind: "settling";
      readonly completion: Promise<PostDebugTaskTerminalResult>;
      readonly lease: PostDebugTaskLease;
    }
  | { readonly kind: "rejected" };

export type PostDebugTaskCoordinatorSnapshot =
  | { readonly kind: "idle"; readonly occupied: false }
  | { readonly kind: "armed"; readonly occupied: false }
  | { readonly kind: "settling"; readonly occupied: true }
  | { readonly kind: "disposed"; readonly occupied: false };

interface ArmedPlan {
  readonly generation: number;
  readonly identity: PostDebugTaskSessionIdentity;
  readonly lease: PostDebugTaskLease;
  readonly resolveLease: (result: PostDebugTaskSettlementResult) => void;
  readonly task: NodeDebugPostTask;
  readonly cleanup: PostDebugTaskArmRequest["cleanup"];
  readonly revalidate: PostDebugTaskArmRequest["revalidate"];
  readonly run: PostDebugTaskArmRequest["run"];
  readonly reportError?: PostDebugTaskArmRequest["reportError"];
}

interface ActivePlan extends ArmedPlan {
  cancelled: boolean;
}

const IDLE_SNAPSHOT: PostDebugTaskCoordinatorSnapshot = Object.freeze({
  kind: "idle",
  occupied: false,
});
const ARMED_SNAPSHOT: PostDebugTaskCoordinatorSnapshot = Object.freeze({
  kind: "armed",
  occupied: false,
});
const SETTLING_SNAPSHOT: PostDebugTaskCoordinatorSnapshot = Object.freeze({
  kind: "settling",
  occupied: true,
});
const DISPOSED_SNAPSHOT: PostDebugTaskCoordinatorSnapshot = Object.freeze({
  kind: "disposed",
  occupied: false,
});
const CANCELLED_RESULT: PostDebugTaskSettlementResult = Object.freeze({ kind: "cancelled" });
const IGNORED_RESULT: PostDebugTaskTerminalResult = Object.freeze({ kind: "ignored" });

/**
 * Owns one private post-debug recipe. Terminal events may precede start
 * acceptance, so a bounded exact root/session tombstone bridges that race.
 */
export class PostDebugTaskCoordinator {
  private active: ActivePlan | null = null;
  private armed: ArmedPlan | null = null;
  private disposed = false;
  private generation = 0;
  private settledLease: PostDebugTaskLease | null = null;
  private readonly consumedTerminals = new Map<string, true>();
  private readonly pendingTerminals = new Map<string, PostDebugTaskTerminalIdentity>();

  armAfterAcceptedSession(request: PostDebugTaskArmRequest): PostDebugTaskArmResult {
    if (this.disposed || this.armed || this.active) {
      return Object.freeze({ kind: "rejected" });
    }
    const plan = this.createPlan(request);
    if (!plan) return Object.freeze({ kind: "rejected" });

    this.settledLease = null;
    this.armed = plan;
    const terminalKey = postDebugTerminalKey(plan.identity);
    if (!this.pendingTerminals.delete(terminalKey)) {
      return Object.freeze({ kind: "armed", lease: plan.lease });
    }

    const completion = this.beginSettlement(plan);
    return Object.freeze({ kind: "settling", completion, lease: plan.lease });
  }

  /**
   * Starts the exact leased settlement when it is still armed, or joins the
   * same promise when its terminal event already started or completed it.
   */
  settleExact(lease: PostDebugTaskLease): Promise<PostDebugTaskTerminalResult> {
    if (!isLeaseCandidate(lease)) return Promise.resolve(IGNORED_RESULT);
    const armed = this.armed;
    if (armed && armed.lease === lease) return this.beginSettlement(armed);
    const active = this.active;
    if ((active && active.lease === lease) || this.settledLease === lease) {
      return lease.completion;
    }
    return Promise.resolve(IGNORED_RESULT);
  }

  handleTerminal(terminal: PostDebugTaskTerminalIdentity): Promise<PostDebugTaskTerminalResult> {
    if (this.disposed || !isTerminalIdentity(terminal)) {
      return Promise.resolve(IGNORED_RESULT);
    }

    const armed = this.armed;
    if (armed) {
      return terminalMatches(armed.identity, terminal)
        ? this.beginSettlement(armed)
        : Promise.resolve(IGNORED_RESULT);
    }
    if (this.active) {
      return Promise.resolve(IGNORED_RESULT);
    }

    const key = postDebugTerminalKey(terminal);
    if (this.consumedTerminals.has(key)) {
      return Promise.resolve(IGNORED_RESULT);
    }
    if (this.pendingTerminals.has(key)) {
      return Promise.resolve(IGNORED_RESULT);
    }
    if (this.pendingTerminals.size >= MAX_PENDING_POST_DEBUG_TERMINALS) {
      const oldest = this.pendingTerminals.keys().next().value;
      if (oldest !== undefined) this.pendingTerminals.delete(oldest);
    }
    this.pendingTerminals.set(key, Object.freeze({ ...terminal }));
    return Promise.resolve(Object.freeze({ kind: "buffered" }));
  }

  invalidate(identity: PostDebugTaskWorkspaceIdentity): boolean {
    if (!isWorkspaceIdentity(identity)) return false;
    let changed = false;
    for (const [key, terminal] of this.pendingTerminals) {
      if (!rootPathsMatch(terminal.rootPath, identity.rootPath)) continue;
      this.pendingTerminals.delete(key);
      changed = true;
    }
    if (this.armed && workspaceMatches(this.armed.identity, identity)) {
      this.resolveCancelled(this.armed);
      this.armed = null;
      changed = true;
    }
    if (this.active && workspaceMatches(this.active.identity, identity)) {
      this.active.cancelled = true;
      changed = true;
    }
    return changed;
  }

  snapshot(): PostDebugTaskCoordinatorSnapshot {
    if (this.disposed) return DISPOSED_SNAPSHOT;
    if (this.armed) return ARMED_SNAPSHOT;
    if (this.active) return SETTLING_SNAPSHOT;
    return IDLE_SNAPSHOT;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.cancelCurrent();
    this.consumedTerminals.clear();
    this.pendingTerminals.clear();
  }

  private createPlan(request: PostDebugTaskArmRequest): ArmedPlan | null {
    const validatedTask = validateNodeDebugPostTask(request.task?.label);
    if (
      !isSessionIdentity(request) ||
      validatedTask.kind !== "valid" ||
      typeof request.cleanup !== "function" ||
      typeof request.revalidate !== "function" ||
      typeof request.run !== "function" ||
      (request.reportError !== undefined && typeof request.reportError !== "function")
    ) {
      return null;
    }
    this.generation = this.generation === Number.MAX_SAFE_INTEGER ? 1 : this.generation + 1;
    let resolveLease!: (result: PostDebugTaskSettlementResult) => void;
    const completion = new Promise<PostDebugTaskSettlementResult>((resolve) => {
      resolveLease = resolve;
    });
    const lease = Object.freeze({ completion }) as PostDebugTaskLease;
    return Object.freeze({
      cleanup: request.cleanup,
      generation: this.generation,
      identity: Object.freeze({
        rootPath: request.rootPath,
        sessionId: request.sessionId,
        workspaceEpoch: request.workspaceEpoch,
        workspaceId: request.workspaceId,
      }),
      lease,
      reportError: request.reportError,
      revalidate: request.revalidate,
      resolveLease,
      run: request.run,
      task: validatedTask.task,
    });
  }

  private beginSettlement(plan: ArmedPlan): Promise<PostDebugTaskTerminalResult> {
    if (this.armed !== plan) return Promise.resolve(IGNORED_RESULT);
    this.armed = null;
    this.rememberConsumed(postDebugTerminalKey(plan.identity));

    const active: ActivePlan = {
      ...plan,
      cancelled: false,
    };
    this.active = active;
    void this.settle(active).then(active.resolveLease);
    return active.lease.completion;
  }

  private async settle(active: ActivePlan): Promise<PostDebugTaskSettlementResult> {
    let result: PostDebugTaskSettlementResult;
    try {
      await active.cleanup();
    } catch {
      if (!this.isCurrent(active)) {
        return this.finish(active, CANCELLED_RESULT);
      }
      this.report(active, POST_DEBUG_TASK_CLEANUP_ERROR);
      result = Object.freeze({ kind: "failed" });
      return this.finish(active, result);
    }
    if (!this.isCurrent(active)) {
      return this.finish(active, Object.freeze({ kind: "cancelled" }));
    }

    let valid: boolean;
    try {
      valid = await active.revalidate(active.task, active.identity);
    } catch {
      if (!this.isCurrent(active)) {
        return this.finish(active, CANCELLED_RESULT);
      }
      this.report(active, POST_DEBUG_TASK_REVALIDATION_ERROR);
      result = Object.freeze({ kind: "failed" });
      return this.finish(active, result);
    }
    if (!valid || !this.isCurrent(active)) {
      return this.finish(active, Object.freeze({ kind: "cancelled" }));
    }

    try {
      await active.run(active.task, active.identity);
      if (!this.isCurrent(active)) {
        return this.finish(active, CANCELLED_RESULT);
      }
      result = Object.freeze({ kind: "completed" });
    } catch {
      if (!this.isCurrent(active)) {
        return this.finish(active, CANCELLED_RESULT);
      }
      this.report(active, POST_DEBUG_TASK_RUN_ERROR);
      result = Object.freeze({ kind: "failed" });
    }
    return this.finish(active, result);
  }

  private finish(
    active: ActivePlan,
    result: PostDebugTaskSettlementResult,
  ): PostDebugTaskSettlementResult {
    if (this.active === active) {
      this.active = null;
      this.settledLease = active.lease;
    }
    return result;
  }

  private isCurrent(active: ActivePlan): boolean {
    return !this.disposed && !active.cancelled && this.active === active;
  }

  private report(active: ActivePlan, message: string): void {
    try {
      active.reportError?.(message);
    } catch {
      // Reporting is deliberately best-effort and cannot alter lifecycle state.
    }
  }

  private cancelCurrent(): void {
    if (this.armed) {
      this.resolveCancelled(this.armed);
      this.armed = null;
    }
    if (this.active) {
      this.active.cancelled = true;
    }
  }

  private resolveCancelled(plan: ArmedPlan): void {
    this.settledLease = plan.lease;
    plan.resolveLease(CANCELLED_RESULT);
  }

  private rememberConsumed(key: string): void {
    if (this.consumedTerminals.size >= MAX_PENDING_POST_DEBUG_TERMINALS) {
      const oldest = this.consumedTerminals.keys().next().value;
      if (oldest !== undefined) this.consumedTerminals.delete(oldest);
    }
    this.consumedTerminals.set(key, true);
  }
}

function terminalMatches(
  identity: PostDebugTaskSessionIdentity,
  terminal: PostDebugTaskTerminalIdentity,
): boolean {
  return (
    rootPathsMatch(identity.rootPath, terminal.rootPath) &&
    identity.sessionId === terminal.sessionId
  );
}

function workspaceMatches(
  left: PostDebugTaskWorkspaceIdentity,
  right: PostDebugTaskWorkspaceIdentity,
): boolean {
  return (
    rootPathsMatch(left.rootPath, right.rootPath) &&
    left.workspaceEpoch === right.workspaceEpoch &&
    left.workspaceId === right.workspaceId
  );
}

function postDebugTerminalKey(identity: PostDebugTaskTerminalIdentity): string {
  return `${normalizedWorkspaceRootKey(identity.rootPath)}\0${identity.sessionId}`;
}

function rootPathsMatch(left: string, right: string): boolean {
  return normalizedWorkspaceRootKey(left) === normalizedWorkspaceRootKey(right);
}

function isTerminalIdentity(value: PostDebugTaskTerminalIdentity): boolean {
  return safeIdentityString(value.rootPath) && isSessionId(value.sessionId);
}

function isWorkspaceIdentity(value: PostDebugTaskWorkspaceIdentity): boolean {
  return (
    safeIdentityString(value.rootPath) &&
    safeIdentityString(value.workspaceId) &&
    Number.isSafeInteger(value.workspaceEpoch) &&
    value.workspaceEpoch >= 0
  );
}

function isSessionIdentity(value: PostDebugTaskSessionIdentity): boolean {
  return isWorkspaceIdentity(value) && isSessionId(value.sessionId);
}

function isSessionId(value: number): boolean {
  return Number.isSafeInteger(value) && value > 0;
}

function safeIdentityString(value: string): boolean {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 4_096 &&
    !/[\0-\x1f\x7f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u.test(value)
  );
}

function isLeaseCandidate(value: unknown): value is PostDebugTaskLease {
  return typeof value === "object" && value !== null;
}

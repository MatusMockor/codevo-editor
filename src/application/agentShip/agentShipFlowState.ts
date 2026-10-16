import {
  agentShipReducer,
  agentShipStatus,
  agentShipTransitionAllowed,
  initialAgentShipState,
  type AgentShipAction,
  type AgentShipFailure,
  type AgentShipState,
  type AgentShipStep,
  type AgentShipStepResult,
} from "../../domain/agentShip";
import { runningTurn, type AgentThreadIntegration } from "../../domain/agentThread";
import type { GitShipStatus } from "../../domain/gitIntegration";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  isCurrentProjectOwner,
  projectAuthority,
  projectByOwnerId,
  warning,
  type AgentProjectAuthority,
} from "../agentProjectAuthority";
import { reconcile } from "../agentShipPolicy";
import {
  AGENT_SHIP_STATUS_FRESHNESS_MS,
  type AgentShipFlowDependencies,
} from "./agentShipFlowContract";
import {
  EMPTY_RECEIPT,
  MISSING_WORKTREE_MESSAGE,
  STEP_IN_FLIGHT_MESSAGE,
  STEP_SUCCEEDED,
  STOP_AGENT_MESSAGE,
  THREAD_UNAVAILABLE_MESSAGE,
  boundedMessage,
  gitErrorFailure,
  notRun,
} from "./agentShipFailures";

export interface ShipTarget {
  readonly kind: "target";
  readonly threadId: string;
  readonly authority: AgentProjectAuthority;
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly targetPath: string;
}

interface TargetUnavailable {
  readonly kind: "unavailable";
  readonly message: string;
  readonly notify: boolean;
}

export interface AgentShipFlowState {
  readonly dependenciesRef: { current: AgentShipFlowDependencies };
  readonly mountedRef: { current: boolean };
  states: ReadonlyMap<string, AgentShipState>;
  readonly setStates: (states: ReadonlyMap<string, AgentShipState>) => void;
  readonly inFlight: Set<string>;
  readonly statusLoadedAt: Map<string, number>;
  readonly refreshGenerations: Map<string, number>;
  readonly receipts: Map<string, AgentThreadIntegration>;
}

export function createAgentShipFlowState(
  dependencies: AgentShipFlowDependencies,
  setStates: (states: ReadonlyMap<string, AgentShipState>) => void,
): AgentShipFlowState {
  return {
    dependenciesRef: { current: dependencies },
    mountedRef: { current: true },
    states: new Map(),
    setStates,
    inFlight: new Set(),
    statusLoadedAt: new Map(),
    refreshGenerations: new Map(),
    receipts: new Map(),
  };
}

function unavailable(message: string, notify: boolean): TargetUnavailable {
  return { kind: "unavailable", message, notify };
}

export function shipNowMs(state: AgentShipFlowState): number {
  return (state.dependenciesRef.current.now ?? Date.now)();
}

export function currentShipState(state: AgentShipFlowState, threadId: string): AgentShipState {
  const known = state.states.get(threadId);
  if (known !== undefined) return known;
  return initialAgentShipState(
    state.dependenciesRef.current.threads.get(threadId)?.integration ?? null,
  );
}

function publish(state: AgentShipFlowState, threadId: string, next: AgentShipState): void {
  if (!state.mountedRef.current) return;
  state.states = new Map(state.states).set(threadId, next);
  state.setStates(state.states);
}

export function applyShip(
  state: AgentShipFlowState,
  threadId: string,
  action: AgentShipAction,
): void {
  publish(state, threadId, agentShipReducer(currentShipState(state, threadId), action));
}

export function shipAllowed(
  state: AgentShipFlowState,
  threadId: string,
  action: AgentShipAction,
): boolean {
  return agentShipTransitionAllowed(currentShipState(state, threadId), action);
}

export function ownsTarget(state: AgentShipFlowState, target: ShipTarget): boolean {
  return isCurrentProjectOwner(
    state.dependenciesRef,
    state.mountedRef,
    target.authority,
    target.repositoryRoot,
  );
}

export function ownsStoppedTarget(state: AgentShipFlowState, target: ShipTarget): boolean {
  if (!ownsTarget(state, target)) return false;
  const deps = state.dependenciesRef.current;
  const thread = deps.threads.get(target.threadId);
  if (thread === undefined) return false;
  if (runningTurn(thread) !== null) return false;
  if (deps.missingWorktreeThreadIds.has(target.threadId)) return false;
  if (thread.owner.rootKey !== target.authority.rootKey) return false;
  if (thread.owner.ownerId !== target.authority.ownerId) return false;
  if (thread.owner.repositoryRoot !== target.repositoryRoot) return false;
  if (thread.target.worktreePath !== target.worktreePath) return false;
  return (thread.target.worktreePath ?? thread.owner.repositoryRoot) === target.targetPath;
}

export function loadShipStatus(
  state: AgentShipFlowState,
  target: ShipTarget,
): Promise<GitShipStatus> {
  return state.dependenciesRef.current.gitIntegrationGateway.getShipStatus({
    repositoryRoot: target.repositoryRoot,
    worktreePath: target.worktreePath,
  });
}

export function publishShipStatus(
  state: AgentShipFlowState,
  threadId: string,
  status: GitShipStatus,
): void {
  state.statusLoadedAt.set(threadId, shipNowMs(state));
  const loaded = agentShipReducer(currentShipState(state, threadId), {
    kind: "statusLoaded",
    status,
  });
  publish(state, threadId, reconcile(loaded, status));
}

export function persistReceipt(
  state: AgentShipFlowState,
  threadId: string,
  patch: Partial<AgentThreadIntegration>,
): void {
  const thread = state.dependenciesRef.current.threads.get(threadId);
  if (thread === undefined) return;
  const integration: AgentThreadIntegration = {
    ...EMPTY_RECEIPT,
    ...thread.integration,
    ...state.receipts.get(threadId),
    ...patch,
  };
  state.receipts.set(threadId, integration);
  state.dependenciesRef.current.dispatchThreadAction({
    kind: "integrationRecorded",
    threadId,
    integration,
  });
}

function locateTarget(state: AgentShipFlowState, threadId: string): ShipTarget | TargetUnavailable {
  const deps = state.dependenciesRef.current;
  const thread = deps.threads.get(threadId);
  if (thread === undefined) return unavailable(THREAD_UNAVAILABLE_MESSAGE, false);
  if (runningTurn(thread) !== null) return unavailable(STOP_AGENT_MESSAGE, true);
  if (deps.missingWorktreeThreadIds.has(threadId)) {
    return unavailable(MISSING_WORKTREE_MESSAGE, true);
  }
  const project = projectByOwnerId(deps.projects, thread.owner.ownerId);
  if (project === undefined) return unavailable(THREAD_UNAVAILABLE_MESSAGE, false);
  const worktreePath = thread.target.worktreePath;
  return {
    kind: "target",
    threadId,
    authority: projectAuthority(project, thread.owner.ownerId),
    repositoryRoot: thread.owner.repositoryRoot,
    worktreePath,
    targetPath: worktreePath ?? thread.owner.repositoryRoot,
  };
}

export async function refreshShipStatus(
  state: AgentShipFlowState,
  threadId: string,
): Promise<void> {
  const target = locateTarget(state, threadId);
  if (target.kind !== "target") return;
  const generation = (state.refreshGenerations.get(threadId) ?? 0) + 1;
  state.refreshGenerations.set(threadId, generation);
  if (currentShipState(state, threadId).kind === "idle") {
    applyShip(state, threadId, { kind: "statusRequested" });
  }
  const loaded = await attempt(() => loadShipStatus(state, target));
  if (state.refreshGenerations.get(threadId) !== generation) return;
  if (!ownsTarget(state, target)) return;
  if (loaded.ok) {
    publishShipStatus(state, threadId, loaded.value);
    return;
  }
  state.dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
  applyShip(state, threadId, { kind: "statusFailed", message: boundedMessage(loaded.error) });
}

export function stepFailed(
  state: AgentShipFlowState,
  threadId: string,
  failed: AgentShipFailure,
): AgentShipStepResult {
  applyShip(state, threadId, { kind: "stepFailed", failure: failed });
  return { kind: "failed", failure: failed };
}

export function authorityLost(
  state: AgentShipFlowState,
  threadId: string,
  step: AgentShipStep,
): AgentShipStepResult {
  return stepFailed(state, threadId, { step, reason: "authorityLost" });
}

export function clearShip(state: AgentShipFlowState, threadId: string): void {
  state.statusLoadedAt.delete(threadId);
  state.refreshGenerations.delete(threadId);
  state.receipts.delete(threadId);
  if (!state.states.has(threadId)) return;
  const next = new Map(state.states);
  next.delete(threadId);
  state.states = next;
  if (state.mountedRef.current) state.setStates(next);
}

export function settledWithoutOwner(
  state: AgentShipFlowState,
  threadId: string,
): AgentShipStepResult {
  clearShip(state, threadId);
  return STEP_SUCCEEDED;
}

export async function runShipStep(
  state: AgentShipFlowState,
  threadId: string,
  step: AgentShipStep,
  operation: (target: ShipTarget) => Promise<AgentShipStepResult>,
): Promise<AgentShipStepResult> {
  if (state.inFlight.has(threadId)) return notRun(STEP_IN_FLIGHT_MESSAGE);
  const located = locateTarget(state, threadId);
  if (located.kind === "unavailable") {
    if (located.notify) state.dependenciesRef.current.setNotice(warning(located.message));
    return notRun(located.message);
  }
  state.inFlight.add(threadId);
  try {
    return await operation(located);
  } catch (error) {
    state.dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
    if (!ownsTarget(state, located)) return authorityLost(state, threadId, step);
    return stepFailed(state, threadId, gitErrorFailure(step, error));
  } finally {
    state.inFlight.delete(threadId);
  }
}

export async function runShipOperation(
  state: AgentShipFlowState,
  threadId: string,
  step: AgentShipStep,
  operation: (target: ShipTarget) => Promise<unknown>,
): Promise<void> {
  await runShipStep(state, threadId, step, async (target) => {
    await operation(target);
    return STEP_SUCCEEDED;
  });
}

export async function freshShipStatus(
  state: AgentShipFlowState,
  threadId: string,
  target: ShipTarget,
): Promise<GitShipStatus | null> {
  const known = agentShipStatus(currentShipState(state, threadId));
  const loadedAt = state.statusLoadedAt.get(threadId) ?? Number.NEGATIVE_INFINITY;
  if (known !== null && shipNowMs(state) - loadedAt <= AGENT_SHIP_STATUS_FRESHNESS_MS) {
    return known;
  }
  const status = await loadShipStatus(state, target);
  if (!ownsTarget(state, target)) return null;
  publishShipStatus(state, threadId, status);
  return status;
}

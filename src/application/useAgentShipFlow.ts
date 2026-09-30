import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { AgentProjectDescriptor } from "../domain/agentProject";
import {
  runningTurn,
  type AgentThread,
  type AgentThreadIntegration,
  type AgentThreadsAction,
} from "../domain/agentThread";
import {
  MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES,
  MAX_AGENT_SHIP_FAILURE_BYTES,
  agentShipReducer,
  agentShipStatus,
  agentShipTransitionAllowed,
  initialAgentShipState,
  type AgentShipAction,
  type AgentShipFailure,
  type AgentShipIntegrationMode,
  type AgentShipState,
  type AgentShipStep,
  type AgentShipStepResult,
} from "../domain/agentShip";
import type { GitGateway } from "../domain/git";
import {
  ALL_CHANGES,
  STALE_COMMIT_SELECTION_MESSAGE,
  selectCommitChanges,
  type AgentCommitSelection,
} from "../domain/gitCommitSelection";
import {
  MAX_GIT_INTEGRATION_MESSAGE_BYTES,
  type GitIntegrationGateway,
  type GitShipStatus,
} from "../domain/gitIntegration";
import type { GitWorktreeGateway } from "../domain/gitWorktree";
import {
  AGENT_TASKS_SOURCE,
  attempt,
  errorMessageOf,
  failure,
  info,
  isCurrentProjectOwner,
  projectAuthority,
  projectByOwnerId,
  warning,
  type AgentProjectAuthority,
} from "./agentProjectAuthority";
import { reconcile } from "./agentShipPolicy";
import type { AgentTasksNotice } from "./agentThreadPorts";
import { confirmWorkbenchAction, type WorkbenchPrompter } from "./workbenchPrompter";
import {
  gateWorktreeRemoval,
  removeUnderLease,
  sharedWorktreeRefusal,
} from "./agentSharedWorktreeRemoval";
import type { AgentWorktreeUseRegistry } from "./agentWorktreeUseRegistry";

export const AGENT_SHIP_STATUS_FRESHNESS_MS = 30_000;
export const DIRTY_WORKTREE_REMOVE_CONFIRMATION =
  "This worktree has uncommitted changes. Remove it and discard them?";

const PUSH_FAILURE_REASONS: ReadonlySet<string> = new Set([
  "noRemote",
  "rejected",
  "authRequired",
  "gitError",
]);
const EMPTY_RECEIPT: AgentThreadIntegration = Object.freeze({
  lastCommitSha: null,
  pushed: null,
  integrated: null,
  branchDeleted: false,
});

export interface ExternalUrlOpenerPort {
  openExternal(url: string): Promise<void>;
}

export interface AgentShipFlowDependencies {
  readonly gitGateway: Pick<GitGateway, "getStatus" | "stageFiles" | "commit" | "deleteBranch">;
  readonly gitIntegrationGateway: GitIntegrationGateway;
  readonly gitWorktreeGateway: Pick<GitWorktreeGateway, "removeWorktree">;
  readonly externalUrlOpener: ExternalUrlOpenerPort | null;
  readonly prompter: WorkbenchPrompter;
  readonly projects: ReadonlyArray<AgentProjectDescriptor>;
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly missingWorktreeThreadIds: ReadonlySet<string>;
  readonly dispatchThreadAction: (action: AgentThreadsAction) => void;
  readonly reportError: (source: string, error: unknown) => void;
  readonly setNotice: (notice: AgentTasksNotice | null) => void;
  readonly onWorktreeRemoved: (threadId: string) => void;
  readonly onShipStepCompleted?: (threadId: string) => void;
  readonly now?: () => number;
  readonly worktreeUses?: AgentWorktreeUseRegistry;
  readonly currentThreads?: () => ReadonlyMap<string, AgentThread>;
}

export interface AgentShipFlowSurface {
  readonly states: ReadonlyMap<string, AgentShipState>;
  refreshShipStatus(threadId: string): Promise<void>;
  commit(
    threadId: string,
    message: string,
    selection?: AgentCommitSelection,
  ): Promise<AgentShipStepResult>;
  push(threadId: string): Promise<AgentShipStepResult>;
  openCompareUrl(threadId: string): Promise<void>;
  integrate(threadId: string, mode: AgentShipIntegrationMode): Promise<void>;
  removeWorktree(threadId: string, options: { readonly deleteBranch: boolean }): Promise<void>;
  resetShip(threadId: string): void;
  clear(threadId: string): void;
}

interface ShipTarget {
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

const THREAD_UNAVAILABLE_MESSAGE = "This thread cannot ship changes right now.";
const STOP_AGENT_MESSAGE = "Stop the agent before shipping its changes.";
const MISSING_WORKTREE_MESSAGE = "The worktree no longer exists.";
const COMMIT_MESSAGE_LIMIT_MESSAGE = `Enter a commit message of at most ${MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES} bytes.`;
const COMMITTED_STATUS_UNAVAILABLE_MESSAGE =
  "The commit was created, but its status could not be refreshed.";
const STEP_IN_FLIGHT_MESSAGE = "Another Git step is still running for this thread.";
const STEP_SUCCEEDED: AgentShipStepResult = Object.freeze({ kind: "succeeded" });

function unavailable(message: string, notify: boolean): TargetUnavailable {
  return { kind: "unavailable", message, notify };
}

function notRun(message: string): AgentShipStepResult {
  return { kind: "notRun", message };
}

export function useAgentShipFlow(dependencies: AgentShipFlowDependencies): AgentShipFlowSurface {
  const [states, setStates] = useState<ReadonlyMap<string, AgentShipState>>(() => new Map());
  const dependenciesRef = useRef(dependencies);
  const statesRef = useRef(states);
  const mountedRef = useRef(true);
  const inFlightRef = useRef<Set<string>>(new Set());
  const statusLoadedAtRef = useRef<Map<string, number>>(new Map());
  const refreshGenerationRef = useRef<Map<string, number>>(new Map());
  const receiptsRef = useRef<Map<string, AgentThreadIntegration>>(new Map());

  useLayoutEffect(() => {
    dependenciesRef.current = dependencies;
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const nowMs = useCallback((): number => (dependenciesRef.current.now ?? Date.now)(), []);

  const currentState = useCallback((threadId: string): AgentShipState => {
    const known = statesRef.current.get(threadId);
    if (known !== undefined) return known;
    return initialAgentShipState(
      dependenciesRef.current.threads.get(threadId)?.integration ?? null,
    );
  }, []);

  const publish = useCallback((threadId: string, next: AgentShipState): void => {
    if (!mountedRef.current) return;
    statesRef.current = new Map(statesRef.current).set(threadId, next);
    setStates(statesRef.current);
  }, []);

  const apply = useCallback(
    (threadId: string, action: AgentShipAction): void => {
      publish(threadId, agentShipReducer(currentState(threadId), action));
    },
    [currentState, publish],
  );

  const allowed = useCallback(
    (threadId: string, action: AgentShipAction): boolean =>
      agentShipTransitionAllowed(currentState(threadId), action),
    [currentState],
  );

  const owns = useCallback(
    (target: ShipTarget): boolean =>
      isCurrentProjectOwner(dependenciesRef, mountedRef, target.authority, target.repositoryRoot),
    [],
  );

  const ownsStoppedTarget = useCallback(
    (target: ShipTarget): boolean => {
      if (!owns(target)) return false;
      const deps = dependenciesRef.current;
      const thread = deps.threads.get(target.threadId);
      if (thread === undefined) return false;
      if (runningTurn(thread) !== null) return false;
      if (deps.missingWorktreeThreadIds.has(target.threadId)) return false;
      if (thread.owner.rootKey !== target.authority.rootKey) return false;
      if (thread.owner.ownerId !== target.authority.ownerId) return false;
      if (thread.owner.repositoryRoot !== target.repositoryRoot) return false;
      if (thread.target.worktreePath !== target.worktreePath) return false;
      return (thread.target.worktreePath ?? thread.owner.repositoryRoot) === target.targetPath;
    },
    [owns],
  );

  const loadStatus = useCallback(
    (target: ShipTarget): Promise<GitShipStatus> =>
      dependenciesRef.current.gitIntegrationGateway.getShipStatus({
        repositoryRoot: target.repositoryRoot,
        worktreePath: target.worktreePath,
      }),
    [],
  );

  const publishStatus = useCallback(
    (threadId: string, status: GitShipStatus): void => {
      statusLoadedAtRef.current.set(threadId, nowMs());
      const loaded = agentShipReducer(currentState(threadId), { kind: "statusLoaded", status });
      publish(threadId, reconcile(loaded, status));
    },
    [currentState, nowMs, publish],
  );

  const persistReceipt = useCallback(
    (threadId: string, patch: Partial<AgentThreadIntegration>): void => {
      const thread = dependenciesRef.current.threads.get(threadId);
      if (thread === undefined) return;
      const integration: AgentThreadIntegration = {
        ...EMPTY_RECEIPT,
        ...thread.integration,
        ...receiptsRef.current.get(threadId),
        ...patch,
      };
      receiptsRef.current.set(threadId, integration);
      dependenciesRef.current.dispatchThreadAction({
        kind: "integrationRecorded",
        threadId,
        integration,
      });
    },
    [],
  );

  const locateTarget = useCallback((threadId: string): ShipTarget | TargetUnavailable => {
    const deps = dependenciesRef.current;
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
  }, []);

  const resolveTarget = useCallback(
    (threadId: string, quiet: boolean): ShipTarget | null => {
      const located = locateTarget(threadId);
      if (located.kind === "target") return located;
      if (!quiet && located.notify) dependenciesRef.current.setNotice(warning(located.message));
      return null;
    },
    [locateTarget],
  );

  const refreshShipStatus = useCallback(
    async (threadId: string): Promise<void> => {
      const target = resolveTarget(threadId, true);
      if (target === null) return;
      const generation = (refreshGenerationRef.current.get(threadId) ?? 0) + 1;
      refreshGenerationRef.current.set(threadId, generation);
      if (currentState(threadId).kind === "idle") apply(threadId, { kind: "statusRequested" });
      const loaded = await attempt(() => loadStatus(target));
      if (refreshGenerationRef.current.get(threadId) !== generation) return;
      if (!owns(target)) return;
      if (loaded.ok) {
        publishStatus(threadId, loaded.value);
        return;
      }
      dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
      apply(threadId, { kind: "statusFailed", message: boundedMessage(loaded.error) });
    },
    [apply, currentState, loadStatus, owns, publishStatus, resolveTarget],
  );

  const authorityLost = useCallback(
    (threadId: string, step: AgentShipStep): AgentShipStepResult => {
      const lost: AgentShipFailure = { step, reason: "authorityLost" };
      apply(threadId, { kind: "stepFailed", failure: lost });
      return { kind: "failed", failure: lost };
    },
    [apply],
  );

  const clear = useCallback((threadId: string): void => {
    statusLoadedAtRef.current.delete(threadId);
    refreshGenerationRef.current.delete(threadId);
    receiptsRef.current.delete(threadId);
    if (!statesRef.current.has(threadId)) return;
    const next = new Map(statesRef.current);
    next.delete(threadId);
    statesRef.current = next;
    if (mountedRef.current) setStates(next);
  }, []);

  const settledWithoutOwner = useCallback(
    (threadId: string): AgentShipStepResult => {
      clear(threadId);
      return STEP_SUCCEEDED;
    },
    [clear],
  );

  const stepFailed = useCallback(
    (threadId: string, failed: AgentShipFailure): AgentShipStepResult => {
      apply(threadId, { kind: "stepFailed", failure: failed });
      return { kind: "failed", failure: failed };
    },
    [apply],
  );

  const runStep = useCallback(
    async (
      threadId: string,
      step: AgentShipStep,
      operation: (target: ShipTarget) => Promise<AgentShipStepResult>,
    ): Promise<AgentShipStepResult> => {
      if (inFlightRef.current.has(threadId)) return notRun(STEP_IN_FLIGHT_MESSAGE);
      const located = locateTarget(threadId);
      if (located.kind === "unavailable") {
        if (located.notify) dependenciesRef.current.setNotice(warning(located.message));
        return notRun(located.message);
      }
      inFlightRef.current.add(threadId);
      try {
        return await operation(located);
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!owns(located)) return authorityLost(threadId, step);
        return stepFailed(threadId, gitErrorFailure(step, error));
      } finally {
        inFlightRef.current.delete(threadId);
      }
    },
    [authorityLost, locateTarget, owns, stepFailed],
  );

  const run = useCallback(
    async (
      threadId: string,
      step: AgentShipStep,
      operation: (target: ShipTarget) => Promise<unknown>,
    ): Promise<void> => {
      await runStep(threadId, step, async (target) => {
        await operation(target);
        return STEP_SUCCEEDED;
      });
    },
    [runStep],
  );

  const commit = useCallback(
    (
      threadId: string,
      message: string,
      selection: AgentCommitSelection = ALL_CHANGES,
    ): Promise<AgentShipStepResult> =>
      runStep(threadId, "commit", async (target) => {
        const deps = dependenciesRef.current;
        const bounded = boundedCommitMessage(message);
        if (bounded === null) {
          deps.setNotice(warning(COMMIT_MESSAGE_LIMIT_MESSAGE));
          return notRun(COMMIT_MESSAGE_LIMIT_MESSAGE);
        }
        if (!allowed(threadId, { kind: "commitStarted", message: bounded })) {
          return notRun(STEP_IN_FLIGHT_MESSAGE);
        }
        apply(threadId, { kind: "commitStarted", message: bounded });
        const status = await deps.gitGateway.getStatus(target.targetPath);
        if (!owns(target)) return authorityLost(threadId, "commit");
        const selected = selectCommitChanges(status.changes, selection);
        if (selected.kind !== "ok") {
          const failed = stepFailed(threadId, selectionFailure(selected.kind));
          void refreshShipStatus(threadId);
          return failed;
        }
        const changes = [...selected.changes];
        await dependenciesRef.current.gitGateway.stageFiles(target.targetPath, changes);
        if (!owns(target)) return authorityLost(threadId, "commit");
        await dependenciesRef.current.gitGateway.commit(target.targetPath, bounded, changes);
        if (!owns(target)) return settledWithoutOwner(threadId);
        const loaded = await attempt(() => loadStatus(target));
        if (!owns(target)) return settledWithoutOwner(threadId);
        dependenciesRef.current.onShipStepCompleted?.(threadId);
        if (!loaded.ok) {
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
          stepFailed(threadId, {
            step: "commit",
            reason: "gitError",
            message: COMMITTED_STATUS_UNAVAILABLE_MESSAGE,
          });
          return STEP_SUCCEEDED;
        }
        const shipStatus = loaded.value;
        statusLoadedAtRef.current.set(threadId, nowMs());
        apply(threadId, {
          kind: "commitSucceeded",
          commitSha: shipStatus.worktree.head,
          status: shipStatus,
        });
        persistReceipt(threadId, { lastCommitSha: shipStatus.worktree.head });
        return STEP_SUCCEEDED;
      }),
    [
      allowed,
      apply,
      authorityLost,
      loadStatus,
      nowMs,
      owns,
      persistReceipt,
      refreshShipStatus,
      runStep,
      settledWithoutOwner,
      stepFailed,
    ],
  );

  const push = useCallback(
    (threadId: string): Promise<AgentShipStepResult> =>
      runStep(threadId, "push", async (target) => {
        if (!allowed(threadId, { kind: "pushStarted" })) return notRun(STEP_IN_FLIGHT_MESSAGE);
        apply(threadId, { kind: "pushStarted" });
        const pushed = await attempt(() =>
          dependenciesRef.current.gitIntegrationGateway.pushBranchUpstream({
            repositoryRoot: target.repositoryRoot,
            worktreePath: target.worktreePath,
          }),
        );
        if (!pushed.ok) {
          if (!owns(target)) return authorityLost(threadId, "push");
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, pushed.error);
          return stepFailed(threadId, pushFailure(pushed.error));
        }
        if (!owns(target)) return settledWithoutOwner(threadId);
        persistReceipt(threadId, {
          pushed: { remote: pushed.value.remote, branch: pushed.value.branch },
        });
        const status = await attempt(() => loadStatus(target));
        if (!owns(target)) return settledWithoutOwner(threadId);
        const known = status.ok ? status.value : agentShipStatus(currentState(threadId));
        if (known === null) {
          apply(threadId, {
            kind: "stepFailed",
            failure: {
              step: "push",
              reason: "gitError",
              message: "The branch was pushed, but its status could not be refreshed.",
            },
          });
          return STEP_SUCCEEDED;
        }
        if (status.ok) statusLoadedAtRef.current.set(threadId, nowMs());
        apply(threadId, { kind: "pushSucceeded", receipt: pushed.value, status: known });
        return STEP_SUCCEEDED;
      }),
    [
      allowed,
      apply,
      authorityLost,
      currentState,
      loadStatus,
      nowMs,
      owns,
      persistReceipt,
      runStep,
      settledWithoutOwner,
      stepFailed,
    ],
  );

  const openCompareUrl = useCallback(
    async (threadId: string): Promise<void> => {
      const deps = dependenciesRef.current;
      const state = currentState(threadId);
      if (state.kind !== "pushed") return;
      const url = state.receipt.compareUrl ?? state.status?.remote?.compareUrl ?? null;
      if (url === null) {
        deps.setNotice(
          info(`Pushed ${state.receipt.branch}. Open a pull request on your hosting site.`),
        );
        return;
      }
      const opener = deps.externalUrlOpener;
      if (opener === null) {
        deps.setNotice(info(`Open the compare page: ${url}`));
        return;
      }
      const opened = await attempt(() => opener.openExternal(url));
      if (!mountedRef.current) return;
      if (opened.ok) return;
      deps.reportError(AGENT_TASKS_SOURCE, opened.error);
      deps.setNotice(failure(`The compare page could not be opened: ${url}`));
    },
    [currentState],
  );

  const freshStatus = useCallback(
    async (threadId: string, target: ShipTarget): Promise<GitShipStatus | null> => {
      const known = agentShipStatus(currentState(threadId));
      const loadedAt = statusLoadedAtRef.current.get(threadId) ?? Number.NEGATIVE_INFINITY;
      if (known !== null && nowMs() - loadedAt <= AGENT_SHIP_STATUS_FRESHNESS_MS) return known;
      const status = await loadStatus(target);
      if (!owns(target)) return null;
      publishStatus(threadId, status);
      return status;
    },
    [currentState, loadStatus, nowMs, owns, publishStatus],
  );

  const integrate = useCallback(
    (threadId: string, mode: AgentShipIntegrationMode): Promise<void> =>
      run(threadId, "integrate", async (target) => {
        if (target.worktreePath === null) {
          dependenciesRef.current.setNotice(
            warning("Threads in the local checkout have nothing to integrate."),
          );
          return;
        }
        const status = await freshStatus(threadId, target);
        if (status === null) return;
        if (!allowed(threadId, { kind: "integrateStarted", mode })) return;
        const primaryBranch = status.primary.branch;
        if (primaryBranch === null) {
          apply(threadId, {
            kind: "stepFailed",
            failure: { step: "integrate", outcome: { kind: "primaryDetached" } },
          });
          return;
        }
        if (mode === "merge" && status.relation.behindPrimary > 0) {
          const confirmed = await confirmWorkbenchAction(
            dependenciesRef.current.prompter,
            `The branch is ${status.relation.behindPrimary} commits behind ${primaryBranch}. Merge anyway?`,
          );
          if (!ownsStoppedTarget(target)) return;
          if (!confirmed) return;
        }
        apply(threadId, { kind: "integrateStarted", mode });
        const thread = dependenciesRef.current.threads.get(threadId);
        const outcome = await dependenciesRef.current.gitIntegrationGateway.integrateWorktreeBranch(
          {
            repositoryRoot: target.repositoryRoot,
            worktreePath: target.worktreePath,
            mode,
            expectedPrimaryBranch: primaryBranch,
            expectedPrimaryHead: status.primary.head,
            expectedBranchHead: status.worktree.head,
            mergeMessage: mergeMessage(status.worktree.branch, thread?.title ?? ""),
          },
        );
        if (!owns(target)) {
          if (outcome.kind === "integrated") return settledWithoutOwner(threadId);
          return authorityLost(threadId, "integrate");
        }
        if (outcome.kind !== "integrated") {
          apply(threadId, { kind: "stepFailed", failure: { step: "integrate", outcome } });
          void refreshShipStatus(threadId);
          return;
        }
        persistReceipt(threadId, {
          integrated: { intoBranch: outcome.intoBranch, mergeSha: outcome.mergeSha, mode },
        });
        const refreshed = await attempt(() => loadStatus(target));
        if (!owns(target)) return settledWithoutOwner(threadId);
        if (refreshed.ok) statusLoadedAtRef.current.set(threadId, nowMs());
        apply(threadId, {
          kind: "integrateSucceeded",
          mergeSha: outcome.mergeSha,
          intoBranch: outcome.intoBranch,
          status: refreshed.ok ? refreshed.value : status,
        });
        dependenciesRef.current.onShipStepCompleted?.(threadId);
      }),
    [
      allowed,
      apply,
      authorityLost,
      freshStatus,
      loadStatus,
      nowMs,
      owns,
      ownsStoppedTarget,
      persistReceipt,
      refreshShipStatus,
      run,
      settledWithoutOwner,
    ],
  );

  const removeWorktree = useCallback(
    (threadId: string, options: { readonly deleteBranch: boolean }): Promise<void> =>
      run(threadId, "removeWorktree", async (target) => {
        const worktreePath = target.worktreePath;
        if (worktreePath === null) {
          dependenciesRef.current.setNotice(
            warning("Threads in the local checkout have no worktree to remove."),
          );
          return;
        }
        const shared = sharedWorktreeRefusal(
          liveShipThreads(dependenciesRef.current),
          threadId,
          worktreePath,
        );
        if (shared !== null) {
          dependenciesRef.current.setNotice(warning(shared));
          return;
        }
        const before = currentState(threadId);
        if (!allowed(threadId, { kind: "removeStarted", deleteBranch: options.deleteBranch }))
          return;
        const force = before.kind !== "integrated";
        const shipStatus = options.deleteBranch ? await freshStatus(threadId, target) : null;
        if (options.deleteBranch && shipStatus === null) return;
        const status = await dependenciesRef.current.gitGateway.getStatus(worktreePath);
        if (!owns(target)) return;
        const dirty = status.changes.length > 0;
        if (dirty) {
          const confirmed = await confirmWorkbenchAction(
            dependenciesRef.current.prompter,
            DIRTY_WORKTREE_REMOVE_CONFIRMATION,
          );
          if (!ownsStoppedTarget(target)) return;
          if (!confirmed) return;
        }
        const gate = gateWorktreeRemoval(
          liveShipThreads(dependenciesRef.current),
          dependenciesRef.current.worktreeUses,
          threadId,
          worktreePath,
        );
        if (gate.kind === "refused") {
          dependenciesRef.current.setNotice(warning(gate.message));
          return;
        }
        apply(threadId, { kind: "removeStarted", deleteBranch: options.deleteBranch });
        await removeUnderLease(gate.lease, () =>
          dependenciesRef.current.gitWorktreeGateway.removeWorktree(
            target.repositoryRoot,
            worktreePath,
            dirty,
          ),
        );
        if (!owns(target)) return settledWithoutOwner(threadId);
        dependenciesRef.current.onWorktreeRemoved(threadId);
        if (!options.deleteBranch || shipStatus === null) {
          apply(threadId, { kind: "removeSucceeded", branchDeleted: false });
          dependenciesRef.current.setNotice(
            info("The worktree was removed. Its local branch was kept."),
          );
          return;
        }
        const branch = shipStatus.worktree.branch;
        const deleted = await attempt(() =>
          deleteBranch(dependenciesRef.current, target, branch, force),
        );
        if (!owns(target)) {
          if (deleted.ok) return settledWithoutOwner(threadId);
          return authorityLost(threadId, "removeWorktree");
        }
        if (!deleted.ok) {
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, deleted.error);
          apply(threadId, {
            kind: "stepFailed",
            failure: branchDeleteFailure(branch, deleted.error),
          });
          return;
        }
        apply(threadId, { kind: "removeSucceeded", branchDeleted: true });
        persistReceipt(threadId, { branchDeleted: true });
        const remoteBranchWasPushed = (receiptsRef.current.get(threadId)?.pushed ?? null) !== null;
        const suffix = remoteBranchWasPushed ? " The remote branch was kept." : "";
        dependenciesRef.current.setNotice(
          info(`The worktree and local branch ${branch} were removed.${suffix}`),
        );
      }),
    [
      allowed,
      apply,
      authorityLost,
      currentState,
      freshStatus,
      owns,
      ownsStoppedTarget,
      persistReceipt,
      run,
      settledWithoutOwner,
    ],
  );

  const resetShip = useCallback(
    (threadId: string): void => apply(threadId, { kind: "reset" }),
    [apply],
  );

  return useMemo(
    () => ({
      states,
      refreshShipStatus,
      commit,
      push,
      openCompareUrl,
      integrate,
      removeWorktree,
      resetShip,
      clear,
    }),
    [
      clear,
      commit,
      integrate,
      openCompareUrl,
      push,
      refreshShipStatus,
      removeWorktree,
      resetShip,
      states,
    ],
  );
}

function deleteBranch(
  deps: AgentShipFlowDependencies,
  target: ShipTarget,
  branch: string,
  force: boolean,
): Promise<void> {
  const remove = deps.gitGateway.deleteBranch;
  if (remove === undefined) return Promise.reject(new Error("Branch deletion is not supported."));
  return remove.call(deps.gitGateway, target.repositoryRoot, branch, { force });
}

function boundedCommitMessage(message: string): string | null {
  const trimmed = message.trim();
  if (trimmed === "" || trimmed.includes("\u0000")) return null;
  if (new TextEncoder().encode(trimmed).byteLength > MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES)
    return null;
  return trimmed;
}

function selectionFailure(kind: "empty" | "stale"): AgentShipFailure {
  if (kind === "stale") {
    return { step: "commit", reason: "staleSelection", message: STALE_COMMIT_SELECTION_MESSAGE };
  }
  return { step: "commit", reason: "nothingToCommit", message: "Nothing to commit." };
}

function mergeMessage(branch: string, title: string): string {
  const cleanTitle = title.replace(/\p{Cc}/gu, " ").trim();
  const message = cleanTitle === "" ? `Merge ${branch}` : `Merge ${branch} (${cleanTitle})`;
  return truncateUtf8(message, MAX_GIT_INTEGRATION_MESSAGE_BYTES);
}

function truncateUtf8(text: string, maxBytes: number): string {
  const encoded = new TextEncoder().encode(text);
  if (encoded.byteLength <= maxBytes) return text;
  return new TextDecoder("utf-8").decode(encoded.subarray(0, maxBytes)).replace(/�+$/u, "");
}

function boundedMessage(error: unknown): string {
  const message = errorMessageOf(error)
    .replace(/[^\P{Cc}\n]/gu, "")
    .trim();
  return truncateUtf8(message, MAX_AGENT_SHIP_FAILURE_BYTES);
}

function gitErrorFailure(step: AgentShipStep, error: unknown): AgentShipFailure {
  const message = boundedMessage(error);
  switch (step) {
    case "commit":
      return { step, reason: "gitError", message };
    case "push":
      return { step, reason: "gitError", message };
    case "removeWorktree":
      return { step, reason: "gitError", message };
    case "integrate":
      return { step, reason: "gitError", message: message === "" ? "Git failed." : message };
    default:
      return unsupportedStep(step);
  }
}

function pushFailure(error: unknown): AgentShipFailure {
  const message = boundedMessage(error);
  if (typeof error !== "object" || error === null || !("reason" in error)) {
    return { step: "push", reason: "gitError", message };
  }
  const reason = (error as { reason: unknown }).reason;
  if (typeof reason !== "string" || !PUSH_FAILURE_REASONS.has(reason)) {
    return { step: "push", reason: "gitError", message };
  }
  return {
    step: "push",
    reason: reason as "noRemote" | "rejected" | "authRequired" | "gitError",
    message,
  };
}

function branchDeleteFailure(branch: string, error: unknown): AgentShipFailure {
  const detail = boundedMessage(error);
  const notMerged = /not fully merged/iu.test(detail);
  return {
    step: "removeWorktree",
    reason: notMerged ? "branchNotMerged" : "gitError",
    message: truncateUtf8(
      `The worktree was removed, but branch ${branch} was kept. ${detail}`.trim(),
      MAX_AGENT_SHIP_FAILURE_BYTES,
    ),
  };
}

function unsupportedStep(step: never): never {
  throw new TypeError(`Unsupported agent ship step: ${String(step)}.`);
}

function liveShipThreads(
  dependencies: AgentShipFlowDependencies,
): ReadonlyMap<string, AgentThread> {
  return dependencies.currentThreads?.() ?? dependencies.threads;
}

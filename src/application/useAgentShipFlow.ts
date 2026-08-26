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
} from "../domain/agentShip";
import type { GitGateway } from "../domain/git";
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
}

export interface AgentShipFlowSurface {
  readonly states: ReadonlyMap<string, AgentShipState>;
  refreshShipStatus(threadId: string): Promise<void>;
  commit(threadId: string, message: string): Promise<void>;
  push(threadId: string): Promise<void>;
  openCompareUrl(threadId: string): Promise<void>;
  integrate(threadId: string, mode: AgentShipIntegrationMode): Promise<void>;
  removeWorktree(threadId: string, options: { readonly deleteBranch: boolean }): Promise<void>;
  resetShip(threadId: string): void;
  clear(threadId: string): void;
}

interface ShipTarget {
  readonly threadId: string;
  readonly authority: AgentProjectAuthority;
  readonly repositoryRoot: string;
  readonly worktreePath: string | null;
  readonly targetPath: string;
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

  const resolveTarget = useCallback((threadId: string, quiet: boolean): ShipTarget | null => {
    const deps = dependenciesRef.current;
    const thread = deps.threads.get(threadId);
    if (thread === undefined) return null;
    if (runningTurn(thread) !== null) {
      if (!quiet) deps.setNotice(warning("Stop the agent before shipping its changes."));
      return null;
    }
    if (deps.missingWorktreeThreadIds.has(threadId)) {
      if (!quiet) deps.setNotice(warning("The worktree no longer exists."));
      return null;
    }
    const project = projectByOwnerId(deps.projects, thread.owner.ownerId);
    if (project === undefined) return null;
    const worktreePath = thread.target.worktreePath;
    return {
      threadId,
      authority: projectAuthority(project, thread.owner.ownerId),
      repositoryRoot: thread.owner.repositoryRoot,
      worktreePath,
      targetPath: worktreePath ?? thread.owner.repositoryRoot,
    };
  }, []);

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
    (threadId: string, step: AgentShipStep): void => {
      apply(threadId, { kind: "stepFailed", failure: { step, reason: "authorityLost" } });
    },
    [apply],
  );

  const run = useCallback(
    async (
      threadId: string,
      step: AgentShipStep,
      operation: (target: ShipTarget) => Promise<void>,
    ): Promise<void> => {
      if (inFlightRef.current.has(threadId)) return;
      const target = resolveTarget(threadId, false);
      if (target === null) return;
      inFlightRef.current.add(threadId);
      try {
        await operation(target);
      } catch (error) {
        dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, error);
        if (!owns(target)) return authorityLost(threadId, step);
        apply(threadId, { kind: "stepFailed", failure: gitErrorFailure(step, error) });
      } finally {
        inFlightRef.current.delete(threadId);
      }
    },
    [apply, authorityLost, owns, resolveTarget],
  );

  const commit = useCallback(
    (threadId: string, message: string): Promise<void> =>
      run(threadId, "commit", async (target) => {
        const deps = dependenciesRef.current;
        const bounded = boundedCommitMessage(message);
        if (bounded === null) {
          deps.setNotice(
            warning(
              `Enter a commit message of at most ${MAX_AGENT_SHIP_COMMIT_MESSAGE_BYTES} bytes.`,
            ),
          );
          return;
        }
        if (!allowed(threadId, { kind: "commitStarted", message: bounded })) return;
        apply(threadId, { kind: "commitStarted", message: bounded });
        const status = await deps.gitGateway.getStatus(target.targetPath);
        if (!owns(target)) return authorityLost(threadId, "commit");
        if (status.changes.length === 0) {
          apply(threadId, {
            kind: "stepFailed",
            failure: { step: "commit", reason: "nothingToCommit", message: "Nothing to commit." },
          });
          void refreshShipStatus(threadId);
          return;
        }
        await dependenciesRef.current.gitGateway.stageFiles(target.targetPath, status.changes);
        if (!owns(target)) return authorityLost(threadId, "commit");
        await dependenciesRef.current.gitGateway.commit(target.targetPath, bounded, status.changes);
        if (!owns(target)) return authorityLost(threadId, "commit");
        const shipStatus = await loadStatus(target);
        if (!owns(target)) return authorityLost(threadId, "commit");
        statusLoadedAtRef.current.set(threadId, nowMs());
        apply(threadId, {
          kind: "commitSucceeded",
          commitSha: shipStatus.worktree.head,
          status: shipStatus,
        });
        persistReceipt(threadId, { lastCommitSha: shipStatus.worktree.head });
        dependenciesRef.current.onShipStepCompleted?.(threadId);
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
      run,
    ],
  );

  const push = useCallback(
    (threadId: string): Promise<void> =>
      run(threadId, "push", async (target) => {
        if (!allowed(threadId, { kind: "pushStarted" })) return;
        apply(threadId, { kind: "pushStarted" });
        const pushed = await attempt(() =>
          dependenciesRef.current.gitIntegrationGateway.pushBranchUpstream({
            repositoryRoot: target.repositoryRoot,
            worktreePath: target.worktreePath,
          }),
        );
        if (!owns(target)) return authorityLost(threadId, "push");
        if (!pushed.ok) {
          dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, pushed.error);
          apply(threadId, { kind: "stepFailed", failure: pushFailure(pushed.error) });
          return;
        }
        persistReceipt(threadId, {
          pushed: { remote: pushed.value.remote, branch: pushed.value.branch },
        });
        const status = await attempt(() => loadStatus(target));
        if (!owns(target)) return authorityLost(threadId, "push");
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
          return;
        }
        if (status.ok) statusLoadedAtRef.current.set(threadId, nowMs());
        apply(threadId, { kind: "pushSucceeded", receipt: pushed.value, status: known });
      }),
    [allowed, apply, authorityLost, currentState, loadStatus, nowMs, owns, persistReceipt, run],
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
          dependenciesRef.current.setNotice(warning("In-place threads have nothing to integrate."));
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
        if (!owns(target)) return authorityLost(threadId, "integrate");
        if (outcome.kind !== "integrated") {
          apply(threadId, { kind: "stepFailed", failure: { step: "integrate", outcome } });
          void refreshShipStatus(threadId);
          return;
        }
        persistReceipt(threadId, {
          integrated: { intoBranch: outcome.intoBranch, mergeSha: outcome.mergeSha, mode },
        });
        const refreshed = await attempt(() => loadStatus(target));
        if (!owns(target)) return authorityLost(threadId, "integrate");
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
    ],
  );

  const removeWorktree = useCallback(
    (threadId: string, options: { readonly deleteBranch: boolean }): Promise<void> =>
      run(threadId, "removeWorktree", async (target) => {
        const worktreePath = target.worktreePath;
        if (worktreePath === null) {
          dependenciesRef.current.setNotice(
            warning("In-place threads have no worktree to remove."),
          );
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
        apply(threadId, { kind: "removeStarted", deleteBranch: options.deleteBranch });
        await dependenciesRef.current.gitWorktreeGateway.removeWorktree(
          target.repositoryRoot,
          worktreePath,
          dirty,
        );
        if (!owns(target)) return authorityLost(threadId, "removeWorktree");
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
        if (!owns(target)) return authorityLost(threadId, "removeWorktree");
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
    ],
  );

  const resetShip = useCallback(
    (threadId: string): void => apply(threadId, { kind: "reset" }),
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

import type { AgentThread } from "../../domain/agentThread";
import { AGENT_TASKS_SOURCE, attempt, info, warning } from "../agentProjectAuthority";
import {
  gateWorktreeRemoval,
  removeUnderLease,
  sharedWorktreeRefusal,
} from "../agentSharedWorktreeRemoval";
import { confirmWorkbenchAction } from "../workbenchPrompter";
import {
  DIRTY_WORKTREE_REMOVE_CONFIRMATION,
  type AgentShipFlowDependencies,
} from "./agentShipFlowContract";
import { branchDeleteFailure } from "./agentShipFailures";
import {
  applyShip,
  authorityLost,
  currentShipState,
  freshShipStatus,
  ownsStoppedTarget,
  ownsTarget,
  persistReceipt,
  runShipOperation,
  settledWithoutOwner,
  shipAllowed,
  type AgentShipFlowState,
  type ShipTarget,
} from "./agentShipFlowState";

export function removeShipWorktree(
  state: AgentShipFlowState,
  threadId: string,
  options: { readonly deleteBranch: boolean },
): Promise<void> {
  return runShipOperation(state, threadId, "removeWorktree", async (target) => {
    const worktreePath = target.worktreePath;
    if (worktreePath === null) {
      state.dependenciesRef.current.setNotice(
        warning("Threads in the local checkout have no worktree to remove."),
      );
      return;
    }
    const shared = sharedWorktreeRefusal(
      liveShipThreads(state.dependenciesRef.current),
      threadId,
      worktreePath,
    );
    if (shared !== null) {
      state.dependenciesRef.current.setNotice(warning(shared));
      return;
    }
    const before = currentShipState(state, threadId);
    if (
      !shipAllowed(state, threadId, { kind: "removeStarted", deleteBranch: options.deleteBranch })
    )
      return;
    const force = before.kind !== "integrated";
    const shipStatus = options.deleteBranch ? await freshShipStatus(state, threadId, target) : null;
    if (options.deleteBranch && shipStatus === null) return;
    const status = await state.dependenciesRef.current.gitGateway.getStatus(worktreePath);
    if (!ownsTarget(state, target)) return;
    const dirty = status.changes.length > 0;
    if (dirty) {
      const confirmed = await confirmWorkbenchAction(
        state.dependenciesRef.current.prompter,
        DIRTY_WORKTREE_REMOVE_CONFIRMATION,
      );
      if (!ownsStoppedTarget(state, target)) return;
      if (!confirmed) return;
    }
    const gate = gateWorktreeRemoval(
      liveShipThreads(state.dependenciesRef.current),
      state.dependenciesRef.current.worktreeUses,
      threadId,
      worktreePath,
    );
    if (gate.kind === "refused") {
      state.dependenciesRef.current.setNotice(warning(gate.message));
      return;
    }
    applyShip(state, threadId, { kind: "removeStarted", deleteBranch: options.deleteBranch });
    await removeUnderLease(gate.lease, () =>
      state.dependenciesRef.current.gitWorktreeGateway.removeWorktree(
        target.repositoryRoot,
        worktreePath,
        dirty,
      ),
    );
    if (!ownsTarget(state, target)) return settledWithoutOwner(state, threadId);
    state.dependenciesRef.current.onWorktreeRemoved(threadId);
    if (!options.deleteBranch || shipStatus === null) {
      applyShip(state, threadId, { kind: "removeSucceeded", branchDeleted: false });
      state.dependenciesRef.current.setNotice(
        info("The worktree was removed. Its local branch was kept."),
      );
      return;
    }
    const branch = shipStatus.worktree.branch;
    const deleted = await attempt(() =>
      deleteBranch(state.dependenciesRef.current, target, branch, force),
    );
    if (!ownsTarget(state, target)) {
      if (deleted.ok) return settledWithoutOwner(state, threadId);
      return authorityLost(state, threadId, "removeWorktree");
    }
    if (!deleted.ok) {
      state.dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, deleted.error);
      applyShip(state, threadId, {
        kind: "stepFailed",
        failure: branchDeleteFailure(branch, deleted.error),
      });
      return;
    }
    applyShip(state, threadId, { kind: "removeSucceeded", branchDeleted: true });
    persistReceipt(state, threadId, { branchDeleted: true });
    const remoteBranchWasPushed = (state.receipts.get(threadId)?.pushed ?? null) !== null;
    const suffix = remoteBranchWasPushed ? " The remote branch was kept." : "";
    state.dependenciesRef.current.setNotice(
      info(`The worktree and local branch ${branch} were removed.${suffix}`),
    );
  });
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

function liveShipThreads(
  dependencies: AgentShipFlowDependencies,
): ReadonlyMap<string, AgentThread> {
  return dependencies.currentThreads?.() ?? dependencies.threads;
}

import {
  agentShipStatus,
  type AgentShipIntegrationMode,
  type AgentShipStepResult,
} from "../../domain/agentShip";
import {
  ALL_CHANGES,
  selectCommitChanges,
  type AgentCommitSelection,
} from "../../domain/gitCommitSelection";
import { AGENT_TASKS_SOURCE, attempt, failure, info, warning } from "../agentProjectAuthority";
import { confirmWorkbenchAction } from "../workbenchPrompter";
import {
  COMMITTED_STATUS_UNAVAILABLE_MESSAGE,
  COMMIT_MESSAGE_LIMIT_MESSAGE,
  STEP_IN_FLIGHT_MESSAGE,
  STEP_SUCCEEDED,
  boundedCommitMessage,
  mergeMessage,
  notRun,
  pushFailure,
  selectionFailure,
} from "./agentShipFailures";
import {
  applyShip,
  authorityLost,
  currentShipState,
  freshShipStatus,
  loadShipStatus,
  ownsStoppedTarget,
  ownsTarget,
  persistReceipt,
  refreshShipStatus,
  runShipOperation,
  runShipStep,
  settledWithoutOwner,
  shipAllowed,
  shipNowMs,
  stepFailed,
  type AgentShipFlowState,
} from "./agentShipFlowState";

export function commitShip(
  state: AgentShipFlowState,
  threadId: string,
  message: string,
  selection: AgentCommitSelection = ALL_CHANGES,
): Promise<AgentShipStepResult> {
  return runShipStep(state, threadId, "commit", async (target) => {
    const deps = state.dependenciesRef.current;
    const bounded = boundedCommitMessage(message);
    if (bounded === null) {
      deps.setNotice(warning(COMMIT_MESSAGE_LIMIT_MESSAGE));
      return notRun(COMMIT_MESSAGE_LIMIT_MESSAGE);
    }
    if (!shipAllowed(state, threadId, { kind: "commitStarted", message: bounded })) {
      return notRun(STEP_IN_FLIGHT_MESSAGE);
    }
    applyShip(state, threadId, { kind: "commitStarted", message: bounded });
    const status = await deps.gitGateway.getStatus(target.targetPath);
    if (!ownsTarget(state, target)) return authorityLost(state, threadId, "commit");
    const selected = selectCommitChanges(status.changes, selection);
    if (selected.kind !== "ok") {
      const failed = stepFailed(state, threadId, selectionFailure(selected.kind));
      void refreshShipStatus(state, threadId);
      return failed;
    }
    const changes = [...selected.changes];
    await state.dependenciesRef.current.gitGateway.stageFiles(target.targetPath, changes);
    if (!ownsTarget(state, target)) return authorityLost(state, threadId, "commit");
    await state.dependenciesRef.current.gitGateway.commit(target.targetPath, bounded, changes);
    if (!ownsTarget(state, target)) return settledWithoutOwner(state, threadId);
    const loaded = await attempt(() => loadShipStatus(state, target));
    if (!ownsTarget(state, target)) return settledWithoutOwner(state, threadId);
    state.dependenciesRef.current.onShipStepCompleted?.(threadId);
    if (!loaded.ok) {
      state.dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, loaded.error);
      stepFailed(state, threadId, {
        step: "commit",
        reason: "gitError",
        message: COMMITTED_STATUS_UNAVAILABLE_MESSAGE,
      });
      return STEP_SUCCEEDED;
    }
    const shipStatus = loaded.value;
    state.statusLoadedAt.set(threadId, shipNowMs(state));
    applyShip(state, threadId, {
      kind: "commitSucceeded",
      commitSha: shipStatus.worktree.head,
      status: shipStatus,
    });
    persistReceipt(state, threadId, { lastCommitSha: shipStatus.worktree.head });
    return STEP_SUCCEEDED;
  });
}

export function pushShip(
  state: AgentShipFlowState,
  threadId: string,
): Promise<AgentShipStepResult> {
  return runShipStep(state, threadId, "push", async (target) => {
    if (!shipAllowed(state, threadId, { kind: "pushStarted" })) {
      return notRun(STEP_IN_FLIGHT_MESSAGE);
    }
    applyShip(state, threadId, { kind: "pushStarted" });
    const pushed = await attempt(() =>
      state.dependenciesRef.current.gitIntegrationGateway.pushBranchUpstream({
        repositoryRoot: target.repositoryRoot,
        worktreePath: target.worktreePath,
      }),
    );
    if (!pushed.ok) {
      if (!ownsTarget(state, target)) return authorityLost(state, threadId, "push");
      state.dependenciesRef.current.reportError(AGENT_TASKS_SOURCE, pushed.error);
      return stepFailed(state, threadId, pushFailure(pushed.error));
    }
    if (!ownsTarget(state, target)) return settledWithoutOwner(state, threadId);
    persistReceipt(state, threadId, {
      pushed: { remote: pushed.value.remote, branch: pushed.value.branch },
    });
    const status = await attempt(() => loadShipStatus(state, target));
    if (!ownsTarget(state, target)) return settledWithoutOwner(state, threadId);
    const known = status.ok ? status.value : agentShipStatus(currentShipState(state, threadId));
    if (known === null) {
      applyShip(state, threadId, {
        kind: "stepFailed",
        failure: {
          step: "push",
          reason: "gitError",
          message: "The branch was pushed, but its status could not be refreshed.",
        },
      });
      return STEP_SUCCEEDED;
    }
    if (status.ok) state.statusLoadedAt.set(threadId, shipNowMs(state));
    applyShip(state, threadId, { kind: "pushSucceeded", receipt: pushed.value, status: known });
    return STEP_SUCCEEDED;
  });
}

export async function openShipCompareUrl(
  state: AgentShipFlowState,
  threadId: string,
): Promise<void> {
  const deps = state.dependenciesRef.current;
  const shipState = currentShipState(state, threadId);
  if (shipState.kind !== "pushed") return;
  const url = shipState.receipt.compareUrl ?? shipState.status?.remote?.compareUrl ?? null;
  if (url === null) {
    deps.setNotice(
      info(`Pushed ${shipState.receipt.branch}. Open a pull request on your hosting site.`),
    );
    return;
  }
  const opener = deps.externalUrlOpener;
  if (opener === null) {
    deps.setNotice(info(`Open the compare page: ${url}`));
    return;
  }
  const opened = await attempt(() => opener.openExternal(url));
  if (!state.mountedRef.current) return;
  if (opened.ok) return;
  deps.reportError(AGENT_TASKS_SOURCE, opened.error);
  deps.setNotice(failure(`The compare page could not be opened: ${url}`));
}

export function integrateShip(
  state: AgentShipFlowState,
  threadId: string,
  mode: AgentShipIntegrationMode,
): Promise<void> {
  return runShipOperation(state, threadId, "integrate", async (target) => {
    if (target.worktreePath === null) {
      state.dependenciesRef.current.setNotice(
        warning("Threads in the local checkout have nothing to integrate."),
      );
      return;
    }
    const status = await freshShipStatus(state, threadId, target);
    if (status === null) return;
    if (!shipAllowed(state, threadId, { kind: "integrateStarted", mode })) return;
    const primaryBranch = status.primary.branch;
    if (primaryBranch === null) {
      applyShip(state, threadId, {
        kind: "stepFailed",
        failure: { step: "integrate", outcome: { kind: "primaryDetached" } },
      });
      return;
    }
    if (mode === "merge" && status.relation.behindPrimary > 0) {
      const confirmed = await confirmWorkbenchAction(
        state.dependenciesRef.current.prompter,
        `The branch is ${status.relation.behindPrimary} commits behind ${primaryBranch}. Merge anyway?`,
      );
      if (!ownsStoppedTarget(state, target)) return;
      if (!confirmed) return;
    }
    applyShip(state, threadId, { kind: "integrateStarted", mode });
    const thread = state.dependenciesRef.current.threads.get(threadId);
    const outcome =
      await state.dependenciesRef.current.gitIntegrationGateway.integrateWorktreeBranch({
        repositoryRoot: target.repositoryRoot,
        worktreePath: target.worktreePath,
        mode,
        expectedPrimaryBranch: primaryBranch,
        expectedPrimaryHead: status.primary.head,
        expectedBranchHead: status.worktree.head,
        mergeMessage: mergeMessage(status.worktree.branch, thread?.title ?? ""),
      });
    if (!ownsTarget(state, target)) {
      if (outcome.kind === "integrated") return settledWithoutOwner(state, threadId);
      return authorityLost(state, threadId, "integrate");
    }
    if (outcome.kind !== "integrated") {
      applyShip(state, threadId, { kind: "stepFailed", failure: { step: "integrate", outcome } });
      void refreshShipStatus(state, threadId);
      return;
    }
    persistReceipt(state, threadId, {
      integrated: { intoBranch: outcome.intoBranch, mergeSha: outcome.mergeSha, mode },
    });
    const refreshed = await attempt(() => loadShipStatus(state, target));
    if (!ownsTarget(state, target)) return settledWithoutOwner(state, threadId);
    if (refreshed.ok) state.statusLoadedAt.set(threadId, shipNowMs(state));
    applyShip(state, threadId, {
      kind: "integrateSucceeded",
      mergeSha: outcome.mergeSha,
      intoBranch: outcome.intoBranch,
      status: refreshed.ok ? refreshed.value : status,
    });
    state.dependenciesRef.current.onShipStepCompleted?.(threadId);
  });
}

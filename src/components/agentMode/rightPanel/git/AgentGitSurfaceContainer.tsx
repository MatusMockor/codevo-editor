import { useMemo } from "react";
import { projectGitCommitPort } from "../../../../application/rightPanel/projectGitCommitPort";
import { useAgentGitDiscard } from "../../../../application/rightPanel/useAgentGitDiscard";
import { useAgentGitSurface } from "../../../../application/rightPanel/useAgentGitSurface";
import {
  STATUS_REVISION_COALESCE_MS,
  useCoalescedValue,
} from "../../../../application/rightPanel/useCoalescedValue";
import { gitSurfaceStatusValue } from "../../../../application/rightPanel/useGitSurfaceStatus";
import type { GitLineStat, GitUnpushedCommit } from "../../../../domain/gitSurfaceStatus";
import { useNowMs } from "../../../../ui/foundation/useNowMs";
import { agentThreadDisplayTitle } from "../../agentModePresentation";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentGitBranchNotice } from "./AgentGitBranchNotice";
import { AgentGitBranchPicker } from "./AgentGitBranchPicker";
import { AgentGitDiscardDialog } from "./AgentGitDiscardDialog";
import { AgentGitMoreMenu } from "./AgentGitMoreMenu";
import { AgentGitShipBanner } from "./AgentGitShipBanner";
import { AgentGitSurface } from "./AgentGitSurface";
import { threadGitCommitPort } from "./threadGitCommitPort";
import {
  WORKTREE_THREAD_SWITCH_REASON,
  useAgentGitBranchActions,
} from "./useAgentGitBranchActions";

export function AgentGitSurfaceContainer() {
  const context = useAgentRightPanelContext();
  const { checkoutRoot, chrome, gitStatus, shipActions, target, thread } = context;
  const status = gitSurfaceStatusValue(gitStatus.load);
  const threadId = thread?.thread.threadId ?? null;
  const git = chrome?.gateways.git ?? null;
  const workingTree = chrome?.gateways.workingTree ?? null;
  const nowMs = useNowMs();
  const statusRevision = useCoalescedValue(
    chrome?.statusRevision ?? 0,
    STATUS_REVISION_COALESCE_MS,
  );
  const port = useMemo(() => {
    if (git === null || target === null) return null;
    if (threadId === null) {
      if (checkoutRoot === null) return null;
      const amender = workingTree === null ? null : { gateway: workingTree, target };
      return projectGitCommitPort(git, checkoutRoot, amender);
    }
    if (shipActions === null) return null;
    return threadGitCommitPort(shipActions, threadId);
  }, [checkoutRoot, git, shipActions, target, threadId, workingTree]);
  const surface = useAgentGitSurface({
    ownerKey: threadId ?? target?.repositoryRoot ?? null,
    rootPath: checkoutRoot,
    git,
    lineStats: status?.lineStats ?? NO_LINE_STATS,
    port,
    threadTitle: thread === null ? null : agentThreadDisplayTitle(thread.thread),
    revision: statusRevision,
    onCommitted: gitStatus.refresh,
  });
  const refreshAll = (): void => {
    surface.refresh();
    gitStatus.refresh();
  };
  const discard = useAgentGitDiscard({
    ownerKey: threadId ?? target?.repositoryRoot ?? null,
    target,
    gateway: workingTree,
    rows: surface.rows,
    onDiscarded: refreshAll,
  });
  const branches = useAgentGitBranchActions({
    ownerKey: threadId ?? target?.repositoryRoot ?? null,
    rootPath: checkoutRoot,
    repositoryRoot: target?.repositoryRoot ?? null,
    currentBranch: status?.branch ?? null,
    isolation: thread?.thread.target.isolation ?? null,
    git,
    checkout: context.checkout,
    historyTarget: context.historyTarget,
    worktrees: chrome?.gateways.worktrees ?? null,
    onChanged: refreshAll,
  });
  const fetch = (): void => {
    if (git === null || checkoutRoot === null) return;
    void git.fetch(checkoutRoot).then(() => {
      surface.refresh();
      gitStatus.refresh();
    }, gitStatus.refresh);
  };
  return (
    <>
      <AgentGitSurface
        aheadCount={status?.upstream?.ahead ?? null}
        discardAvailable={discard.available}
        discardNotice={discard.notice}
        focusAfterDiscard={discard.focusAfter}
        banner={
          <>
            <AgentGitBranchNotice
              notice={branches.notice}
              onCopyPath={(path) => void context.copyText(path)}
              onDismiss={branches.dismiss}
            />
            {thread !== null && shipActions !== null && (
              <AgentGitShipBanner actions={shipActions} thread={thread} />
            )}
          </>
        }
        behindCount={status?.upstream?.behind ?? null}
        branchControl={
          <AgentGitBranchPicker
            busy={branches.busy}
            currentBranch={status?.branch ?? null}
            defaultBranch={status?.defaultBase ?? null}
            localBranches={status?.localBranches ?? NO_BRANCHES}
            onCreate={(name, options) => void branches.create(name, options)}
            onSwitch={(item) => void branches.switchTo(item)}
            remoteBranches={status?.remoteBranches ?? NO_BRANCHES}
            switchDisabledReason={
              thread?.thread.target.isolation === "worktree" ? WORKTREE_THREAD_SWITCH_REASON : null
            }
            worktreeBranches={status?.worktreeBranches ?? NO_BRANCHES}
          />
        }
        moreMenu={
          <AgentGitMoreMenu
            actions={shipActions}
            onRefresh={refreshAll}
            onShowHistory={() => context.openSurface("history")}
            thread={thread}
          />
        }
        nowMs={nowMs}
        onAllIncludedChange={surface.setAllIncluded}
        onAmendChange={surface.setAmending}
        onCheckAmend={surface.checkAmend}
        onCommit={surface.commit}
        onCommitAndPush={surface.commitAndPush}
        onDiscard={discard.request}
        onFetch={fetch}
        onGenerate={surface.generate}
        onMessageChange={surface.setMessage}
        onOpenPullRequest={() => context.openSurface("pullRequest")}
        onRowIncludedChange={surface.setRowIncluded}
        state={surface}
        unpushed={status?.unpushed ?? NO_UNPUSHED}
        upstreamName={status?.upstream?.name ?? null}
      />
      <AgentGitDiscardDialog
        onCancel={discard.cancel}
        onConfirm={discard.confirm}
        pending={discard.pending}
      />
    </>
  );
}

const NO_BRANCHES: ReadonlyArray<string> = [];
const NO_LINE_STATS: ReadonlyArray<GitLineStat> = [];
const NO_UNPUSHED: ReadonlyArray<GitUnpushedCommit> = [];

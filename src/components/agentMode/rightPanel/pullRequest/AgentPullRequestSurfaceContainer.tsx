import { useEffect, useMemo, useState } from "react";
import { useAgentPullRequest } from "../../../../application/rightPanel/useAgentPullRequest";
import { gitSurfaceStatusValue } from "../../../../application/rightPanel/useGitSurfaceStatus";
import { gitBranchPickerItems } from "../../../../domain/gitBranchPicker";
import { agentThreadDisplayTitle } from "../../agentModePresentation";
import { useAgentRightPanelContext } from "../agentRightPanelContext";
import { AgentPullRequestSurface } from "./AgentPullRequestSurface";

export function AgentPullRequestSurfaceContainer() {
  const context = useAgentRightPanelContext();
  const { chrome, gitStatus, target, thread } = context;
  const ownerKey = thread?.thread.threadId ?? target?.repositoryRoot ?? null;
  const pullRequest = useAgentPullRequest({
    ownerKey,
    target,
    gateway: chrome?.gateways.pullRequest ?? null,
    threadTitle: thread === null ? null : agentThreadDisplayTitle(thread.thread),
  });
  const [openError, setOpenError] = useState<{
    readonly owner: string | null;
    readonly text: string;
  } | null>(null);
  const status = gitSurfaceStatusValue(gitStatus.load);
  const readyContext = pullRequest.context.kind === "ready" ? pullRequest.context.value : null;
  const baseOptions = useMemo(
    () =>
      gitBranchPickerItems(
        status?.localBranches ?? [],
        [],
        [],
        readyContext?.headBranch ?? null,
        readyContext?.defaultBase ?? null,
        "",
      )
        .map((item) => item.name)
        .filter((name) => name !== readyContext?.headBranch),
    [readyContext?.defaultBase, readyContext?.headBranch, status?.localBranches],
  );
  const created = pullRequest.submit.kind === "created";
  const refreshStatus = gitStatus.refresh;
  useEffect(() => {
    if (created) refreshStatus();
  }, [created, refreshStatus]);
  const externalUrl = chrome?.gateways.externalUrl ?? null;
  const open = (url: string): void => {
    setOpenError(null);
    if (externalUrl === null) {
      setOpenError({ owner: ownerKey, text: `Open this address in your browser: ${url}` });
      return;
    }
    externalUrl.openExternal(url).catch((error: unknown) => {
      setOpenError({
        owner: ownerKey,
        text: error instanceof Error ? error.message : "The address could not be opened.",
      });
    });
  };
  return (
    <AgentPullRequestSurface
      baseOptions={baseOptions}
      onBaseChange={pullRequest.setBase}
      onBodyChange={pullRequest.setBody}
      onCancel={() => context.openSurface("git")}
      onCreate={pullRequest.create}
      onDraftChange={pullRequest.setDraft}
      onOpen={open}
      onReload={pullRequest.reload}
      onTitleChange={pullRequest.setTitle}
      openError={openError !== null && openError.owner === ownerKey ? openError.text : null}
      state={pullRequest}
    />
  );
}

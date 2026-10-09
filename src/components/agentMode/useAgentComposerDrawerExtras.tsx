import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { AgentThreadView } from "../../application/agentThreadPorts";
import type { AgentGitHistoryTarget } from "../../application/useAgentGitHistory";
import type { AgentThreadBranchMemorySurface } from "../../application/useAgentThreadBranchMemory";
import type { UsageAccountStates } from "../usage/usagePresentation";
import { AgentBranchChangedNotice } from "./AgentBranchChangedNotice";
import { AgentComposerDrawerEnd } from "./AgentComposerDrawerEnd";
import { AgentServerReachabilityBanner } from "./AgentServerReachabilityBanner";
import type { AgentLiveCheckoutBranches } from "./agentLiveCheckoutBranch";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import { AgentComposerUsageLimitsNotice } from "./usage/AgentComposerUsageLimitsNotice";
import { useComposerUsageLimitsNotice } from "./usage/useComposerUsageLimitsNotice";
import { useAgentServerReachabilityBanner } from "./useAgentServerReachabilityBanner";
import { useAgentStartedThreadBranch } from "./useAgentStartedThreadBranch";

const UNAVAILABLE_GUARD_REASON = "Branch switching is unavailable in this view.";

export interface AgentComposerDrawerExtras {
  readonly banners: ReactNode;
  onShowUsageLimits(): void;
  renderDrawerEnd(context: AgentComposerDrawerContext): ReactNode;
}

export interface AgentComposerThreadBranchInput {
  readonly thread: AgentThreadView | null;
  readonly branchMemory: AgentThreadBranchMemorySurface | null;
  readonly liveCheckoutBranches: AgentLiveCheckoutBranches | null | undefined;
  readonly retryServer?: () => Promise<void>;
}

const NO_THREAD_BRANCH: AgentComposerThreadBranchInput = {
  thread: null,
  branchMemory: null,
  liveCheckoutBranches: null,
};

export function useAgentComposerDrawerExtras(
  branchCheckout: AgentWorkbenchChrome["branchCheckout"],
  accountUsage: UsageAccountStates | undefined,
  threadBranch: AgentComposerThreadBranchInput = NO_THREAD_BRANCH,
): AgentComposerDrawerExtras {
  const latestGuard = useRef(branchCheckout?.guard ?? null);
  useLayoutEffect(() => {
    latestGuard.current = branchCheckout?.guard ?? null;
  }, [branchCheckout]);
  const gateway = branchCheckout?.gateway ?? null;
  const checkout = useMemo(() => {
    if (gateway === null) return null;
    const guard = (target: AgentGitHistoryTarget): string | null => {
      const current = latestGuard.current;
      if (current === null) return UNAVAILABLE_GUARD_REASON;
      return current(target);
    };
    return { gateway, guard };
  }, [gateway]);
  const started = useAgentStartedThreadBranch({
    thread: threadBranch.thread,
    checkout,
    memory: threadBranch.branchMemory,
    liveCheckoutBranches: threadBranch.liveCheckoutBranches,
  });
  const renderDrawerEnd = useCallback(
    (context: AgentComposerDrawerContext) => (
      <AgentComposerDrawerEnd checkout={checkout} context={context} started={started} />
    ),
    [checkout, started],
  );
  const notice = useComposerUsageLimitsNotice(accountUsage);
  const branchNotice = started.notice;
  const serverBanner = useAgentServerReachabilityBanner(
    threadBranch.thread,
    threadBranch.retryServer,
  );
  const banners = useMemo(
    () => (
      <>
        <AgentComposerUsageLimitsNotice notice={notice} />
        <AgentBranchChangedNotice notice={branchNotice} />
        <AgentServerReachabilityBanner banner={serverBanner} />
      </>
    ),
    [branchNotice, notice, serverBanner],
  );
  return { banners, onShowUsageLimits: notice.show, renderDrawerEnd };
}

import { useCallback, useLayoutEffect, useMemo, useRef, type ReactNode } from "react";
import type { AgentGitHistoryTarget } from "../../application/useAgentGitHistory";
import type { UsageAccountStates } from "../usage/usagePresentation";
import { AgentComposerBranchPicker } from "./AgentComposerBranchPicker";
import type { AgentWorkbenchChrome } from "./agentWorkbenchChrome";
import type { AgentComposerDrawerContext } from "./composer/AgentComposerFrame";
import { AgentComposerUsageLimitsNotice } from "./usage/AgentComposerUsageLimitsNotice";
import { useComposerUsageLimitsNotice } from "./usage/useComposerUsageLimitsNotice";

const UNAVAILABLE_GUARD_REASON = "Branch switching is unavailable in this view.";

export interface AgentComposerDrawerExtras {
  readonly banners: ReactNode;
  onShowUsageLimits(): void;
  renderDrawerEnd(context: AgentComposerDrawerContext): ReactNode;
}

export function useAgentComposerDrawerExtras(
  branchCheckout: AgentWorkbenchChrome["branchCheckout"],
  accountUsage: UsageAccountStates | undefined,
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
  const renderDrawerEnd = useCallback(
    (context: AgentComposerDrawerContext) => (
      <AgentComposerBranchPicker branchCheckout={checkout} context={context} />
    ),
    [checkout],
  );
  const notice = useComposerUsageLimitsNotice(accountUsage);
  const banners = useMemo(() => <AgentComposerUsageLimitsNotice notice={notice} />, [notice]);
  return { banners, onShowUsageLimits: notice.show, renderDrawerEnd };
}

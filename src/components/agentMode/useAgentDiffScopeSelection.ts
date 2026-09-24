import { useCallback, useState } from "react";
import type { AgentTurnChangeSummary } from "../../domain/agentTurnChanges";
import {
  DEFAULT_PROJECT_DIFF_SCOPE,
  DEFAULT_THREAD_DIFF_SCOPE,
  agentDiffScopeActiveTurnId,
  effectiveAgentDiffScope,
  type AgentDiffScope,
  type AgentDiffTurn,
} from "../../domain/diffView/agentDiffScope";

export interface AgentDiffScopeSelectionOptions {
  readonly threadId: string | null;
  readonly turns: ReadonlyArray<AgentDiffTurn>;
  readonly diffActive: boolean;
  readonly remote: boolean;
  readonly turnDiffAvailable: boolean;
  openDiff(): void;
}

export interface AgentDiffScopeSelection {
  readonly scope: AgentDiffScope;
  readonly activeDiffTurnId: string | null;
  setScope(scope: AgentDiffScope): void;
  openTurnDiff(threadId: string, summary: AgentTurnChangeSummary, relativePath?: string): void;
  reviewWorkingTree(threadId: string): void;
  resetScope(): void;
}

interface ScopedSelection {
  readonly threadId: string | null;
  readonly scope: AgentDiffScope;
}

export function useAgentDiffScopeSelection({
  diffActive,
  openDiff,
  remote,
  threadId,
  turnDiffAvailable,
  turns,
}: AgentDiffScopeSelectionOptions): AgentDiffScopeSelection {
  const [selection, setSelection] = useState<ScopedSelection | null>(null);
  const fallback = threadId === null ? DEFAULT_PROJECT_DIFF_SCOPE : DEFAULT_THREAD_DIFF_SCOPE;
  const scope = selection !== null && selection.threadId === threadId ? selection.scope : fallback;
  const setScope = useCallback(
    (next: AgentDiffScope) => setSelection({ threadId, scope: next }),
    [threadId],
  );
  const openTurnDiff = useCallback(
    (requestThreadId: string, summary: AgentTurnChangeSummary, relativePath?: string) => {
      if (requestThreadId !== threadId || !turnDiffAvailable) return;
      const scope: AgentDiffScope =
        relativePath === undefined
          ? { kind: "turn", turnId: summary.turnId }
          : { kind: "turn", turnId: summary.turnId, revealPath: relativePath };
      setSelection({ threadId, scope });
      openDiff();
    },
    [openDiff, threadId, turnDiffAvailable],
  );
  const reviewWorkingTree = useCallback(
    (requestThreadId: string) => {
      if (requestThreadId !== threadId) return;
      setSelection({ threadId, scope: { kind: "workingTree" } });
      openDiff();
    },
    [openDiff, threadId],
  );
  const resetScope = useCallback(() => setSelection(null), []);
  return {
    scope,
    activeDiffTurnId: diffActive
      ? agentDiffScopeActiveTurnId(
          effectiveAgentDiffScope({ hasThread: threadId !== null, remote }, scope),
          turns,
        )
      : null,
    setScope,
    openTurnDiff,
    reviewWorkingTree,
    resetScope,
  };
}

import { useCallback, useEffect, useState } from "react";
import type { AgentCliKind, AgentTaskStatusEvent } from "../../domain/agentTask";
import type { AgentThread } from "../../domain/agentThread";

export interface AgentTurnTerminalReconcileInput {
  readonly threads: ReadonlyMap<string, AgentThread>;
  readonly onProviderTurnCompleted?: (provider: AgentCliKind) => void;
  readonly refreshOrphanedWorktrees: () => Promise<unknown>;
  readonly refreshVisibleChanges: (threadId: string) => Promise<unknown>;
  readonly refreshShipStatus: (threadId: string) => Promise<unknown>;
}

export interface AgentTurnTerminalReconcile {
  onTurnTerminal(event: AgentTaskStatusEvent): void;
  onWorktreeDispatchFailed(): void;
}

const NO_PENDING_SHIP_RECONCILE: ReadonlySet<string> = Object.freeze(new Set<string>());

export function useAgentTurnTerminalReconcile({
  threads,
  onProviderTurnCompleted,
  refreshOrphanedWorktrees,
  refreshVisibleChanges,
  refreshShipStatus,
}: AgentTurnTerminalReconcileInput): AgentTurnTerminalReconcile {
  const [pendingShipReconcile, setPendingShipReconcile] = useState<ReadonlySet<string>>(
    () => NO_PENDING_SHIP_RECONCILE,
  );

  const onTurnTerminal = useCallback(
    (event: AgentTaskStatusEvent): void => {
      const threadId = threadIdForTurn(threads, event.taskId);
      const provider = threads.get(threadId)?.provider.kind;
      if (event.status.kind === "exited" && event.status.exitCode === 0 && provider !== undefined) {
        onProviderTurnCompleted?.(provider);
      }
      if (event.isolation !== "worktree") return;
      void refreshOrphanedWorktrees();
      void refreshVisibleChanges(threadId);
      setPendingShipReconcile((current) => {
        if (current.has(threadId)) return current;
        return new Set(current).add(threadId);
      });
    },
    [onProviderTurnCompleted, refreshOrphanedWorktrees, refreshVisibleChanges, threads],
  );

  useEffect(() => {
    if (pendingShipReconcile.size === 0) return;
    for (const threadId of pendingShipReconcile) {
      void refreshShipStatus(threadId);
    }
    setPendingShipReconcile(NO_PENDING_SHIP_RECONCILE);
  }, [pendingShipReconcile, refreshShipStatus]);

  const onWorktreeDispatchFailed = useCallback((): void => {
    void refreshOrphanedWorktrees();
  }, [refreshOrphanedWorktrees]);

  return { onTurnTerminal, onWorktreeDispatchFailed };
}

function threadIdForTurn(threads: ReadonlyMap<string, AgentThread>, turnId: string): string {
  for (const thread of threads.values()) {
    if (thread.turns.some((turn) => turn.turnId === turnId)) return thread.threadId;
  }
  return turnId;
}

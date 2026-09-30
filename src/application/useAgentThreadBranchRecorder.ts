import { useEffect, useRef } from "react";
import {
  agentThreadBranchKey,
  type AgentThreadBranchIdentity,
} from "../domain/agentThreadBranchMemory";
import type { AgentThreadView } from "./agentThreadPorts";
import type { AgentThreadBranchMemorySurface } from "./useAgentThreadBranchMemory";

export type AgentThreadLiveBranches = ReadonlyMap<string, string | null>;

export function useAgentThreadBranchRecorder(
  threads: ReadonlyArray<AgentThreadView>,
  liveCheckoutBranches: AgentThreadLiveBranches | null | undefined,
  memory: AgentThreadBranchMemorySurface | null,
): void {
  const runningRef = useRef<ReadonlyMap<string, boolean>>(new Map());
  const remember = memory?.remember ?? null;
  const branchOf = memory?.branchOf ?? null;
  useEffect(() => {
    const previous = runningRef.current;
    const next = new Map<string, boolean>();
    for (const view of threads) {
      const identity = localCheckoutIdentity(view);
      if (identity === null) continue;
      const key = agentThreadBranchKey(identity);
      const running = view.lifecycle === "running";
      next.set(key, running);
      if (!running && previous.get(key) !== true) continue;
      const branch = liveCheckoutBranches?.get(view.thread.owner.repositoryRoot) ?? null;
      if (branch === null || remember === null || branchOf === null) continue;
      if (branchOf(identity) === branch) continue;
      remember(identity, branch);
    }
    runningRef.current = next;
  }, [branchOf, liveCheckoutBranches, remember, threads]);
}

function localCheckoutIdentity(view: AgentThreadView): AgentThreadBranchIdentity | null {
  if (view.execution !== undefined) return null;
  const { owner, target, threadId } = view.thread;
  if (target.isolation !== "in-place" || target.worktreePath !== null) return null;
  return { threadId, rootKey: owner.rootKey, ownerId: owner.ownerId };
}

import { useCallback, useMemo, useRef, useState } from "react";
import {
  EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  agentThreadBranchOf,
  rememberAgentThreadBranch,
  type AgentThreadBranchIdentity,
  type AgentThreadBranchMemory,
} from "../domain/agentThreadBranchMemory";
import type { AgentThreadBranchMemoryPort } from "./agentThreadBranchMemoryPort";

export interface AgentThreadBranchMemorySurface {
  readonly memory: AgentThreadBranchMemory;
  branchOf(identity: AgentThreadBranchIdentity): string | null;
  remember(identity: AgentThreadBranchIdentity, branch: string): void;
}

export function useAgentThreadBranchMemory(
  port: AgentThreadBranchMemoryPort | null,
): AgentThreadBranchMemorySurface {
  const [memory, setMemory] = useState<AgentThreadBranchMemory>(
    () => port?.load() ?? EMPTY_AGENT_THREAD_BRANCH_MEMORY,
  );
  const latest = useRef(memory);
  const remember = useCallback(
    (identity: AgentThreadBranchIdentity, branch: string) => {
      const current = latest.current;
      const next = rememberAgentThreadBranch(current, identity, branch);
      if (next === current) return;
      latest.current = next;
      setMemory(next);
      port?.save(next);
    },
    [port],
  );
  const branchOf = useCallback(
    (identity: AgentThreadBranchIdentity) => agentThreadBranchOf(memory, identity),
    [memory],
  );
  return useMemo(() => ({ memory, branchOf, remember }), [branchOf, memory, remember]);
}

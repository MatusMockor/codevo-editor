export const MAX_RETIRED_AGENT_WORKTREES = 256;

export type AgentWorktreeRemovalOutcome = "removed" | "kept";

export interface AgentWorktreeStartLease {
  release(): void;
}

export interface AgentWorktreeRemovalLease {
  settle(outcome: AgentWorktreeRemovalOutcome): void;
}

export interface AgentWorktreeUseRegistry {
  claimStart(worktreePath: string): AgentWorktreeStartLease | null;
  claimRemoval(worktreePath: string): AgentWorktreeRemovalLease | null;
  noteCreated(worktreePath: string): void;
}

export function createAgentWorktreeUseRegistry(): AgentWorktreeUseRegistry {
  const starting = new Map<string, number>();
  const removing = new Set<string>();
  const retired = new Set<string>();

  const retire = (worktreePath: string): void => {
    retired.delete(worktreePath);
    retired.add(worktreePath);
    if (retired.size <= MAX_RETIRED_AGENT_WORKTREES) return;
    const oldest = retired.values().next();
    if (oldest.done === true) return;
    retired.delete(oldest.value);
  };

  const releaseStart = (worktreePath: string): void => {
    const count = starting.get(worktreePath) ?? 0;
    if (count <= 1) {
      starting.delete(worktreePath);
      return;
    }
    starting.set(worktreePath, count - 1);
  };

  return {
    claimStart(worktreePath) {
      if (removing.has(worktreePath) || retired.has(worktreePath)) return null;
      starting.set(worktreePath, (starting.get(worktreePath) ?? 0) + 1);
      let released = false;
      return {
        release() {
          if (released) return;
          released = true;
          releaseStart(worktreePath);
        },
      };
    },
    claimRemoval(worktreePath) {
      if (removing.has(worktreePath) || starting.has(worktreePath)) return null;
      removing.add(worktreePath);
      let settled = false;
      return {
        settle(outcome) {
          if (settled) return;
          settled = true;
          removing.delete(worktreePath);
          if (outcome === "removed") retire(worktreePath);
        },
      };
    },
    noteCreated(worktreePath) {
      retired.delete(worktreePath);
    },
  };
}

import type { AgentTurn } from "../agentThread";

export type AgentDiffScope =
  | { readonly kind: "latestTurn" }
  | { readonly kind: "turn"; readonly turnId: string; readonly revealPath?: string }
  | { readonly kind: "workingTree" }
  | { readonly kind: "branch"; readonly baseRef: string };

export type ResolvedAgentDiffScope =
  | { readonly kind: "turn"; readonly turnId: string; readonly label: string }
  | { readonly kind: "workingTree" }
  | { readonly kind: "branch"; readonly baseRef: string }
  | { readonly kind: "noTurns" };

export interface AgentDiffTurnOption {
  readonly turnId: string;
  readonly label: string;
  readonly endedAtEpochMs: number;
}

export type AgentDiffTurn = Pick<AgentTurn, "turnId" | "endedAtEpochMs">;

export const MAX_AGENT_DIFF_TURN_OPTIONS = 50;
export const DEFAULT_THREAD_DIFF_SCOPE: AgentDiffScope = Object.freeze({ kind: "latestTurn" });
export const DEFAULT_PROJECT_DIFF_SCOPE: AgentDiffScope = Object.freeze({ kind: "workingTree" });
const REMOTE_THREAD_DIFF_SCOPE: AgentDiffScope = Object.freeze({ kind: "workingTree" });

export interface AgentDiffScopeOwner {
  readonly hasThread: boolean;
  readonly remote: boolean;
}

export function effectiveAgentDiffScope(
  owner: AgentDiffScopeOwner,
  requested: AgentDiffScope | undefined,
): AgentDiffScope {
  if (!owner.hasThread) return requested ?? DEFAULT_PROJECT_DIFF_SCOPE;
  const scope = requested ?? DEFAULT_THREAD_DIFF_SCOPE;
  if (owner.remote && scope.kind === "latestTurn") return REMOTE_THREAD_DIFF_SCOPE;
  return scope;
}

export function agentDiffTurnOptions(
  turns: ReadonlyArray<AgentDiffTurn>,
): ReadonlyArray<AgentDiffTurnOption> {
  const options: AgentDiffTurnOption[] = [];
  turns.forEach((turn, index) => {
    if (turn.endedAtEpochMs === null) return;
    options.push({
      turnId: turn.turnId,
      label: `Turn ${index + 1}`,
      endedAtEpochMs: turn.endedAtEpochMs,
    });
  });
  return options.reverse().slice(0, MAX_AGENT_DIFF_TURN_OPTIONS);
}

export function resolveAgentDiffScope(
  scope: AgentDiffScope,
  turns: ReadonlyArray<AgentDiffTurn>,
): ResolvedAgentDiffScope {
  switch (scope.kind) {
    case "latestTurn": {
      const latest = agentDiffTurnOptions(turns)[0];
      if (latest === undefined) return { kind: "noTurns" };
      return { kind: "turn", turnId: latest.turnId, label: latest.label };
    }
    case "turn": {
      const index = turns.findIndex((turn) => turn.turnId === scope.turnId);
      if (index < 0) return { kind: "noTurns" };
      return { kind: "turn", turnId: scope.turnId, label: `Turn ${index + 1}` };
    }
    case "workingTree":
      return { kind: "workingTree" };
    case "branch":
      return { kind: "branch", baseRef: scope.baseRef };
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function agentDiffScopeLabel(
  scope: AgentDiffScope,
  turns: ReadonlyArray<AgentDiffTurn>,
): string {
  switch (scope.kind) {
    case "latestTurn":
      return "Latest turn";
    case "turn": {
      const resolved = resolveAgentDiffScope(scope, turns);
      return resolved.kind === "turn" ? resolved.label : "Turn";
    }
    case "workingTree":
      return "Working tree";
    case "branch":
      return "Branch changes";
    default: {
      const unreachable: never = scope;
      return unreachable;
    }
  }
}

export function agentDiffScopeActiveTurnId(
  scope: AgentDiffScope,
  turns: ReadonlyArray<AgentDiffTurn>,
): string | null {
  const resolved = resolveAgentDiffScope(scope, turns);
  return resolved.kind === "turn" ? resolved.turnId : null;
}

export function agentDiffScopesEqual(left: AgentDiffScope, right: AgentDiffScope): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind === "turn" && right.kind === "turn") return left.turnId === right.turnId;
  if (left.kind === "branch" && right.kind === "branch") return left.baseRef === right.baseRef;
  return true;
}

import { GitBranch } from "lucide-react";
import { useId } from "react";
import { useAgentBranchCheckout } from "../../application/useAgentBranchCheckout";
import type {
  AgentGitHistoryBranchFilter,
  AgentGitHistoryTarget,
} from "../../application/useAgentGitHistory";
import type { GitBranches } from "../../domain/git";
import type { AgentSurfaceHistoryProps } from "./AgentSurfaceHistory";

const unavailable = () => "Branch switching is unavailable in this view.";

export function AgentHistoryCheckoutAction({
  target,
  branches,
  filter,
  checkout,
  onSuccess,
}: {
  readonly target: AgentGitHistoryTarget;
  readonly branches: GitBranches;
  readonly filter: AgentGitHistoryBranchFilter;
  readonly checkout: AgentSurfaceHistoryProps["checkout"];
  readonly onSuccess: () => void;
}) {
  const reasonId = useId();
  const guard = checkout?.guard ?? unavailable;
  const action = useAgentBranchCheckout({
    target,
    branches,
    gateway: checkout?.gateway ?? null,
    guard,
    onSuccess,
  });
  const switching = action.status === "switching";
  const canSelect = filter.kind === "branch" && filter.ref !== `refs/heads/${branches.current}`;
  const blocked = canSelect ? guard(target) : null;
  const reason = action.error ?? blocked;
  return (
    <div className="agent-history__checkout">
      <span
        className="agent-history__working-branch"
        title={`Working branch: ${branches.current ?? "Detached HEAD"}`}
      >
        <GitBranch size={12} aria-hidden="true" />
        <span>Working: {branches.current ?? "Detached HEAD"}</span>
      </span>
      {(canSelect || switching) && checkout != null && (
        <button
          type="button"
          className="agent-history__switch"
          disabled={switching || blocked !== null}
          aria-describedby={reason === null ? undefined : reasonId}
          title={blocked ?? "Switch the project's working branch and refresh its files."}
          onClick={() => void action.checkout(filter)}
        >
          {switching ? "Switching branch…" : "Switch to this branch"}
        </button>
      )}
      {reason !== null && checkout != null && (
        <p
          id={reasonId}
          className="agent-history__checkout-reason"
          role={action.error === null ? "status" : "alert"}
        >
          {reason}
        </p>
      )}
    </div>
  );
}

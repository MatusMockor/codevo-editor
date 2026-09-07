import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GitBranches, GitGateway } from "../domain/git";
import type { AgentGitHistoryBranchFilter, AgentGitHistoryTarget } from "./useAgentGitHistory";

export type AgentBranchCheckoutGateway = Pick<GitGateway, "switchBranch" | "checkoutRemoteBranch">;

type CheckoutState =
  | { readonly status: "idle" | "success"; readonly error: null }
  | { readonly status: "switching"; readonly error: null }
  | { readonly status: "error"; readonly error: string };

function branchName(branches: GitBranches, ref: string) {
  const local = branches.local.find((name) => `refs/heads/${name}` === ref);
  if (local !== undefined) return { kind: "local" as const, name: local };
  for (const [remote, names] of Object.entries(branches.remotes)) {
    const name = names.find((candidate) => `refs/remotes/${remote}/${candidate}` === ref);
    if (name !== undefined) return { kind: "remote" as const, name: `${remote}/${name}` };
  }
  return null;
}

function failureMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return (
    message
      .trim()
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .slice(0, 500) || "Could not switch branches. Refresh and try again."
  );
}

export function useAgentBranchCheckout({
  target,
  gateway,
  branches,
  guard,
  onSuccess,
}: {
  readonly target: AgentGitHistoryTarget | null;
  readonly gateway: AgentBranchCheckoutGateway | null;
  readonly branches: GitBranches | null;
  readonly guard: (target: AgentGitHistoryTarget) => string | null;
  readonly onSuccess: (target: AgentGitHistoryTarget) => void;
}) {
  const rootPath = target?.rootPath ?? null;
  const ownerKey = target?.ownerKey ?? null;
  const identity = useMemo(() => ({ rootPath, ownerKey, gateway }), [rootPath, ownerKey, gateway]);
  const owner = useRef<typeof identity | null>(identity);
  const generation = useRef(0);
  const pending = useRef(false);
  const latest = useRef({ branches, guard, onSuccess });
  const [state, setState] = useState<CheckoutState>({ status: "idle", error: null });
  useLayoutEffect(() => {
    owner.current = identity;
    generation.current += 1;
    pending.current = false;
    setState({ status: "idle", error: null });
    return () => {
      owner.current = null;
      generation.current += 1;
    };
  }, [identity]);
  useLayoutEffect(() => {
    latest.current = { branches, guard, onSuccess };
  }, [branches, guard, onSuccess]);
  const actionGeneration = generation.current;
  const checkout = async (filter: AgentGitHistoryBranchFilter): Promise<void> => {
    const owns = () => owner.current === identity && generation.current === actionGeneration;
    if (!owns() || pending.current || rootPath === null || ownerKey === null || gateway === null)
      return;
    if (filter.kind !== "branch") return;
    const available = latest.current.branches;
    const branch = available === null ? null : branchName(available, filter.ref);
    if (branch === null) {
      setState({
        status: "error",
        error: "This branch is no longer available. Refresh the branch list.",
      });
      return;
    }
    if (branch.kind === "local" && branch.name === available?.current) return;
    if (branch.kind === "remote" && gateway.checkoutRemoteBranch === undefined) {
      setState({ status: "error", error: "Switching to a remote branch is unavailable." });
      return;
    }
    const capturedTarget = { rootPath, ownerKey };
    const blocked = latest.current.guard(capturedTarget);
    if (!owns()) return;
    if (blocked !== null) {
      setState({ status: "error", error: blocked });
      return;
    }
    pending.current = true;
    setState({ status: "switching", error: null });
    try {
      if (branch.kind === "local") await gateway.switchBranch(rootPath, branch.name);
      else await gateway.checkoutRemoteBranch?.(rootPath, branch.name);
      if (!owns()) return;
      pending.current = false;
      setState({ status: "success", error: null });
      latest.current.onSuccess(capturedTarget);
    } catch (error: unknown) {
      if (!owns()) return;
      pending.current = false;
      setState({ status: "error", error: failureMessage(error) });
    }
  };
  return { ...state, checkout };
}

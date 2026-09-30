import { agentWorktreeCoTenant } from "../domain/agentPreviousWorktree";
import type { AgentThread } from "../domain/agentThread";
import type {
  AgentWorktreeRemovalLease,
  AgentWorktreeRemovalOutcome,
  AgentWorktreeUseRegistry,
} from "./agentWorktreeUseRegistry";

export const WORKTREE_STARTING_NOTICE =
  "A new thread is starting in this worktree. Try again once it has started.";

const MAX_CO_TENANT_TITLE_CHARACTERS = 80;

export type AgentWorktreeRemovalGate =
  | { readonly kind: "clear"; readonly lease: AgentWorktreeRemovalLease | null }
  | { readonly kind: "refused"; readonly message: string };

export function sharedWorktreeNotice(tenant: AgentThread): string {
  return `Another thread still uses this worktree: "${boundedTitle(tenant.title)}". Archive that thread before removing the worktree.`;
}

export function sharedWorktreeRefusal(
  threads: ReadonlyMap<string, AgentThread>,
  threadId: string,
  worktreePath: string,
): string | null {
  const tenant = agentWorktreeCoTenant(threads.values(), threadId, worktreePath);
  return tenant === null ? null : sharedWorktreeNotice(tenant);
}

export function gateWorktreeRemoval(
  threads: ReadonlyMap<string, AgentThread>,
  worktreeUses: AgentWorktreeUseRegistry | undefined,
  threadId: string,
  worktreePath: string,
): AgentWorktreeRemovalGate {
  const shared = sharedWorktreeRefusal(threads, threadId, worktreePath);
  if (shared !== null) return { kind: "refused", message: shared };
  if (worktreeUses === undefined) return { kind: "clear", lease: null };
  const lease = worktreeUses.claimRemoval(worktreePath);
  if (lease === null) return { kind: "refused", message: WORKTREE_STARTING_NOTICE };
  return { kind: "clear", lease };
}

export async function removeUnderLease(
  lease: AgentWorktreeRemovalLease | null,
  remove: () => Promise<void>,
): Promise<void> {
  let outcome: AgentWorktreeRemovalOutcome = "kept";
  try {
    await remove();
    outcome = "removed";
  } finally {
    lease?.settle(outcome);
  }
}

function boundedTitle(title: string): string {
  const characters = Array.from(title.trim());
  if (characters.length <= MAX_CO_TENANT_TITLE_CHARACTERS) return characters.join("");
  return `${characters.slice(0, MAX_CO_TENANT_TITLE_CHARACTERS - 3).join("")}...`;
}

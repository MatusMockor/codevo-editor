export const AGENT_THREAD_BULK_LIMIT = 200;
export const AGENT_THREAD_BULK_CONFIRM_DELAY_MS = 350;
export const AGENT_THREAD_BULK_CONCURRENCY = 2;

export type AgentThreadBulkAction = "archive" | "unarchive" | "delete";

export type AgentThreadBulkSkipReason =
  "missing" | "foreignOwner" | "running" | "alreadyArchived" | "notArchived" | "overLimit";

export interface AgentThreadBulkCandidate {
  readonly threadId: string;
  readonly ownerKey: string;
  readonly running: boolean;
  readonly archived: boolean;
}

export interface AgentThreadBulkSkip {
  readonly threadId: string;
  readonly reason: AgentThreadBulkSkipReason;
}

export interface AgentThreadBulkRequest {
  readonly action: AgentThreadBulkAction;
  readonly ownerKey: string;
  readonly threadIds: ReadonlyArray<string>;
  readonly missingIds: ReadonlyArray<string>;
}

export interface AgentThreadBulkPlan {
  readonly action: AgentThreadBulkAction;
  readonly applyIds: ReadonlyArray<string>;
  readonly skipped: ReadonlyArray<AgentThreadBulkSkip>;
}

export type AgentThreadBulkCommand =
  | { readonly kind: "stale"; readonly action: AgentThreadBulkAction }
  | { readonly kind: "apply"; readonly request: AgentThreadBulkRequest };

const SKIP_REASON_RANK: Readonly<Record<AgentThreadBulkSkipReason, number>> = {
  running: 0,
  alreadyArchived: 1,
  notArchived: 2,
  missing: 3,
  foreignOwner: 4,
  overLimit: 5,
};

const SKIP_REASON_LABEL: Readonly<Record<AgentThreadBulkSkipReason, string>> = {
  missing: "no longer in this list",
  foreignOwner: "owned by another project",
  running: "still running",
  alreadyArchived: "already archived",
  notArchived: "not archived",
  overLimit: "beyond the batch limit",
};

export function agentThreadBulkPlan(
  request: AgentThreadBulkRequest,
  candidates: ReadonlyArray<AgentThreadBulkCandidate>,
  limit: number = AGENT_THREAD_BULK_LIMIT,
): AgentThreadBulkPlan {
  const byId = new Map(candidates.map((candidate) => [candidate.threadId, candidate]));
  const applyIds: string[] = [];
  const skipped: AgentThreadBulkSkip[] = request.missingIds.map((threadId) => ({
    threadId,
    reason: "missing",
  }));

  for (const threadId of request.threadIds) {
    const candidate = byId.get(threadId);
    if (candidate === undefined) {
      skipped.push({ threadId, reason: "missing" });
      continue;
    }
    if (candidate.ownerKey !== request.ownerKey) {
      skipped.push({ threadId, reason: "foreignOwner" });
      continue;
    }
    const blocked = blockedReason(request.action, candidate);
    if (blocked !== null) {
      skipped.push({ threadId, reason: blocked });
      continue;
    }
    if (applyIds.length >= Math.max(limit, 0)) {
      skipped.push({ threadId, reason: "overLimit" });
      continue;
    }
    applyIds.push(threadId);
  }

  return { action: request.action, applyIds, skipped };
}

export function agentThreadBulkReport(
  plan: AgentThreadBulkPlan,
  failedIds: ReadonlyArray<string> = [],
): string {
  const failed = new Set(failedIds.filter((threadId) => plan.applyIds.includes(threadId)));
  const succeeded = plan.applyIds.length - failed.size;
  const sentences = [`${appliedVerb(plan.action)} ${threadCountLabel(succeeded)}.`];
  if (failed.size > 0) {
    sentences.push(`Failed ${failed.size}: the change could not be saved.`);
  }
  if (plan.skipped.length === 0) return sentences.join(" ");
  const counted = new Map<AgentThreadBulkSkipReason, number>();
  for (const skip of plan.skipped) counted.set(skip.reason, (counted.get(skip.reason) ?? 0) + 1);
  const groups = [...counted.entries()]
    .sort(([left], [right]) => SKIP_REASON_RANK[left] - SKIP_REASON_RANK[right])
    .map(([reason, count]) => `${count} ${SKIP_REASON_LABEL[reason]}`);
  sentences.push(`Skipped ${plan.skipped.length}: ${groups.join(", ")}.`);
  return sentences.join(" ");
}

export function agentThreadBulkConfirmLabel(
  action: AgentThreadBulkAction,
  count: number,
  limit: number = AGENT_THREAD_BULK_LIMIT,
): string {
  const capped = Math.min(count, Math.max(limit, 0));
  if (capped === count) return `Confirm ${action} of ${threadCountLabel(count)}`;
  return `Confirm ${action} of ${threadCountLabel(capped)} of ${count}`;
}

export function agentThreadBulkConfirmReady(armedAtEpochMs: number, nowEpochMs: number): boolean {
  return nowEpochMs - armedAtEpochMs >= AGENT_THREAD_BULK_CONFIRM_DELAY_MS;
}

export function threadCountLabel(count: number): string {
  return count === 1 ? "1 thread" : `${count} threads`;
}

function appliedVerb(action: AgentThreadBulkAction): string {
  if (action === "archive") return "Archived";
  if (action === "unarchive") return "Unarchived";
  if (action === "delete") return "Deleted";
  return unsupportedAgentThreadBulkAction(action);
}

function blockedReason(
  action: AgentThreadBulkAction,
  candidate: AgentThreadBulkCandidate,
): AgentThreadBulkSkipReason | null {
  if (candidate.running) return "running";
  if (action === "delete") return null;
  if (action === "archive") {
    if (candidate.archived) return "alreadyArchived";
    return null;
  }
  if (action === "unarchive") {
    if (!candidate.archived) return "notArchived";
    return null;
  }
  return unsupportedAgentThreadBulkAction(action);
}

function unsupportedAgentThreadBulkAction(action: never): never {
  throw new TypeError(`Unsupported agent thread bulk action: ${String(action)}.`);
}
